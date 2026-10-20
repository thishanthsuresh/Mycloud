import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[messenger] user lookup authentication failed:", authError.message);
    return Response.json({ error: "Could not verify your account." }, { status: 401 });
  }
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });

  const email = new URL(request.url).searchParams.get("email")?.trim().toLowerCase() ?? "";
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "Enter the other user's full email address." }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("messenger_profiles")
      .select("user_id, email, display_name")
      .eq("email", email)
      .neq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return Response.json({ error: "No MyCloud user was found with that email." }, { status: 404 });
    return Response.json({ user: data });
  } catch (error) {
    console.error("[messenger] user lookup failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not search for that user." }, { status: 500 });
  }
}
