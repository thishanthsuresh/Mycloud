import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STORAGE_BUCKET = "financial-bills";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[financial] bill deletion authentication failed:", authError.message);
    return Response.json({ error: "Could not verify your account." }, { status: 401 });
  }
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return Response.json({ error: "A valid bill is required." }, { status: 400 });
  try {
    const admin = createAdminClient();
    const { data: bill, error: lookupError } = await admin
      .from("financial_bills")
      .select("id, attachment_path")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!bill) return Response.json({ error: "Bill not found." }, { status: 404 });

    if (bill.attachment_path) {
      const { error: storageError } = await admin.storage.from(STORAGE_BUCKET).remove([bill.attachment_path]);
      if (storageError) throw storageError;
    }
    const { error: deleteError } = await admin
      .from("financial_bills")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);
    if (deleteError) throw deleteError;
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[financial] bill deletion failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not delete this bill." }, { status: 500 });
  }
}
