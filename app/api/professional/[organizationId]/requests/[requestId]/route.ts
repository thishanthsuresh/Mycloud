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

export async function PATCH(request: Request, context: { params: Promise<{ organizationId: string; requestId: string }> }) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[professional] document request update authentication failed:", authError.message);
    return Response.json({ error: "Could not verify your account." }, { status: 401 });
  }
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });
  const { organizationId, requestId } = await context.params;
  if (!validUuid(organizationId) || !validUuid(requestId)) {
    return Response.json({ error: "A valid organization and document request are required." }, { status: 400 });
  }

  const form = await request.formData().catch(() => null);
  const action = form?.get("action");
  if (action !== "submit" && action !== "approve" && action !== "changes_requested") {
    return Response.json({ error: "Choose a valid request action." }, { status: 400 });
  }
  const fileValue = form?.get("file");
  const file = fileValue instanceof File && fileValue.size > 0 ? fileValue : null;
  if (action === "submit" && !file) return Response.json({ error: "Attach a document before submitting the request." }, { status: 400 });
  if (action !== "submit" && file) return Response.json({ error: "Only document submission accepts an attachment." }, { status: 400 });
  if (file && file.size > MAX_FILE_BYTES) return Response.json({ error: "Documents must be 10 MB or smaller." }, { status: 413 });
  if (file && !ALLOWED_TYPES.has(file.type)) return Response.json({ error: "This document type is not supported." }, { status: 415 });

  const admin = createAdminClient();
  let uploadedPath: string | null = null;
  try {
    const { data: member, error: memberError } = await getOrganizationMember(admin, organizationId, user.id);
    if (memberError) throw memberError;
    if (!member) return Response.json({ error: "You are not an active member of this organization." }, { status: 403 });

    const { data: documentRequest, error: requestError } = await admin.from("professional_requests")
      .select("id, status, assigned_member_id, attachment_path")
      .eq("id", requestId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (requestError) throw requestError;
    if (!documentRequest) return Response.json({ error: "Document request not found." }, { status: 404 });

    if (action === "submit") {
      if (member.role !== "employee" || member.id !== documentRequest.assigned_member_id) {
        return Response.json({ error: "Only the assigned employee can submit this document." }, { status: 403 });
      }
      if (documentRequest.status !== "open" && documentRequest.status !== "changes_requested") {
        return Response.json({ error: "This request is not accepting submissions." }, { status: 409 });
      }
      if (!file) return Response.json({ error: "Attach a document before submitting the request." }, { status: 400 });
      const name = safeName(file.name);
      const extension = name.includes(".") ? `.${name.split(".").pop()}` : "";
      uploadedPath = `${user.id}/requests/${requestId}/${crypto.randomUUID()}${extension}`;
      const { error: uploadError } = await admin.storage.from("professional-space").upload(
        uploadedPath,
        new Uint8Array(await file.arrayBuffer()),
        { contentType: file.type || "application/octet-stream", upsert: false },
      );
      if (uploadError) throw uploadError;
      const { data: updated, error: updateError } = await admin.from("professional_requests")
        .update({
          status: "submitted",
          attachment_path: uploadedPath,
          attachment_name: name,
          attachment_type: file.type || "application/octet-stream",
          attachment_size: file.size,
          submitted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", requestId)
        .eq("organization_id", organizationId)
        .in("status", ["open", "changes_requested"])
        .select("id")
        .maybeSingle();
      if (updateError) throw updateError;
      if (!updated) throw new Error("The request state changed before submission completed.");
      if (documentRequest.attachment_path) {
        const { error: removeError } = await admin.storage.from("professional-space").remove([documentRequest.attachment_path]);
        if (removeError) console.error("[professional] replaced request document cleanup failed:", removeError.message);
      }
      return Response.json({ ok: true, status: "submitted" });
    }

    if (member.role !== "manager") return Response.json({ error: "Only an organization manager can review submissions." }, { status: 403 });
    if (documentRequest.status !== "submitted") return Response.json({ error: "Only submitted requests can be reviewed." }, { status: 409 });
    const nextStatus = action === "approve" ? "approved" : "changes_requested";
    const { data: updated, error: updateError } = await admin.from("professional_requests")
      .update({
        status: nextStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestId)
      .eq("organization_id", organizationId)
      .eq("status", "submitted")
      .select("id")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) return Response.json({ error: "This request was already reviewed. Refresh the request list and try again." }, { status: 409 });
    return Response.json({ ok: true, status: nextStatus });
  } catch (error) {
    if (uploadedPath) {
      const { error: cleanupError } = await admin.storage.from("professional-space").remove([uploadedPath]);
      if (cleanupError) console.error("[professional] failed submission cleanup failed:", cleanupError.message);
    }
    console.error("[professional] document request update failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not update this document request." }, { status: 500 });
  }
}
