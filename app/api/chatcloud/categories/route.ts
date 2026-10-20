import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrCreateUserCategories } from "@/lib/chatcloud/user-categories";

const cleanName = (value: unknown) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "");

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });

  try {
    await getOrCreateUserCategories(user.id);
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("chatcloud_categories")
      .select("id, user_id, name, created_at")
      .eq("user_id", user.id)
      .order("name");
    if (error) throw error;
    const categories = await Promise.all((data ?? []).map(async (item) => {
      const { count, error: countError } = await admin
        .from("cloud_files")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("category", item.name);
      if (countError) throw countError;
      return { ...item, file_count: count ?? 0 };
    }));
    return Response.json({ categories });
  } catch (err) {
    console.error("[chatcloud] category load failed:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Could not load your categories." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const name = cleanName(body?.name);
  if (!name || name.length > 40) {
    return Response.json({ error: "Category names must be between 1 and 40 characters." }, { status: 400 });
  }

  try {
    await getOrCreateUserCategories(user.id);
    const admin = createAdminClient();
    const { data: existing, error: lookupError } = await admin
      .from("chatcloud_categories")
      .select("name")
      .eq("user_id", user.id);
    if (lookupError) throw lookupError;
    if (existing?.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
      return Response.json({ error: "You already have a category with that name." }, { status: 409 });
    }

    const { data, error } = await admin
      .from("chatcloud_categories")
      .insert({ user_id: user.id, name })
      .select("id, user_id, name, created_at")
      .single();
    if (error?.code === "23505") return Response.json({ error: "You already have a category with that name." }, { status: 409 });
    if (error) throw error;
    return Response.json({ category: { ...data, file_count: 0 } }, { status: 201 });
  } catch (err) {
    console.error("[chatcloud] category creation failed:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Could not create that category." }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
  if (typeof body?.id !== "string" || !body.id) {
    return Response.json({ error: "A category ID is required." }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const { data: category, error: lookupError } = await admin
      .from("chatcloud_categories")
      .select("id, name")
      .eq("id", body.id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!category) return Response.json({ error: "Category not found." }, { status: 404 });
    if (category.name.toLowerCase() === "other") {
      return Response.json({ error: "The Other category is required and cannot be deleted." }, { status: 400 });
    }

    const { error: moveError } = await admin
      .from("cloud_files")
      .update({ category: "Other" })
      .eq("user_id", user.id)
      .eq("category", category.name);
    if (moveError) throw moveError;

    const { error: renewalMoveError } = await admin
      .from("renewals")
      .update({ category: "Other" })
      .eq("user_id", user.id)
      .eq("category", category.name);
    if (renewalMoveError) throw renewalMoveError;

    const { error: deleteError } = await admin
      .from("chatcloud_categories")
      .delete()
      .eq("id", category.id)
      .eq("user_id", user.id);
    if (deleteError) throw deleteError;
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[chatcloud] category deletion failed:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Could not delete that category." }, { status: 500 });
  }
}
