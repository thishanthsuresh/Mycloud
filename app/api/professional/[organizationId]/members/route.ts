import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrganizationMember, validUuid } from "@/lib/professional/server";

export async function GET(_request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[professional] member list authentication failed:", authError.message);
    return Response.json({ error: "Could not verify your account." }, { status: 401 });
  }
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });
  const { organizationId } = await context.params;
  if (!validUuid(organizationId)) return Response.json({ error: "A valid organization is required." }, { status: 400 });

  try {
    const admin = createAdminClient();
    const { data: current, error: accessError } = await getOrganizationMember(admin, organizationId, user.id);
    if (accessError) throw accessError;
    if (!current) return Response.json({ error: "You are not an active member of this organization." }, { status: 403 });

    const { data, error } = await admin
      .from("professional_members")
      .select("id, user_id, email, display_name, role, status, created_at")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return Response.json({
      members: (data ?? []).filter((member) => member.status === "active" || current.role === "manager"),
      currentMemberId: current.id,
      currentRole: current.role,
    });
  } catch (error) {
    console.error("[professional] member list failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not load organization members." }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[professional] staff invitation authentication failed:", authError.message);
    return Response.json({ error: "Could not verify your account." }, { status: 401 });
  }
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });
  const { organizationId } = await context.params;
  if (!validUuid(organizationId)) return Response.json({ error: "A valid organization is required." }, { status: 400 });

  const body = await request.json().catch(() => null) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "Enter a valid MyCloud account email." }, { status: 400 });
  }
  if (email === user.email?.toLowerCase()) return Response.json({ error: "You are already the manager of this organization." }, { status: 400 });

  try {
    const admin = createAdminClient();
    const { data: manager, error: managerError } = await getOrganizationMember(admin, organizationId, user.id, ["manager"]);
    if (managerError) throw managerError;
    if (!manager) return Response.json({ error: "Only an organization manager can invite staff." }, { status: 403 });

    const { data: profile, error: profileError } = await admin
      .from("messenger_profiles")
      .select("user_id, email, display_name")
      .eq("email", email)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile) return Response.json({ error: "No MyCloud account uses that email. Staff must create an account before being invited." }, { status: 404 });

    const { data: member, error } = await admin
      .from("professional_members")
      .insert({
        organization_id: organizationId,
        user_id: profile.user_id,
        email,
        display_name: profile.display_name,
        role: "employee",
        status: "invited",
        invited_by: user.id,
      })
      .select("id, user_id, email, display_name, role, status, created_at")
      .single();
    if (error?.code === "23505") return Response.json({ error: "This user is already a member or has a pending invitation." }, { status: 409 });
    if (error) throw error;
    return Response.json({ member }, { status: 201 });
  } catch (error) {
    console.error("[professional] staff invitation failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not invite this staff member." }, { status: 500 });
  }
}
