import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrganizationMember, validUuid } from "@/lib/professional/server";

export async function GET(_request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[professional] folder list authentication failed:", authError.message);
    return Response.json({ error: "Could not verify your account." }, { status: 401 });
  }
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });
  const { organizationId } = await context.params;
  if (!validUuid(organizationId)) return Response.json({ error: "A valid organization is required." }, { status: 400 });

  try {
    const admin = createAdminClient();
    const { data: member, error: memberError } = await getOrganizationMember(admin, organizationId, user.id);
    if (memberError) throw memberError;
    if (!member) return Response.json({ error: "You are not an active member of this organization." }, { status: 403 });

    let query = admin.from("professional_folders")
      .select("id, name, description, created_by, created_at")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });
    if (member.role === "employee") {
      const { data: access, error: accessError } = await admin.from("professional_folder_access")
        .select("folder_id")
        .eq("member_id", member.id);
      if (accessError) throw accessError;
      const folderIds = (access ?? []).map((item) => item.folder_id);
      if (!folderIds.length) return Response.json({ folders: [], currentRole: member.role });
      query = query.in("id", folderIds);
    }
    const { data: folders, error } = await query;
    if (error) throw error;
    const folderIds = (folders ?? []).map((folder) => folder.id);
    const { data: accessRows, error: accessError } = folderIds.length
      ? await admin.from("professional_folder_access").select("folder_id, member_id").in("folder_id", folderIds)
      : { data: [], error: null };
    if (accessError) throw accessError;
    const accessByFolder = new Map<string, string[]>();
    for (const row of accessRows ?? []) {
      accessByFolder.set(row.folder_id, [...(accessByFolder.get(row.folder_id) ?? []), row.member_id]);
    }
    return Response.json({
      folders: (folders ?? []).map((folder) => ({
        ...folder,
        accessibleMemberIds: accessByFolder.get(folder.id) ?? [],
        canManage: member.role === "manager",
      })),
      currentRole: member.role,
    });
  } catch (error) {
    console.error("[professional] folder list failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not load shared folders." }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[professional] folder creation authentication failed:", authError.message);
    return Response.json({ error: "Could not verify your account." }, { status: 401 });
  }
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });
  const { organizationId } = await context.params;
  if (!validUuid(organizationId)) return Response.json({ error: "A valid organization is required." }, { status: 400 });

  const body = await request.json().catch(() => null) as {
    name?: unknown;
    description?: unknown;
    memberIds?: unknown;
  } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const memberIds = Array.isArray(body?.memberIds) && body.memberIds.every((id) => typeof id === "string" && validUuid(id))
    ? [...new Set(body.memberIds as string[])]
    : null;
  if (!name || name.length > 120) return Response.json({ error: "Folder name must be between 1 and 120 characters." }, { status: 400 });
  if (description.length > 1000) return Response.json({ error: "Folder descriptions must be 1,000 characters or fewer." }, { status: 400 });
  if (!memberIds) return Response.json({ error: "Choose valid members for folder access." }, { status: 400 });

  const admin = createAdminClient();
  let folderId: string | null = null;
  try {
    const { data: manager, error: managerError } = await getOrganizationMember(admin, organizationId, user.id, ["manager"]);
    if (managerError) throw managerError;
    if (!manager) return Response.json({ error: "Only an organization manager can create shared folders." }, { status: 403 });

    if (memberIds.length) {
      const { data: selectedMembers, error: selectedError } = await admin.from("professional_members")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("role", "employee")
        .eq("status", "active")
        .in("id", memberIds);
      if (selectedError) throw selectedError;
      if ((selectedMembers ?? []).length !== memberIds.length) {
        return Response.json({ error: "Folder access can only be granted to active employees in this organization." }, { status: 400 });
      }
    }

    const { data: folder, error: folderError } = await admin.from("professional_folders")
      .insert({ organization_id: organizationId, name, description, created_by: user.id })
      .select("id, name, description, created_by, created_at")
      .single();
    if (folderError) throw folderError;
    folderId = folder.id;

    if (memberIds.length) {
      const { error: accessError } = await admin.from("professional_folder_access").insert(
        memberIds.map((memberId) => ({ folder_id: folder.id, member_id: memberId, granted_by: user.id })),
      );
      if (accessError) throw accessError;
    }
    return Response.json({ folder: { ...folder, accessibleMemberIds: memberIds, canManage: true } }, { status: 201 });
  } catch (error) {
    if (folderId) {
      const { error: cleanupError } = await admin.from("professional_folders").delete().eq("id", folderId);
      if (cleanupError) console.error("[professional] orphan shared-folder cleanup failed:", cleanupError.message);
    }
    console.error("[professional] folder creation failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not create this shared folder." }, { status: 500 });
  }
}
