import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrganizationMember, validUuid } from "@/lib/professional/server";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

function safeName(name: string) {
  return name.replace(/[\\/]/g, "_").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200).trim() || "document";
}

async function getFolderAccess(organizationId: string, folderId: string, userId: string) {
  const admin = createAdminClient();
  const { data: member, error: memberError } = await getOrganizationMember(admin, organizationId, userId);
  if (memberError) throw memberError;
  if (!member) return { error: Response.json({ error: "You are not an active member of this organization." }, { status: 403 }) };

  const { data: folder, error: folderError } = await admin.from("professional_folders")
    .select("id, name")
    .eq("id", folderId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (folderError) throw folderError;
  if (!folder) return { error: Response.json({ error: "Shared folder not found." }, { status: 404 }) };

  if (member.role !== "manager") {
    const { data: access, error: accessError } = await admin.from("professional_folder_access")
      .select("folder_id")
      .eq("folder_id", folderId)
      .eq("member_id", member.id)
      .maybeSingle();
    if (accessError) throw accessError;
    if (!access) return { error: Response.json({ error: "This folder has not been shared with you." }, { status: 403 }) };
  }
  return { admin, member, folder };
}

export async function GET(_request: Request, context: { params: Promise<{ organizationId: string; folderId: string }> }) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[professional] folder files authentication failed:", authError.message);
    return Response.json({ error: "Could not verify your account." }, { status: 401 });
  }
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });
  const { organizationId, folderId } = await context.params;
  if (!validUuid(organizationId) || !validUuid(folderId)) return Response.json({ error: "A valid organization and folder are required." }, { status: 400 });

  try {
    const access = await getFolderAccess(organizationId, folderId, user.id);
    if (access.error) return access.error;
    const { data, error } = await access.admin.from("professional_folder_files")
      .select("id, uploaded_by, storage_path, file_name, mime_type, size_bytes, created_at")
      .eq("folder_id", folderId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    const files = await Promise.all((data ?? []).map(async (file) => {
      const { data: signed, error: signedError } = await access.admin.storage
        .from("professional-space")
        .createSignedUrl(file.storage_path, 60 * 60);
      if (signedError || !signed) throw signedError ?? new Error("Could not create a shared document link.");
      return { ...file, url: signed.signedUrl };
    }));
    return Response.json({ files, folder: access.folder });
  } catch (error) {
    console.error("[professional] folder files load failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not load files in this shared folder." }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ organizationId: string; folderId: string }> }) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[professional] shared document upload authentication failed:", authError.message);
    return Response.json({ error: "Could not verify your account." }, { status: 401 });
  }
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });
  const { organizationId, folderId } = await context.params;
  if (!validUuid(organizationId) || !validUuid(folderId)) return Response.json({ error: "A valid organization and folder are required." }, { status: 400 });
  const form = await request.formData().catch(() => null);
  const value = form?.get("file");
  const file = value instanceof File && value.size > 0 ? value : null;
  if (!file) return Response.json({ error: "Choose a document to share." }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) return Response.json({ error: "Documents must be 10 MB or smaller." }, { status: 413 });
  if (!ALLOWED_TYPES.has(file.type)) return Response.json({ error: "This document type is not supported." }, { status: 415 });

  let uploadedPath: string | null = null;
  try {
    const access = await getFolderAccess(organizationId, folderId, user.id);
    if (access.error) return access.error;
    const fileName = safeName(file.name);
    const extension = fileName.includes(".") ? `.${fileName.split(".").pop()}` : "";
    uploadedPath = `${user.id}/folders/${folderId}/${crypto.randomUUID()}${extension}`;
    const { error: uploadError } = await access.admin.storage.from("professional-space").upload(
      uploadedPath,
      new Uint8Array(await file.arrayBuffer()),
      { contentType: file.type, upsert: false },
    );
    if (uploadError) throw uploadError;
    const { data, error } = await access.admin.from("professional_folder_files")
      .insert({
        folder_id: folderId,
        uploaded_by: user.id,
        storage_path: uploadedPath,
        file_name: fileName,
        mime_type: file.type,
        size_bytes: file.size,
      })
      .select("id, uploaded_by, file_name, mime_type, size_bytes, created_at")
      .single();
    if (error) throw error;
    return Response.json({ file: { ...data, url: null } }, { status: 201 });
  } catch (error) {
    if (uploadedPath) {
      const { error: cleanupError } = await createAdminClient().storage.from("professional-space").remove([uploadedPath]);
      if (cleanupError) console.error("[professional] orphan shared document cleanup failed:", cleanupError.message);
    }
    console.error("[professional] shared document upload failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not upload this shared document." }, { status: 500 });
  }
}
