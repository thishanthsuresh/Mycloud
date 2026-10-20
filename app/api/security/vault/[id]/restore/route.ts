import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { STORAGE_BUCKET } from "@/lib/chatcloud/constants";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[security] permanent vault unlock authentication failed:", authError.message);
    return Response.json({ error: "Could not verify your account." }, { status: 401 });
  }
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return Response.json({ error: "A valid vault file is required." }, { status: 400 });

  const form = await request.formData().catch(() => null);
  const restoredFile = form?.get("file");
  if (!(restoredFile instanceof File) || restoredFile.size === 0 || restoredFile.size > MAX_FILE_BYTES) {
    return Response.json({ error: "The restored file must be between 1 byte and 10 MB." }, { status: 413 });
  }

  const admin = createAdminClient();
  let originalFileId: string | null = null;
  let originalPath: string | null = null;
  let originalWasHidden: boolean | null = null;
  let restoredUploaded = false;
  let originalMarkedUnlocked = false;
  try {
    const { data: vaultFile, error: vaultError } = await admin
      .from("security_vault_files")
      .select("id, user_id, original_file_id, storage_path, size_bytes")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (vaultError) throw vaultError;
    if (!vaultFile) return Response.json({ error: "Vault file not found." }, { status: 404 });
    if (Number(vaultFile.size_bytes) !== restoredFile.size) {
      return Response.json({ error: "The decrypted file size does not match the original." }, { status: 400 });
    }

    const { data: source, error: sourceError } = await admin
      .from("cloud_files")
      .select("id, user_id, storage_path, is_vaulted, is_hidden")
      .eq("id", vaultFile.original_file_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (sourceError) throw sourceError;
    if (!source || !source.is_vaulted || !source.storage_path.startsWith(`${user.id}/`)) {
      return Response.json({ error: "The original ChatCloud file could not be restored." }, { status: 409 });
    }

    const sourceFileId = source.id;
    const sourceStoragePath = source.storage_path;
    const encryptedStoragePath = vaultFile.storage_path;
    originalFileId = sourceFileId;
    originalPath = sourceStoragePath;
    originalWasHidden = source.is_hidden;
    const { error: uploadError } = await admin.storage.from(STORAGE_BUCKET).upload(
      sourceStoragePath,
      new Uint8Array(await restoredFile.arrayBuffer()),
      { contentType: restoredFile.type || "application/octet-stream", upsert: true },
    );
    if (uploadError) throw uploadError;
    restoredUploaded = true;

    const { data: unlocked, error: unlockError } = await admin
      .from("cloud_files")
      .update({ is_vaulted: false, is_hidden: false })
      .eq("id", sourceFileId)
      .eq("user_id", user.id)
      .eq("is_vaulted", true)
      .select("id")
      .maybeSingle();
    if (unlockError) throw unlockError;
    if (!unlocked) throw new Error("The file state changed while it was being restored.");
    originalMarkedUnlocked = true;

    const { error: deleteRecordError } = await admin
      .from("security_vault_files")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);
    if (deleteRecordError) throw deleteRecordError;

    const { error: removeEncryptedError } = await admin.storage.from(STORAGE_BUCKET).remove([encryptedStoragePath]);
    if (removeEncryptedError) {
      console.error("[security] permanent unlock left an encrypted storage copy:", removeEncryptedError.message);
      return Response.json({
        ok: true,
        warning: "The file was restored to ChatCloud, but its encrypted vault copy could not be removed.",
      });
    }

    return Response.json({ ok: true });
  } catch (error) {
    if (originalMarkedUnlocked && originalFileId) {
      const { error: rollbackError } = await admin
        .from("cloud_files")
        .update({ is_vaulted: true, is_hidden: originalWasHidden ?? false })
        .eq("id", originalFileId)
        .eq("user_id", user.id);
      if (rollbackError) console.error("[security] permanent unlock state rollback failed:", rollbackError.message);
    }
    if (restoredUploaded && originalPath) {
      const { error: cleanupError } = await admin.storage.from(STORAGE_BUCKET).remove([originalPath]);
      if (cleanupError) console.error("[security] permanent unlock plaintext cleanup failed:", cleanupError.message);
    }
    console.error("[security] permanent vault unlock failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not unlock this file permanently. The encrypted vault copy was kept." }, { status: 500 });
  }
}
