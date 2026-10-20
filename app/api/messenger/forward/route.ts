import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { STORAGE_BUCKET as CHATCLOUD_BUCKET } from "@/lib/chatcloud/constants";
import { sanitizeStem, splitName } from "@/lib/chatcloud/utils";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MESSENGER_BUCKET = "messenger-media";
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const ALLOWED_MEDIA_TYPE = /^(image\/|video\/|audio\/|application\/pdf$)/i;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[messenger] forward authentication failed:", authError.message);
    return Response.json({ error: "Could not verify your account." }, { status: 401 });
  }
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { messageId?: unknown } | null;
  if (typeof body?.messageId !== "string" || !UUID_PATTERN.test(body.messageId)) {
    return Response.json({ error: "A valid media message is required." }, { status: 400 });
  }

  const admin = createAdminClient();
  let selfConversationId: string | null = null;
  let messengerStoragePath: string | null = null;
  let cloudStoragePath: string | null = null;
  let cloudFileId: string | null = null;
  let failureStage: "source" | "download" | "conversation" | "messenger-media" | "chatcloud-media" | "chatcloud-record" | "message" = "source";

  try {
    const { data: source, error: sourceError } = await admin
      .from("messenger_messages")
      .select("id, conversation_id, sender_id, media_path, media_name, media_type, media_size")
      .eq("id", body.messageId)
      .maybeSingle();
    if (sourceError) throw sourceError;
    if (!source) return Response.json({ error: "That message could not be found." }, { status: 404 });
    if (source.sender_id === user.id || !source.media_path) {
      return Response.json({ error: "Only media received from another user can be saved to yourself." }, { status: 400 });
    }

    const { data: sourceConversation, error: conversationError } = await admin
      .from("messenger_conversations")
      .select("id, user_one, user_two")
      .eq("id", source.conversation_id)
      .maybeSingle();
    if (conversationError) throw conversationError;
    if (!sourceConversation || (sourceConversation.user_one !== user.id && sourceConversation.user_two !== user.id)) {
      return Response.json({ error: "You do not have access to this message." }, { status: 403 });
    }
    if (
      !source.media_type ||
      !ALLOWED_MEDIA_TYPE.test(source.media_type) ||
      (source.media_size !== null && source.media_size > MAX_MEDIA_BYTES) ||
      !source.media_path.startsWith(`${source.sender_id}/${source.conversation_id}/`)
    ) {
      return Response.json({ error: "This attachment cannot be saved to ChatCloud." }, { status: 400 });
    }

    failureStage = "download";
    const { data: blob, error: downloadError } = await admin.storage
      .from(MESSENGER_BUCKET)
      .download(source.media_path);
    if (downloadError) throw downloadError;
    if (blob.size === 0 || blob.size > MAX_MEDIA_BYTES) {
      return Response.json({ error: "This attachment is empty or exceeds the 10 MB limit." }, { status: 413 });
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());

    failureStage = "conversation";
    const { data: existingConversation, error: selfLookupError } = await admin
      .from("messenger_conversations")
      .select("id")
      .eq("user_one", user.id)
      .eq("user_two", user.id)
      .maybeSingle();
    if (selfLookupError) throw selfLookupError;
    if (existingConversation) {
      selfConversationId = existingConversation.id;
    } else {
      const { data: created, error: createError } = await admin
        .from("messenger_conversations")
        .insert({ user_one: user.id, user_two: user.id })
        .select("id")
        .single();
      if (createError?.code === "23505") {
        const { data: raced, error: racedError } = await admin
          .from("messenger_conversations")
          .select("id")
          .eq("user_one", user.id)
          .eq("user_two", user.id)
          .single();
        if (racedError) throw racedError;
        selfConversationId = raced.id;
      } else {
        if (createError) throw createError;
        selfConversationId = created.id;
      }
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
    messengerStoragePath = `${user.id}/${selfConversationId}/${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;

    failureStage = "messenger-media";
    const { error: messengerUploadError } = await admin.storage.from(MESSENGER_BUCKET).upload(
      messengerStoragePath,
      bytes,
      { contentType: source.media_type, upsert: false },
    );
    if (messengerUploadError) throw messengerUploadError;

    cloudStoragePath = `${user.id}/messenger/${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;
    failureStage = "chatcloud-media";
    const { error: cloudUploadError } = await admin.storage.from(CHATCLOUD_BUCKET).upload(
      cloudStoragePath,
      bytes,
      { contentType: source.media_type, upsert: false },
    );
    if (cloudUploadError) throw cloudUploadError;

    failureStage = "chatcloud-record";
    const { data: cloudFile, error: cloudFileError } = await admin
      .from("cloud_files")
      .insert({
        user_id: user.id,
        display_name: displayName,
        original_name: originalName,
        category: "Other",
        mime_type: source.media_type,
        size_bytes: bytes.byteLength,
        storage_path: cloudStoragePath,
        source: "upload",
        ai_status: "fallback",
      })
      .select("id")
      .single();
    if (cloudFileError) throw cloudFileError;
    cloudFileId = cloudFile.id;

    failureStage = "message";
    const { data: forwardedMessage, error: messageError } = await admin
      .from("messenger_messages")
      .insert({
        conversation_id: selfConversationId,
        sender_id: user.id,
        body: "Saved from Messenger",
        media_path: messengerStoragePath,
        media_name: originalName,
        media_type: source.media_type,
        media_size: bytes.byteLength,
      })
      .select("id")
      .single();
    if (messageError) throw messageError;

    return Response.json({ conversationId: selfConversationId, messageId: forwardedMessage.id }, { status: 201 });
  } catch (error) {
    if (cloudFileId) {
      const { error: cleanupError } = await admin.from("cloud_files").delete().eq("id", cloudFileId).eq("user_id", user.id);
      if (cleanupError) console.error("[messenger] forwarded ChatCloud record cleanup failed:", cleanupError.message);
    }
    if (cloudStoragePath) {
      const { error: cleanupError } = await admin.storage.from(CHATCLOUD_BUCKET).remove([cloudStoragePath]);
      if (cleanupError) console.error("[messenger] forwarded ChatCloud media cleanup failed:", cleanupError.message);
    }
    if (messengerStoragePath) {
      const { error: cleanupError } = await admin.storage.from(MESSENGER_BUCKET).remove([messengerStoragePath]);
      if (cleanupError) console.error("[messenger] forwarded Messenger media cleanup failed:", cleanupError.message);
    }
    console.error("[messenger] media forwarding failed:", error instanceof Error ? error.message : error);
    const errorMessage = failureStage === "download"
      ? "Could not read the original attachment from Messenger."
      : failureStage === "messenger-media"
        ? "Could not copy the attachment into your self-chat."
        : failureStage === "chatcloud-media"
          ? "Could not copy the attachment into ChatCloud. Check that the ChatCloud storage bucket is available."
          : failureStage === "chatcloud-record"
            ? "The attachment was copied, but could not be added to your ChatCloud file list."
            : failureStage === "message"
              ? "The attachment was copied, but could not be added to your self-chat."
              : "Could not save the attachment to yourself. Please try again.";
    return Response.json({ error: errorMessage }, { status: 500 });
  }
}
