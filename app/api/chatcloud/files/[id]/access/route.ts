import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(_req: Request, context: RouteContext<"/api/chatcloud/files/[id]/access">) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });
  const { id } = await context.params;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("cloud_files")
    .update({ last_accessed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[chatcloud] file access tracking failed:", error.message);
    return Response.json({ error: "Could not record file usage." }, { status: 500 });
  }
  if (!data) return Response.json({ error: "File not found." }, { status: 404 });
  return Response.json({ ok: true });
}
