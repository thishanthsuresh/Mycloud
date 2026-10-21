import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrganizationMember, validUuid } from "@/lib/professional/server";

export async function PATCH(request: Request, context: { params: Promise<{ organizationId: string; memberId: string }> }) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[professional] invitation acceptance authentication failed:", authError.message);
    return Response.json({ error: "Could not verify your account." }, { status: 401 });
  }
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });

  const { organizationId, memberId } = await context.params;
  if (!validUuid(organizationId) || !validUuid(memberId)) return Response.json({ error: "A valid organization and invitation are required." }, { status: 400 });
  const body = await request.json().catch(() => null) as { action?: unknown } | null;
  if (body?.action !== "accept") return Response.json({ error: "Unsupported membership action." }, { status: 400 });

  try {
    const admin = createAdminClient();
    const { data: invitation, error: invitationError } = await admin
      .from("professional_members")
      .select("id, organization_id, user_id, email, status, role")
      .eq("id", memberId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (invitationError) throw invitationError;
    if (!invitation || invitation.status !== "invited" || invitation.email !== user.email?.toLowerCase() || invitation.role !== "employee") {
      return Response.json({ error: "This invitation is not available to your account." }, { status: 403 });
    }

    const { data, error } = await admin
      .from("professional_members")
      .update({ user_id: user.id, status: "active" })
      .eq("id", memberId)
      .eq("status", "invited")
      .select("id, organization_id, user_id, email, display_name, role, status")
      .maybeSingle();
    if (error) throw error;
    if (!data) return Response.json({ error: "This invitation has already been accepted." }, { status: 409 });
    return Response.json({ member: data });
  } catch (error) {
    console.error("[professional] invitation acceptance failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not accept this invitation." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ organizationId: string; memberId: string }> }) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[professional] member removal authentication failed:", authError.message);
    return Response.json({ error: "Could not verify your account." }, { status: 401 });
  }
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });

  const { organizationId, memberId } = await context.params;
  if (!validUuid(organizationId) || !validUuid(memberId)) return Response.json({ error: "A valid organization and member are required." }, { status: 400 });
  try {
    const admin = createAdminClient();
    const { data: manager, error: managerError } = await getOrganizationMember(admin, organizationId, user.id, ["manager"]);
    if (managerError) throw managerError;
    if (!manager) return Response.json({ error: "Only an organization manager can remove staff." }, { status: 403 });
    const { data: removed, error } = await admin.from("professional_members")
      .delete()
      .eq("id", memberId)
      .eq("organization_id", organizationId)
      .neq("role", "manager")
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!removed) return Response.json({ error: "Staff member not found." }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[professional] staff removal failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not remove this staff member." }, { status: 500 });
  }
}
