import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { STORAGE_BUCKET as CHATCLOUD_BUCKET } from "@/lib/chatcloud/constants";
import { sanitizeStem, splitName } from "@/lib/chatcloud/utils";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const STORAGE_BUCKET = "messenger-media";
const SELF_CHAT_CATEGORY = "Other";
const ALLOWED_MEDIA_TYPE = /^(image\/|video\/|audio\/|application\/pdf$)/i;

function validEncodedKeyPart(value: FormDataEntryValue | null | undefined, byteLength: number): value is string {
  if (typeof value !== "string") return false;
  try {
    return atob(value).length === byteLength;
  } catch {
    return false;
  }
}

function getDatabaseError(error: unknown) {
  if (!error || typeof error !== "object") return { code: null, message: "" };
  const databaseError = error as { code?: unknown; message?: unknown };
  return {
    code: typeof databaseError.code === "string" ? databaseError.code : null,
    message: typeof databaseError.message === "string" ? databaseError.message : "",
  };
}

function isMissingMessengerSchema(error: unknown) {
  const { code, message } = getDatabaseError(error);
  return (
    code === "42703" ||
    code === "42P01" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    /column .* does not exist|could not find the .* column|table .* does not exist|could not find the .* table/i.test(message)
  );
}

async function getParticipantConversation(conversationId: string, userId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("messenger_conversations")
    .select("id, user_one, user_two")
    .eq("id", conversationId)
    .maybeSingle();
  if (error) throw error;
  if (!data || (data.user_one !== userId && data.user_two !== userId)) return null;
  return { admin, conversation: data };
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[messenger] message authentication failed:", authError.message);
    return Response.json({ error: "Could not verify your account." }, { status: 401 });
  }
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });

  const conversationId = new URL(request.url).searchParams.get("conversationId") ?? "";
  if (!UUID_PATTERN.test(conversationId)) {
    return Response.json({ error: "A valid conversation is required." }, { status: 400 });
  }

  try {
    const result = await getParticipantConversation(conversationId, user.id);
    if (!result) return Response.json({ error: "Conversation not found." }, { status: 404 });

    const { data, error } = await result.admin
      .from("messenger_messages")
      .select("id, conversation_id, sender_id, body, media_path, media_name, media_type, media_size, is_encrypted, encryption_salt, encryption_iv, pin_digits, original_mime_type, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;

    const orderedMessages = (data ?? []).reverse();
    const mediaPaths = orderedMessages.flatMap((message) => message.media_path ? [message.media_path] : []);
    const signedUrlsByPath = new Map<string, string>();
    if (mediaPaths.length > 0) {
      const { data: signedUrls, error: signedError } = await result.admin.storage
        .from(STORAGE_BUCKET)
        .createSignedUrls(mediaPaths, 3600);
      if (signedError) throw signedError;
      for (const signed of signedUrls) {
        if (signed.error || !signed.path || !signed.signedUrl) {
          throw new Error(signed.error ?? "Could not create a media link.");
        }
        signedUrlsByPath.set(signed.path, signed.signedUrl);
      }
    }
    const messages = orderedMessages.map((message) => ({
      ...message,
      mediaUrl: message.media_path ? signedUrlsByPath.get(message.media_path) ?? null : null,
    }));
    return Response.json({ messages });
  } catch (error) {
    console.error("[messenger] message load failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not load messages." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[messenger] message authentication failed:", authError.message);
    return Response.json({ error: "Could not verify your account." }, { status: 401 });
  }
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const conversationId = form?.get("conversationId");
  const bodyValue = form?.get("body");
  const mediaValue = form?.get("media");
  const encryptedValue = form?.get("isEncrypted");
  const encryptionSalt = form?.get("encryptionSalt");
  const encryptionIv = form?.get("encryptionIv");
  const pinDigitsValue = form?.get("pinDigits");
  const originalMimeType = form?.get("originalMimeType");
  const body = typeof bodyValue === "string" ? bodyValue.trim() : "";
  const media = mediaValue instanceof File && mediaValue.size > 0 ? mediaValue : null;
  const isEncrypted = encryptedValue === "true";

  if (typeof conversationId !== "string" || !UUID_PATTERN.test(conversationId)) {
    return Response.json({ error: "A valid conversation is required." }, { status: 400 });
  }
  if (body.length > 4000) return Response.json({ error: "Messages must be 4,000 characters or fewer." }, { status: 400 });
  if (!body && !media) return Response.json({ error: "Write a message or attach media first." }, { status: 400 });
  if (media && media.size > MAX_MEDIA_BYTES) {
    return Response.json({ error: "Media must be 10 MB or smaller." }, { status: 413 });
  }
  if (isEncrypted && (
    !media ||
    media.type !== "application/octet-stream" ||
    typeof encryptionSalt !== "string" ||
    typeof encryptionIv !== "string" ||
    (pinDigitsValue !== "4" && pinDigitsValue !== "8") ||
    typeof originalMimeType !== "string" ||
    originalMimeType.length === 0 ||
    originalMimeType.length > 160
  )) {
    return Response.json({ error: "Encrypted attachments need valid encryption metadata." }, { status: 400 });
  }
  if (isEncrypted && !validEncodedKeyPart(encryptionSalt, 16)) {
    return Response.json({ error: "The encryption salt is invalid." }, { status: 400 });
  }
  if (isEncrypted && !validEncodedKeyPart(encryptionIv, 12)) {
    return Response.json({ error: "The encryption IV is invalid." }, { status: 400 });
  }
  if (media && !isEncrypted && !ALLOWED_MEDIA_TYPE.test(media.type)) {
    return Response.json({ error: "Only images, video, audio, and PDF files can be shared." }, { status: 415 });
  }

  let adminClient: ReturnType<typeof createAdminClient> | null = null;
  let storagePath: string | null = null;
  let cloudStoragePath: string | null = null;
  let cloudFileId: string | null = null;
  let failureStage: "conversation" | "messenger-media" | "chatcloud-media" | "chatcloud-record" | "message" = "conversation";
  try {
    const result = await getParticipantConversation(conversationId, user.id);
    if (!result) return Response.json({ error: "Conversation not found." }, { status: 404 });
    adminClient = result.admin;
    const isSelfChat = result.conversation.user_one === user.id && result.conversation.user_two === user.id;

    if (media) {
      const safeName = media.name.replace(/[\\/]/g, "_").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200).trim() || "attachment";
      const extension = safeName.includes(".") ? `.${safeName.split(".").pop()}` : "";
      const bytes = new Uint8Array(await media.arrayBuffer());
      storagePath = `${user.id}/${conversationId}/${crypto.randomUUID()}${extension}`;
      failureStage = "messenger-media";
      const { error: uploadError } = await adminClient.storage.from(STORAGE_BUCKET).upload(
        storagePath,
        bytes,
        { contentType: media.type, upsert: false },
      );
      if (uploadError) throw uploadError;

      if (isSelfChat && !isEncrypted) {
        const { stem, ext } = splitName(safeName);
        const displayName = ext
          ? `${sanitizeStem(stem, "Messenger file")}.${ext}`
          : sanitizeStem(safeName, "Messenger file");
        cloudStoragePath = `${user.id}/messenger/${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;
        failureStage = "chatcloud-media";
        const { error: cloudUploadError } = await adminClient.storage.from(CHATCLOUD_BUCKET).upload(
          cloudStoragePath,
          bytes,
          { contentType: media.type, upsert: false },
        );
        if (cloudUploadError) throw cloudUploadError;

        failureStage = "chatcloud-record";
        const { data: cloudFile, error: cloudFileError } = await adminClient
          .from("cloud_files")
          .insert({
            user_id: user.id,
            display_name: displayName,
            original_name: safeName,
            category: SELF_CHAT_CATEGORY,
            mime_type: media.type,
            size_bytes: media.size,
            storage_path: cloudStoragePath,
            source: "upload",
            ai_status: "fallback",
          })
          .select("id")
          .single();
        if (cloudFileError) throw cloudFileError;
        cloudFileId = cloudFile.id;
      }
    }

    failureStage = "message";
    const { data: message, error } = await adminClient
      .from("messenger_messages")
      .insert({
        conversation_id: conversationId,
        sender_id: user.id,
        body,
        media_path: storagePath,
        media_name: media?.name.replace(/[\\/]/g, "_").slice(0, 200) ?? null,
        media_type: media?.type ?? null,
        media_size: media?.size ?? null,
        is_encrypted: isEncrypted,
        encryption_salt: isEncrypted ? encryptionSalt : null,
        encryption_iv: isEncrypted ? encryptionIv : null,
        pin_digits: isEncrypted ? Number(pinDigitsValue) : 8,
        original_mime_type: isEncrypted ? originalMimeType : null,
      })
      .select("id, conversation_id, sender_id, body, media_path, media_name, media_type, media_size, is_encrypted, encryption_salt, encryption_iv, pin_digits, original_mime_type, created_at")
      .single();
    if (error) throw error;
    return Response.json({ message }, { status: 201 });
  } catch (error) {
    if (adminClient && cloudFileId) {
      const { error: cleanupError } = await adminClient.from("cloud_files").delete().eq("id", cloudFileId).eq("user_id", user.id);
      if (cleanupError) console.error("[messenger] orphan ChatCloud record cleanup failed:", cleanupError.message);
    }

    if (adminClient && cloudStoragePath) {
      const { error: cleanupError } = await adminClient.storage.from(CHATCLOUD_BUCKET).remove([cloudStoragePath]);
      if (cleanupError) console.error("[messenger] orphan ChatCloud media cleanup failed:", cleanupError.message);
    }
    if (adminClient && storagePath) {
      const { error: cleanupError } = await adminClient.storage.from(STORAGE_BUCKET).remove([storagePath]);
      if (cleanupError) console.error("[messenger] orphan Messenger media cleanup failed:", cleanupError.message);
    }
    const databaseError = getDatabaseError(error);
    console.error("[messenger] message send failed:", {
      stage: failureStage,
      code: databaseError.code,
      message: databaseError.message || (error instanceof Error ? error.message : String(error)),
    });
    const errorMessage = failureStage === "chatcloud-media"
      ? "Could not copy the attachment into ChatCloud. Check that the ChatCloud storage bucket is available."
      : failureStage === "chatcloud-record"
        ? "Could not add the attachment to your ChatCloud file list. Check the cloud_files setup and permissions."
        : failureStage === "messenger-media"
          ? "Could not store the attachment in Messenger. Check the Messenger media bucket setup."
          : failureStage === "message"
            ? isMissingMessengerSchema(error)
              ? "Messenger's database schema is missing required columns. Run lib/supabase/messenger.sql and lib/supabase/security-vault.sql in the Supabase SQL Editor, then retry."
              : "The attachment could not be added to the conversation. Please try again."
            : "Could not start sending this message. Please try again.";
    return Response.json({ error: errorMessage }, { status: 500 });
  }
}
