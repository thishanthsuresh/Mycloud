import { CATEGORIES } from "@/lib/chatcloud/categories";
import { createAdminClient } from "@/lib/supabase/admin";

export async function getOrCreateUserCategories(userId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("chatcloud_categories")
    .select("name")
    .eq("user_id", userId)
    .order("name");
  if (error) throw new Error(`Could not load categories: ${error.message}`);
  if (data?.length) return data.map((category) => category.name);

  const { error: seedError } = await admin
    .from("chatcloud_categories")
    .upsert(CATEGORIES.map((name) => ({ user_id: userId, name })), {
      onConflict: "user_id,name",
      ignoreDuplicates: true,
    });
  if (seedError) throw new Error(`Could not initialize categories: ${seedError.message}`);

  const { data: initialized, error: reloadError } = await admin
    .from("chatcloud_categories")
    .select("name")
    .eq("user_id", userId)
    .order("name");
  if (reloadError) throw new Error(`Could not load initialized categories: ${reloadError.message}`);
  return (initialized ?? []).map((category) => category.name);
}
