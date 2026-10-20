// Upload from the website (AI name -> storage -> database).
import { createClient } from "@/lib/supabase/server";
import { getOrCreateUserCategories } from "@/lib/chatcloud/user-categories";
import { MAX_WEB_UPLOAD_BYTES } from "@/lib/chatcloud/constants";
import { ingestFile } from "@/lib/chatcloud/ingest";

export const maxDuration = 60;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file received." }, { status: 400 });
  if (file.size === 0) return Response.json({ error: "That file is empty." }, { status: 400 });
  if (file.size > MAX_WEB_UPLOAD_BYTES) {
    return Response.json({ error: "Files uploaded here must be under 4 MB." }, { status: 413 });
  }

  try {
    const categories = await getOrCreateUserCategories(user.id);
    const result = await ingestFile({
      userId: user.id,
      bytes: new Uint8Array(await file.arrayBuffer()),
      originalName: file.name || "file",
      mimeType: file.type || "application/octet-stream",
      categories,
    });
    return Response.json({
      file: result.file,
      renewalDue: result.renewalDue,
      aiIdentification: result.aiIdentification,
      aiNotice: result.aiNotice,
    });
  } catch (err) {
    console.error("[chatcloud] upload failed:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Could not save the file. Please try again." }, { status: 500 });
  }
}
