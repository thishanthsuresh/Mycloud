import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const STORAGE_BUCKET = "financial-bills";
const MAX_BILL_BYTES = 4 * 1024 * 1024;
const MAX_AMOUNT = 9_999_999_999.99;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const ALLOWED_CATEGORIES = new Set(["Housing", "Utilities", "Groceries", "Healthcare", "Transport", "Subscriptions", "Other"]);

function cleanFileName(value: string) {
  return value.replace(/[\\/]/g, "_").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200).trim() || "bill";
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[financial] bills authentication failed:", authError.message);
    return Response.json({ error: "Could not verify your account." }, { status: 401 });
  }
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("financial_bills")
      .select("id, vendor, amount, category, attachment_path, attachment_name, attachment_type, attachment_size, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;

    const bills = await Promise.all((data ?? []).map(async (bill) => {
      if (!bill.attachment_path) return { ...bill, attachmentUrl: null };
      const { data: signed, error: signedError } = await admin.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(bill.attachment_path, 60 * 60);
      if (signedError || !signed) throw signedError ?? new Error("Could not create a bill attachment link.");
      return { ...bill, attachmentUrl: signed.signedUrl };
    }));
    return Response.json({ bills });
  } catch (error) {
    console.error("[financial] bills load failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not load bills. Run lib/supabase/financial-manager.sql in Supabase." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[financial] bill creation authentication failed:", authError.message);
    return Response.json({ error: "Could not verify your account." }, { status: 401 });
  }
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const vendorValue = form?.get("vendor");
  const categoryValue = form?.get("category");
  const amountValue = form?.get("amount");
  const attachmentValue = form?.get("file");
  const vendor = typeof vendorValue === "string" ? vendorValue.trim() : "";
  const category = typeof categoryValue === "string" ? categoryValue.trim() : "";
  const amount = typeof amountValue === "string" ? Number(amountValue) : Number.NaN;
  const file = attachmentValue instanceof File && attachmentValue.size > 0 ? attachmentValue : null;

  if (!vendor || vendor.length > 160) return Response.json({ error: "Enter a vendor name (up to 160 characters)." }, { status: 400 });
  if (!ALLOWED_CATEGORIES.has(category)) return Response.json({ error: "Choose a valid expense category." }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    return Response.json({ error: "Enter an amount greater than zero." }, { status: 400 });
  }
  if (file && file.size > MAX_BILL_BYTES) return Response.json({ error: "Bill files must be 4 MB or smaller." }, { status: 413 });
  if (file && !ALLOWED_TYPES.has(file.type)) {
    return Response.json({ error: "Use a JPEG, PNG, WebP image, or PDF attachment." }, { status: 415 });
  }

  let admin: ReturnType<typeof createAdminClient> | null = null;
  let attachmentPath: string | null = null;
  try {
    admin = createAdminClient();
    const fileName = file ? cleanFileName(file.name) : null;
    if (file) {
      const extension = file.type === "application/pdf" ? ".pdf"
        : file.type === "image/jpeg" ? ".jpg"
          : file.type === "image/png" ? ".png" : ".webp";
      attachmentPath = `${user.id}/${crypto.randomUUID()}${extension}`;
      const { error: uploadError } = await admin.storage.from(STORAGE_BUCKET).upload(
        attachmentPath,
        new Uint8Array(await file.arrayBuffer()),
        { contentType: file.type, upsert: false },
      );
      if (uploadError) throw uploadError;
    }

    const { data, error } = await admin
      .from("financial_bills")
      .insert({
        user_id: user.id,
        vendor,
        amount: Math.round(amount * 100) / 100,
        category,
        attachment_path: attachmentPath,
        attachment_name: fileName,
        attachment_type: file?.type ?? null,
        attachment_size: file?.size ?? null,
      })
      .select("id, vendor, amount, category, attachment_path, attachment_name, attachment_type, attachment_size, created_at")
      .single();
    if (error) throw error;
    return Response.json({ bill: { ...data, attachmentUrl: null } }, { status: 201 });
  } catch (error) {
    if (admin && attachmentPath) {
      const { error: cleanupError } = await admin.storage.from(STORAGE_BUCKET).remove([attachmentPath]);
      if (cleanupError) console.error("[financial] orphan bill attachment cleanup failed:", cleanupError.message);
    }
    console.error("[financial] bill creation failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not save this bill. Check the Financial Manager database and storage setup." }, { status: 500 });
  }
}
