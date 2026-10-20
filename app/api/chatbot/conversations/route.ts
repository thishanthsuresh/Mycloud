import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[chatbot] history authentication failed:", authError.message);
    return Response.json({ error: "Could not verify your account." }, { status: 401 });
  }
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });

  const conversationId = new URL(request.url).searchParams.get("conversationId");
  try {
    const admin = createAdminClient();
    if (conversationId) {
      if (!UUID_PATTERN.test(conversationId)) {
        return Response.json({ error: "A valid conversation is required." }, { status: 400 });
      }
      const { data: conversation, error: conversationError } = await admin
        .from("chatbot_conversations")
        .select("id, title, created_at, updated_at")
        .eq("id", conversationId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (conversationError) throw conversationError;
      if (!conversation) return Response.json({ error: "Conversation not found." }, { status: 404 });
      const { data: messages, error: messagesError } = await admin
        .from("chatbot_messages")
        .select("id, role, content, created_at")
        .eq("conversation_id", conversation.id)
        .eq("user_id", user.id)
        .order("created_at", { ascending: true })
        .limit(200);
      if (messagesError) throw messagesError;
      return Response.json({ conversation, messages: messages ?? [] });
    }

    const { data, error } = await admin
      .from("chatbot_conversations")
      .select("id, title, created_at, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return Response.json({ conversations: data ?? [] });
  } catch (error) {
    console.error("[chatbot] history load failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not load chat history." }, { status: 500 });
  }
}
