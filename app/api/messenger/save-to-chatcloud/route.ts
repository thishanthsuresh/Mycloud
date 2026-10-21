import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { STORAGE_BUCKET } from "@/lib/chatcloud/constants";
import { sanitizeStem, splitName } from "@/lib/chatcloud/utils";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MESSENGER_BUCKET = "messenger-media";
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const ALLOWED_MEDIA_TYPE = /^(image\/|video\/|audio\/|application\/pdf$)/i;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[messenger] ChatCloud save authentication failed:", authError.message);
    return Response.json({ error: "Could not verify your account." }, { status: 401 });
  }
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { messageId?: unknown } | null;
  if (typeof body?.messageId !== "string" || !UUID_PATTERN.test(body.messageId)) {
    return Response.json({ error: "A valid media message is required." }, { status: 400 });
  }

  const admin = createAdminClient();
  let cloudStoragePath: string | null = null;
  try {
    const { data: source, error: sourceError } = await admin
      .from("messenger_messages")
      .select("id, conversation_id, sender_id, media_path, media_name, media_type, media_size, is_encrypted")
      .eq("id", body.messageId)
      .maybeSingle();
    if (sourceError) throw sourceError;
    if (!source || !source.media_path) return Response.json({ error: "That attachment could not be found." }, { status: 404 });

    const { data: conversation, error: conversationError } = await admin
      .from("messenger_conversations")
      .select("id, user_one, user_two")
      .eq("id", source.conversation_id)
      .maybeSingle();
    if (conversationError) throw conversationError;
    if (!conversation || (conversation.user_one !== user.id && conversation.user_two !== user.id)) {
      return Response.json({ error: "You do not have access to this attachment." }, { status: 403 });
    }
    if (
      source.is_encrypted ||
      !source.media_type ||
      !ALLOWED_MEDIA_TYPE.test(source.media_type) ||
      (source.media_size !== null && source.media_size > MAX_MEDIA_BYTES) ||
      !source.media_path.startsWith(`${source.sender_id}/${source.conversation_id}/`)
    ) {
      return Response.json({ error: "This attachment cannot be saved to ChatCloud." }, { status: 400 });
    }

    const originalName = (source.media_name ?? "Messenger file")
      .replace(/[\\/]/g, "_")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .slice(0, 200)
      .trim() || "Messenger file";
    const { stem, ext } = splitName(originalName);
    const displayName = ext
      ? `${sanitizeStem(stem, "Messenger file")}.${ext}`
      : sanitizeStem(originalName, "Messenger file");
    cloudStoragePath = `${user.id}/messenger/${source.id}${ext ? `.${ext}` : ""}`;

    const { data: existingFile, error: existingFileError } = await admin
      .from("cloud_files")
      .select("id")
      .eq("user_id", user.id)
      .eq("storage_path", cloudStoragePath)
      .maybeSingle();
    if (existingFileError) throw existingFileError;
    if (existingFile) return Response.json({ status: "already-saved" });

    const { data: blob, error: downloadError } = await admin.storage
      .from(MESSENGER_BUCKET)
      .download(source.media_path);
    if (downloadError) throw downloadError;
    if (!blob || blob.size === 0 || blob.size > MAX_MEDIA_BYTES) {
      return Response.json({ error: "This attachment is empty or exceeds the 10 MB limit." }, { status: 413 });
    }

    const { error: uploadError } = await admin.storage.from(STORAGE_BUCKET).upload(
      cloudStoragePath,
      new Uint8Array(await blob.arrayBuffer()),
      { contentType: source.media_type, upsert: false },
    );
    if (uploadError) throw uploadError;

    const { error: recordError } = await admin.from("cloud_files").insert({
      user_id: user.id,
      display_name: displayName,
      original_name: originalName,
      category: "Other",
      mime_type: source.media_type,
      size_bytes: blob.size,
      storage_path: cloudStoragePath,
      source: "upload",
      ai_status: "fallback",
    });
    if (recordError) {
      const { error: cleanupError } = await admin.storage.from(STORAGE_BUCKET).remove([cloudStoragePath]);
      if (cleanupError) console.error("[messenger] unsaved ChatCloud media cleanup failed:", cleanupError.message);
      cloudStoragePath = null;
      throw recordError;
    }

    return Response.json({ status: "saved" }, { status: 201 });
  } catch (error) {
    console.error("[messenger] saving attachment to ChatCloud failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not save this attachment to ChatCloud. Please try again." }, { status: 500 });
  }
}
