import type { SupabaseClient } from "@supabase/supabase-js";

export type ProfessionalMember = {
  id: string;
  organization_id: string;
  user_id: string | null;
  email: string;
  display_name: string;
  role: "manager" | "employee";
  status: "invited" | "active";
};

export async function getOrganizationMember(
  admin: SupabaseClient,
  organizationId: string,
  userId: string,
  roles?: ProfessionalMember["role"][],
) {
  let query = admin
    .from("professional_members")
    .select("id, organization_id, user_id, email, display_name, role, status")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("status", "active");
  if (roles?.length) query = query.in("role", roles);
  return query.maybeSingle();
}

export function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
