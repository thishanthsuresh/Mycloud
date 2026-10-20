import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[messenger] conversation authentication failed:", authError.message);
    return Response.json({ error: "Could not verify your account." }, { status: 401 });
  }
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });

  try {
    const admin = createAdminClient();
    const { data: conversations, error } = await admin
      .from("messenger_conversations")
      .select("id, user_one, user_two, created_at, updated_at")
      .or(`user_one.eq.${user.id},user_two.eq.${user.id}`)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw error;

    const participantIds = [...new Set((conversations ?? []).flatMap((item) => [item.user_one, item.user_two]))];
    const { data: profiles, error: profileError } = participantIds.length
      ? await admin.from("messenger_profiles").select("user_id, email, display_name").in("user_id", participantIds)
      : { data: [], error: null };
    if (profileError) throw profileError;

    const profileById = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));
    return Response.json({
      userId: user.id,
      conversations: (conversations ?? []).map((conversation) => {
        const otherId = conversation.user_one === user.id ? conversation.user_two : conversation.user_one;
        return { ...conversation, otherUser: profileById.get(otherId) ?? null };
      }),
    });
  } catch (error) {
    console.error("[messenger] conversation load failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not load your conversations." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[messenger] conversation authentication failed:", authError.message);
    return Response.json({ error: "Could not verify your account." }, { status: 401 });
  }
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { recipientId?: unknown } | null;
  if (typeof body?.recipientId !== "string" || !UUID_PATTERN.test(body.recipientId)) {
    return Response.json({ error: "A valid recipient is required." }, { status: 400 });
  }

  try {
    const recipientId = body.recipientId.toLowerCase();
    if (recipientId !== user.id) {
      const admin = createAdminClient();
      const { data: recipient, error: recipientError } = await admin
        .from("messenger_profiles")
        .select("user_id")
        .eq("user_id", recipientId)
        .maybeSingle();
      if (recipientError) throw recipientError;
      if (!recipient) return Response.json({ error: "That user is not available on MyCloud." }, { status: 404 });
    }

    const [userOne, userTwo] = [user.id, recipientId].sort();
    const admin = createAdminClient();
    const { data: existing, error: lookupError } = await admin
      .from("messenger_conversations")
      .select("id")
      .eq("user_one", userOne)
      .eq("user_two", userTwo)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (existing) return Response.json({ conversationId: existing.id });

    const { data: conversation, error: insertError } = await admin
      .from("messenger_conversations")
      .insert({ user_one: userOne, user_two: userTwo })
      .select("id")
      .single();
    if (insertError?.code === "23505") {
      const { data: raced, error: racedError } = await admin
        .from("messenger_conversations")
        .select("id")
        .eq("user_one", userOne)
        .eq("user_two", userTwo)
        .single();
      if (racedError) throw racedError;
      return Response.json({ conversationId: raced.id });
    }
    if (insertError) throw insertError;
    return Response.json({ conversationId: conversation.id }, { status: 201 });
  } catch (error) {
    console.error("[messenger] conversation creation failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not start that conversation." }, { status: 500 });
  }
}
