import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidISODate } from "@/lib/chatcloud/utils";
import { getOrganizationMember, validUuid } from "@/lib/professional/server";

export async function GET(_request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[professional] request list authentication failed:", authError.message);
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

    let query = admin.from("professional_requests")
      .select("id, title, description, due_date, status, assigned_member_id, created_by, attachment_path, attachment_name, attachment_type, attachment_size, submitted_at, updated_at, created_at")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (member.role === "employee") query = query.eq("assigned_member_id", member.id);
    const { data, error } = await query;
    if (error) throw error;

    const memberIds = [...new Set((data ?? []).map((item) => item.assigned_member_id))];
    const { data: assignees, error: assigneeError } = memberIds.length
      ? await admin.from("professional_members").select("id, display_name, email").in("id", memberIds)
      : { data: [], error: null };
    if (assigneeError) throw assigneeError;
    const assigneeById = new Map((assignees ?? []).map((item) => [item.id, item]));

    const requests = await Promise.all((data ?? []).map(async (item) => {
      let attachmentUrl: string | null = null;
      if (item.attachment_path) {
        const { data: signed, error: signedError } = await admin.storage
          .from("professional-space")
          .createSignedUrl(item.attachment_path, 60 * 60);
        if (signedError || !signed) throw signedError ?? new Error("Could not create a request attachment link.");
        attachmentUrl = signed.signedUrl;
      }
      return { ...item, assignee: assigneeById.get(item.assigned_member_id) ?? null, attachmentUrl };
    }));
    return Response.json({ requests, currentMemberId: member.id, currentRole: member.role });
  } catch (error) {
    console.error("[professional] request list failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not load document requests." }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[professional] request creation authentication failed:", authError.message);
    return Response.json({ error: "Could not verify your account." }, { status: 401 });
  }
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });
  const { organizationId } = await context.params;
  if (!validUuid(organizationId)) return Response.json({ error: "A valid organization is required." }, { status: 400 });

  const body = await request.json().catch(() => null) as {
    title?: unknown;
    description?: unknown;
    dueDate?: unknown;
    assignedMemberId?: unknown;
  } | null;
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const dueDate = body?.dueDate === "" || body?.dueDate === undefined ? null : body.dueDate;
  if (!title || title.length > 160) return Response.json({ error: "Request title must be between 1 and 160 characters." }, { status: 400 });
  if (description.length > 2000) return Response.json({ error: "Request descriptions must be 2,000 characters or fewer." }, { status: 400 });
  if (dueDate !== null && !isValidISODate(dueDate)) return Response.json({ error: "Choose a valid due date." }, { status: 400 });
  if (typeof body?.assignedMemberId !== "string" || !validUuid(body.assignedMemberId)) {
    return Response.json({ error: "Choose an employee for this request." }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const { data: manager, error: managerError } = await getOrganizationMember(admin, organizationId, user.id, ["manager"]);
    if (managerError) throw managerError;
    if (!manager) return Response.json({ error: "Only a manager can create document requests." }, { status: 403 });

    const { data: assignee, error: assigneeError } = await admin.from("professional_members")
      .select("id, role, status")
      .eq("id", body.assignedMemberId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (assigneeError) throw assigneeError;
    if (!assignee || assignee.role !== "employee" || assignee.status !== "active") {
      return Response.json({ error: "Choose an active employee in this organization." }, { status: 400 });
    }
    const { data, error } = await admin.from("professional_requests")
      .insert({
        organization_id: organizationId,
        title,
        description,
        due_date: dueDate,
        assigned_member_id: assignee.id,
        created_by: user.id,
      })
      .select("id, title, description, due_date, status, assigned_member_id, created_at")
      .single();
    if (error) throw error;
    return Response.json({ request: data }, { status: 201 });
  } catch (error) {
    console.error("[professional] request creation failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not create this document request." }, { status: 500 });
  }
}
