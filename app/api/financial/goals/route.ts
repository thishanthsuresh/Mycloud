import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidISODate } from "@/lib/chatcloud/utils";

const MAX_AMOUNT = 9_999_999_999.99;

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[financial] goals authentication failed:", authError.message);
    return Response.json({ error: "Could not verify your account." }, { status: 401 });
  }
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("financial_savings_goals")
      .select("id, name, target_amount, saved_amount, target_date, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return Response.json({ goals: data ?? [] });
  } catch (error) {
    console.error("[financial] goals load failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not load savings goals. Run lib/supabase/financial-manager.sql in Supabase." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[financial] goal creation authentication failed:", authError.message);
    return Response.json({ error: "Could not verify your account." }, { status: 401 });
  }
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });

  const body = await request.json().catch(() => null) as {
    name?: unknown;
    targetAmount?: unknown;
    savedAmount?: unknown;
    targetDate?: unknown;
  } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const targetAmount = Number(body?.targetAmount);
  const savedAmount = body?.savedAmount === undefined || body.savedAmount === "" ? 0 : Number(body.savedAmount);
  const targetDate = body?.targetDate === "" || body?.targetDate === undefined ? null : body.targetDate;
  if (!name || name.length > 100) return Response.json({ error: "Enter a goal name (up to 100 characters)." }, { status: 400 });
  if (!Number.isFinite(targetAmount) || targetAmount <= 0 || targetAmount > MAX_AMOUNT) {
    return Response.json({ error: "Enter a target amount greater than zero." }, { status: 400 });
  }
  if (!Number.isFinite(savedAmount) || savedAmount < 0 || savedAmount > MAX_AMOUNT) {
    return Response.json({ error: "Enter a valid amount already saved." }, { status: 400 });
  }
  if (targetDate !== null && !isValidISODate(targetDate)) {
    return Response.json({ error: "Choose a valid target date." }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("financial_savings_goals")
      .insert({
        user_id: user.id,
        name,
        target_amount: targetAmount,
        saved_amount: savedAmount,
        target_date: targetDate,
      })
      .select("id, name, target_amount, saved_amount, target_date, created_at")
      .single();
    if (error) throw error;
    return Response.json({ goal: data }, { status: 201 });
  } catch (error) {
    console.error("[financial] goal creation failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not save this goal. Check the Financial Manager database setup." }, { status: 500 });
  }
}
