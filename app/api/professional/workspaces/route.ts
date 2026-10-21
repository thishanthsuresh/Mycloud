import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[professional] workspace authentication failed:", authError.message);
    return Response.json({ error: "Could not verify your account." }, { status: 401 });
  }
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });

  try {
    const admin = createAdminClient();
    const [activeResult, invitedResult] = await Promise.all([
      admin.from("professional_members")
        .select("id, organization_id, user_id, email, display_name, role, status")
        .eq("user_id", user.id)
        .eq("status", "active"),
      user.email
        ? admin.from("professional_members")
          .select("id, organization_id, user_id, email, display_name, role, status")
          .eq("email", user.email.toLowerCase())
          .eq("status", "invited")
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (activeResult.error) throw activeResult.error;
    if (invitedResult.error) throw invitedResult.error;

    const memberships = [...(activeResult.data ?? []), ...(invitedResult.data ?? [])];
    const organizationIds = [...new Set(memberships.map((membership) => membership.organization_id))];
    const { data: organizations, error: organizationError } = organizationIds.length
      ? await admin.from("professional_organizations")
        .select("id, name, created_at")
        .in("id", organizationIds)
        .order("created_at", { ascending: false })
      : { data: [], error: null };
    if (organizationError) throw organizationError;
    return Response.json({
      userId: user.id,
      email: user.email ?? "",
      organizations: (organizations ?? []).map((organization) => ({
        ...organization,
        membership: memberships.find((membership) => membership.organization_id === organization.id),
      })),
    });
  } catch (error) {
    console.error("[professional] workspace load failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not load Professional Space. Run lib/supabase/professional-space.sql in Supabase." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[professional] organization creation authentication failed:", authError.message);
    return Response.json({ error: "Could not verify your account." }, { status: 401 });
  }
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });
  if (!user.email) return Response.json({ error: "Your account needs an email address to create an organization." }, { status: 400 });

  const body = await request.json().catch(() => null) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (name.length < 2 || name.length > 120) {
    return Response.json({ error: "Organization name must be between 2 and 120 characters." }, { status: 400 });
  }

  const admin = createAdminClient();
  let organizationId: string | null = null;
  try {
    const { data: organization, error: organizationError } = await admin
      .from("professional_organizations")
      .insert({ name, created_by: user.id })
      .select("id, name, created_at")
      .single();
    if (organizationError) throw organizationError;
    organizationId = organization.id;

    const { data: membership, error: membershipError } = await admin
      .from("professional_members")
      .insert({
        organization_id: organization.id,
        user_id: user.id,
        email: user.email.toLowerCase(),
        display_name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? user.email.split("@")[0],
        role: "manager",
        status: "active",
        invited_by: user.id,
      })
      .select("id, organization_id, user_id, email, display_name, role, status")
      .single();
    if (membershipError) throw membershipError;
    return Response.json({ organization: { ...organization, membership } }, { status: 201 });
  } catch (error) {
    if (organizationId) {
      const { error: cleanupError } = await admin.from("professional_organizations").delete().eq("id", organizationId);
      if (cleanupError) console.error("[professional] orphan organization cleanup failed:", cleanupError.message);
    }
    console.error("[professional] organization creation failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not create your organization. Check the Professional Space database setup." }, { status: 500 });
  }
}
