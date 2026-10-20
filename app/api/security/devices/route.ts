import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDeviceName } from "@/lib/security/device";

const DEVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isSecurityMigrationMissing(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const databaseError = error as { code?: unknown; message?: unknown };
  return (
    databaseError.code === "42P01" ||
    databaseError.code === "42703" ||
    databaseError.code === "PGRST204" ||
    databaseError.code === "PGRST205" ||
    (typeof databaseError.message === "string" &&
      /security_devices.*does not exist|column .* does not exist/i.test(databaseError.message))
  );
}

function migrationResponse() {
  return Response.json(
    { error: "Device history is not set up yet. Run lib/supabase/security-vault.sql in the Supabase SQL Editor." },
    { status: 503 },
  );
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[security] device list authentication failed:", authError.message);
    return Response.json({ error: "Could not verify your account." }, { status: 401 });
  }
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });

  try {
    const { data, error } = await createAdminClient()
      .from("security_devices")
      .select("id, client_device_id, device_name, first_seen_at, last_seen_at")
      .eq("user_id", user.id)
      .order("last_seen_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return Response.json({ devices: data ?? [] });
  } catch (error) {
    console.error("[security] device list failed:", error instanceof Error ? error.message : error);
    if (isSecurityMigrationMissing(error)) return migrationResponse();
    return Response.json({ error: "Could not load signed-in devices." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[security] device sign-in authentication failed:", authError.message);
    return Response.json({ error: "Could not verify your account." }, { status: 401 });
  }
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });

  const body = await request.json().catch(() => null) as { clientDeviceId?: unknown } | null;
  if (typeof body?.clientDeviceId !== "string" || !DEVICE_ID_PATTERN.test(body.clientDeviceId)) {
    return Response.json({ error: "A valid device identifier is required." }, { status: 400 });
  }

  try {
    const userAgent = request.headers.get("user-agent") ?? "";
    const { error } = await createAdminClient()
      .from("security_devices")
      .upsert({
        user_id: user.id,
        client_device_id: body.clientDeviceId,
        device_name: getDeviceName(userAgent),
        user_agent: userAgent.slice(0, 1000),
        last_seen_at: new Date().toISOString(),
      }, { onConflict: "user_id,client_device_id" });
    if (error) throw error;
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error("[security] device sign-in record failed:", error instanceof Error ? error.message : error);
    if (isSecurityMigrationMissing(error)) return migrationResponse();
    return Response.json({ error: "Could not record this device sign-in." }, { status: 500 });
  }
}
