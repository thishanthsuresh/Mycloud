import { analyzeFile } from "@/lib/chatcloud/ai";
import { STORAGE_BUCKET } from "@/lib/chatcloud/constants";
import { getOrCreateUserCategories } from "@/lib/chatcloud/user-categories";
import { addDaysISO } from "@/lib/chatcloud/utils";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

export async function POST(_req: Request, context: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });

  const { id } = await context.params;
  const admin = createAdminClient();
  const { data: file, error: fileError } = await admin
    .from("cloud_files")
    .select("id, user_id, display_name, original_name, category, mime_type, size_bytes, storage_path")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (fileError) {
    console.error("[chatcloud] could not load file for analysis:", fileError.message);
    return Response.json({ error: "Could not load this file for analysis." }, { status: 500 });
  }
  if (!file) return Response.json({ error: "File not found." }, { status: 404 });

  const { data: existingRenewals, error: renewalLookupError } = await admin
    .from("renewals")
    .select("id")
    .eq("user_id", user.id)
    .eq("file_id", file.id)
    .limit(1);
  if (renewalLookupError) {
    console.error("[chatcloud] could not check linked renewals:", renewalLookupError.message);
    if (renewalLookupError.message.includes("permission denied for table renewals")) {
      return Response.json({
        error: "The Supabase service role cannot access the renewals table. Run the latest lib/supabase/chatcloud-enhancements.sql in the Supabase SQL Editor, then retry.",
      }, { status: 500 });
    }
    return Response.json({ error: "Could not check whether this file already has a renewal." }, { status: 500 });
  }
  if (existingRenewals?.length) return Response.json({ status: "already-linked" });

  if (file.size_bytes > 5 * 1024 * 1024) {
    return Response.json({ status: "unavailable", notice: "File is over the 5 MB Gemini analysis limit." });
  }

  const { data: blob, error: downloadError } = await admin.storage
    .from(STORAGE_BUCKET)
    .download(file.storage_path);
  if (downloadError || !blob) {
    console.error("[chatcloud] could not download file for analysis:", downloadError?.message ?? "file data missing");
    return Response.json({ error: "Could not read this file from storage." }, { status: 500 });
  }

  try {
    const categories = await getOrCreateUserCategories(user.id);
    const analysis = await analyzeFile({
      bytes: new Uint8Array(await blob.arrayBuffer()),
      originalName: file.original_name,
      mimeType: file.mime_type || "application/octet-stream",
      categories,
    });

    if (!analysis.usedAi) {
      return Response.json({ status: "unavailable", notice: analysis.aiNotice ?? "Gemini could not analyze this file." });
    }
    if (!analysis.expiryDate) return Response.json({ status: "no-date" });

    const { error: insertError } = await admin.from("renewals").insert({
      user_id: user.id,
      file_id: file.id,
      title: file.display_name,
      category: file.category,
      due_date: analysis.expiryDate,
      remind_days_before: 14,
      remind_at: `${addDaysISO(analysis.expiryDate, -14)}T09:00:00.000Z`,
    });
    if (insertError) {
      console.error("[chatcloud] could not create renewal from existing file:", insertError.message);
      if (insertError.message.includes("permission denied for table renewals")) {
        return Response.json({
          error: "The Supabase service role cannot add renewals. Run the latest lib/supabase/chatcloud-enhancements.sql in the Supabase SQL Editor, then retry.",
        }, { status: 500 });
      }
      return Response.json({ error: "Gemini found a date, but the renewal could not be saved." }, { status: 500 });
    }
    return Response.json({ status: "renewal-created", dueDate: analysis.expiryDate });
  } catch (err) {
    console.error("[chatcloud] existing file analysis failed:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Could not analyze this file." }, { status: 500 });
  }
}
