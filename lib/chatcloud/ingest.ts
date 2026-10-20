// SERVER ONLY. The pipeline every new file goes through:
//   AI name/category -> upload to private storage -> save the database row -> maybe create a renewal.
import { createAdminClient } from "@/lib/supabase/admin";
import type { CloudFile } from "@/types/chatcloud";
import { analyzeFile } from "./ai";
import { STORAGE_BUCKET } from "./constants";
import { addDaysISO, extFromMime, splitName } from "./utils";

export type IngestInput = {
  userId: string;
  bytes: Uint8Array;
  originalName: string;
  mimeType: string;
  categories: string[];
};

export type IngestResult = {
  file: CloudFile;
  renewalDue: string | null;
  aiIdentification: string | null;
  aiNotice: string | null;
};

export async function ingestFile(input: IngestInput): Promise<IngestResult> {
  const admin = createAdminClient();

  const analysis = await analyzeFile({
    bytes: input.bytes,
    originalName: input.originalName,
    mimeType: input.mimeType,
    categories: input.categories,
  });

  const ext = splitName(input.originalName).ext || extFromMime(input.mimeType);
  const displayName = ext ? `${analysis.name}.${ext}` : analysis.name;
  // Files live under a folder named after the user: <user id>/<random>.<ext>. The storage policy relies on that.
  const storagePath = `${input.userId}/${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;

  const upload = await admin.storage.from(STORAGE_BUCKET).upload(storagePath, input.bytes, {
    contentType: input.mimeType,
    upsert: false,
  });
  if (upload.error) throw new Error(`Storage upload failed: ${upload.error.message}`);

  const { data: row, error } = await admin
    .from("cloud_files")
    .insert({
      user_id: input.userId,
      display_name: displayName,
      original_name: input.originalName,
      category: analysis.category,
      mime_type: input.mimeType,
      size_bytes: input.bytes.byteLength,
      storage_path: storagePath,
      source: "upload",
      ai_status: analysis.usedAi ? "ai" : "fallback",
    })
    .select()
    .single();

  if (error || !row) {
    await admin.storage.from(STORAGE_BUCKET).remove([storagePath]); // don't leave an orphan file behind
    throw new Error(`Could not save file record: ${error?.message ?? "unknown error"}`);
  }

  // The AI spotted an expiry/renewal date -> create a renewal with a 14-day reminder.
  let renewalDue: string | null = null;
  if (analysis.expiryDate) {
    const { error: renewalError } = await admin.from("renewals").insert({
      user_id: input.userId,
      file_id: row.id,
      title: analysis.name,
      category: analysis.category,
      due_date: analysis.expiryDate,
      remind_days_before: 14,
      remind_at: `${addDaysISO(analysis.expiryDate, -14)}T09:00:00.000Z`,
    });
    if (renewalError) console.error("[chatcloud] could not create renewal:", renewalError.message);
    else renewalDue = analysis.expiryDate;
  }

  return {
    file: row as CloudFile,
    renewalDue,
    aiIdentification: analysis.identification,
    aiNotice: analysis.aiNotice,
  };
}
