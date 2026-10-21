import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_AMOUNT = 9_999_999_999.99;

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[financial] savings update authentication failed:", authError.message);
    return Response.json({ error: "Could not verify your account." }, { status: 401 });
  }
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return Response.json({ error: "A valid savings goal is required." }, { status: 400 });
  const body = await request.json().catch(() => null) as { savedAmount?: unknown } | null;
  const savedAmount = Number(body?.savedAmount);
  if (!Number.isFinite(savedAmount) || savedAmount < 0 || savedAmount > MAX_AMOUNT) {
    return Response.json({ error: "Enter a valid saved amount." }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("financial_savings_goals")
      .update({ saved_amount: savedAmount, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id, name, target_amount, saved_amount, target_date, created_at")
      .maybeSingle();
    if (error) throw error;
    if (!data) return Response.json({ error: "Savings goal not found." }, { status: 404 });
    return Response.json({ goal: data });
  } catch (error) {
    console.error("[financial] savings update failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not update this savings goal." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[financial] goal deletion authentication failed:", authError.message);
    return Response.json({ error: "Could not verify your account." }, { status: 401 });
  }
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return Response.json({ error: "A valid savings goal is required." }, { status: 400 });
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("financial_savings_goals")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return Response.json({ error: "Savings goal not found." }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[financial] goal deletion failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not delete this savings goal." }, { status: 500 });
  }
}
