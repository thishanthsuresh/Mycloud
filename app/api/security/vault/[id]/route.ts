import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { STORAGE_BUCKET } from "@/lib/chatcloud/constants";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, context: RouteContext<"/api/security/vault/[id]">) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[security] vault download authentication failed:", authError.message);
    return Response.json({ error: "Could not verify your account." }, { status: 401 });
  }
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return Response.json({ error: "A valid vault file is required." }, { status: 400 });
  try {
    const admin = createAdminClient();
    const { data: file, error } = await admin
      .from("security_vault_files")
      .select("storage_path")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!file) return Response.json({ error: "Vault file not found." }, { status: 404 });

    const { data, error: signedUrlError } = await admin.storage.from(STORAGE_BUCKET).createSignedUrl(file.storage_path, 60);
    if (signedUrlError || !data) throw signedUrlError ?? new Error("Could not create a download link.");
    return Response.json({ url: data.signedUrl });
  } catch (error) {
    console.error("[security] vault download link failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not access this vault file." }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext<"/api/security/vault/[id]">) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[security] vault visibility authentication failed:", authError.message);
    return Response.json({ error: "Could not verify your account." }, { status: 401 });
  }
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return Response.json({ error: "A valid vault file is required." }, { status: 400 });
  const body = await request.json().catch(() => null) as { isHidden?: unknown } | null;
  if (typeof body?.isHidden !== "boolean") {
    return Response.json({ error: "Choose whether this file should be hidden from ChatCloud." }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const { data: vaultFile, error: vaultError } = await admin
      .from("security_vault_files")
      .select("original_file_id")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (vaultError) throw vaultError;
    if (!vaultFile) return Response.json({ error: "Vault file not found." }, { status: 404 });

    const { data: updated, error: updateError } = await admin
      .from("cloud_files")
      .update({ is_hidden: body.isHidden })
      .eq("id", vaultFile.original_file_id)
      .eq("user_id", user.id)
      .eq("is_vaulted", true)
      .select("id")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) return Response.json({ error: "The file is no longer in your vault." }, { status: 409 });
    return Response.json({ ok: true, isHidden: body.isHidden });
  } catch (error) {
    console.error("[security] vault visibility update failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not update this file's ChatCloud visibility." }, { status: 500 });
  }
}
