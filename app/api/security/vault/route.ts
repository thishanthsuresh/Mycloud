import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { STORAGE_BUCKET } from "@/lib/chatcloud/constants";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validEncodedKeyPart(value: FormDataEntryValue | null | undefined, byteLength: number): value is string {
  if (typeof value !== "string") return false;
  try {
    return atob(value).length === byteLength;
  } catch {
    return false;
  }
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[security] vault authentication failed:", authError.message);
    return Response.json({ error: "Could not verify your account." }, { status: 401 });
  }
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });

  try {
    const { data, error } = await createAdminClient()
      .from("security_vault_files")
      .select("id, original_file_id, file_name, mime_type, size_bytes, encryption_salt, encryption_iv, pin_digits, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    const originalFileIds = (data ?? []).map((file) => file.original_file_id);
    const admin = createAdminClient();
    const { data: originalFiles, error: originalFilesError } = originalFileIds.length
      ? await admin
        .from("cloud_files")
        .select("id, is_hidden")
        .eq("user_id", user.id)
        .in("id", originalFileIds)
      : { data: [], error: null };
    if (originalFilesError) throw originalFilesError;
    const hiddenByFileId = new Map((originalFiles ?? []).map((file) => [file.id, file.is_hidden]));
    return Response.json({
      files: (data ?? []).map((file) => ({
        ...file,
        is_hidden: hiddenByFileId.get(file.original_file_id) ?? false,
      })),
    });
  } catch (error) {
    console.error("[security] vault list failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not load your vault." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[security] vault authentication failed:", authError.message);
    return Response.json({ error: "Could not verify your account." }, { status: 401 });
  }
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const fileId = form?.get("fileId");
  const encryptedFile = form?.get("file");
  const salt = form?.get("salt");
  const iv = form?.get("iv");
  const hiddenValue = form?.get("hideFromChatcloud");
  if (typeof fileId !== "string" || !UUID_PATTERN.test(fileId) || !(encryptedFile instanceof File)) {
    return Response.json({ error: "Choose a valid ChatCloud file to lock." }, { status: 400 });
  }
  if (hiddenValue !== "true" && hiddenValue !== "false") {
    return Response.json({ error: "Choose whether this file should be hidden from ChatCloud." }, { status: 400 });
  }
  const hideFromChatcloud = hiddenValue === "true";
  if (encryptedFile.size <= 16 || encryptedFile.size > MAX_FILE_BYTES) {
    return Response.json({ error: "Encrypted files must be under 10 MB." }, { status: 413 });
  }
  if (!validEncodedKeyPart(salt, 16) || !validEncodedKeyPart(iv, 12)) {
    return Response.json({ error: "Encryption metadata is invalid." }, { status: 400 });
  }

  const admin = createAdminClient();
  let encryptedPath: string | null = null;
  let vaultId: string | null = null;
  let originalPath: string | null = null;
  let sourceHiddenBeforeLock = false;
  let fileMarkedVaulted = false;
  try {
    const { data: source, error: sourceError } = await admin
      .from("cloud_files")
      .select("id, user_id, display_name, mime_type, size_bytes, storage_path, is_vaulted, is_hidden")
      .eq("id", fileId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (sourceError) throw sourceError;
    if (!source) return Response.json({ error: "File not found." }, { status: 404 });
    if (source.is_vaulted) return Response.json({ error: "This file is already in your vault." }, { status: 409 });
    if (!source.storage_path.startsWith(`${user.id}/`)) {
      return Response.json({ error: "The selected file is not stored in your account." }, { status: 403 });
    }

    originalPath = source.storage_path;
    sourceHiddenBeforeLock = source.is_hidden;
    encryptedPath = `${user.id}/vault/${crypto.randomUUID()}.enc`;
    const { error: uploadError } = await admin.storage.from(STORAGE_BUCKET).upload(
      encryptedPath,
      new Uint8Array(await encryptedFile.arrayBuffer()),
      { contentType: source.mime_type || "application/octet-stream", upsert: false },
    );
    if (uploadError) throw uploadError;

    const { data: vaultFile, error: insertError } = await admin
      .from("security_vault_files")
      .insert({
        user_id: user.id,
        original_file_id: source.id,
        storage_path: encryptedPath,
        file_name: source.display_name,
        mime_type: source.mime_type || "application/octet-stream",
        size_bytes: source.size_bytes,
        encryption_salt: salt,
        encryption_iv: iv,
        pin_digits: 4,
      })
      .select("id")
      .single();
    if (insertError) throw insertError;
    vaultId = vaultFile.id;

    const { data: markedFile, error: markError } = await admin
      .from("cloud_files")
      .update({ is_vaulted: true, is_hidden: hideFromChatcloud })
      .eq("id", source.id)
      .eq("user_id", user.id)
      .eq("is_vaulted", false)
      .select("id")
      .maybeSingle();
    if (markError) throw markError;
    if (!markedFile) throw new Error("The file changed while it was being locked. Try again.");
    fileMarkedVaulted = true;

    if (!originalPath) throw new Error("Original file path is missing.");
    const { error: removeError } = await admin.storage.from(STORAGE_BUCKET).remove([originalPath]);
    if (removeError) throw removeError;
    return Response.json({ ok: true, vaultFileId: vaultId }, { status: 201 });
  } catch (error) {
    if (fileMarkedVaulted && fileId) {
      const { error: rollbackError } = await admin
        .from("cloud_files")
        .update({ is_vaulted: false, is_hidden: sourceHiddenBeforeLock })
        .eq("id", fileId)
        .eq("user_id", user.id);
      if (rollbackError) console.error("[security] vault lock rollback failed:", rollbackError.message);
    }
    if (vaultId) {
      const { error: cleanupError } = await admin.from("security_vault_files").delete().eq("id", vaultId).eq("user_id", user.id);
      if (cleanupError) console.error("[security] vault record cleanup failed:", cleanupError.message);
    }
    if (encryptedPath) {
      const { error: cleanupError } = await admin.storage.from(STORAGE_BUCKET).remove([encryptedPath]);
      if (cleanupError) console.error("[security] encrypted upload cleanup failed:", cleanupError.message);
    }
    console.error("[security] vault lock failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not lock this file. The original was not intentionally removed." }, { status: 500 });
  }
}
