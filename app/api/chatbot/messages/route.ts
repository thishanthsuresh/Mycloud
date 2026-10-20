import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { answerChatCloudQuestion, type ChatCloudContext, type ChatTurn } from "@/lib/chatbot/ai";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.error("[chatbot] message authentication failed:", authError.message);
    return Response.json({ error: "Could not verify your account." }, { status: 401 });
  }
  if (!user) return Response.json({ error: "Please sign in first." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { question?: unknown; conversationId?: unknown } | null;
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question || question.length > 2000) {
    return Response.json({ error: "Questions must be between 1 and 2,000 characters." }, { status: 400 });
  }
  const requestedConversationId = body?.conversationId;
  if (
    requestedConversationId !== undefined &&
    requestedConversationId !== null &&
    (typeof requestedConversationId !== "string" || !UUID_PATTERN.test(requestedConversationId))
  ) {
    return Response.json({ error: "A valid conversation is required." }, { status: 400 });
  }

  const admin = createAdminClient();
  try {
    const [filesResult, renewalsResult] = await Promise.all([
      admin.from("cloud_files")
        .select("display_name, original_name, category, mime_type, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(100),
      admin.from("renewals")
        .select("title, category, due_date, status, file_id")
        .eq("user_id", user.id)
        .order("due_date", { ascending: true })
        .limit(100),
    ]);
    if (filesResult.error) throw filesResult.error;
    if (renewalsResult.error) throw renewalsResult.error;

    const files = filesResult.data ?? [];
    const renewals = renewalsResult.data ?? [];
    const fileIdsById = new Map<string, string>();
    if (renewals.some((renewal) => renewal.file_id)) {
      const { data: linkedFiles, error: linkedFilesError } = await admin
        .from("cloud_files")
        .select("id, display_name")
        .eq("user_id", user.id)
        .in("id", renewals.flatMap((renewal) => renewal.file_id ? [renewal.file_id] : []));
      if (linkedFilesError) throw linkedFilesError;
      for (const file of linkedFiles ?? []) fileIdsById.set(file.id, file.display_name);
    }

    const context: ChatCloudContext = {
      files: files.map((file) => ({
        name: file.display_name,
        originalName: file.original_name,
        category: file.category,
        mimeType: file.mime_type,
        addedAt: file.created_at,
      })),
      renewals: renewals.map((renewal) => ({
        title: renewal.title,
        category: renewal.category,
        dueDate: renewal.due_date,
        status: renewal.status,
        linkedFile: renewal.file_id ? fileIdsById.get(renewal.file_id) ?? null : null,
      })),
      categories: [...new Set(files.map((file) => file.category))].sort(),
      fileCount: files.length,
      renewalCount: renewals.length,
    };

    let conversationId = typeof body?.conversationId === "string" ? body.conversationId : null;
    let history: ChatTurn[] = [];
    if (conversationId) {
      const { data: conversation, error: conversationError } = await admin
        .from("chatbot_conversations")
        .select("id")
        .eq("id", conversationId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (conversationError) throw conversationError;
      if (!conversation) return Response.json({ error: "Conversation not found." }, { status: 404 });

      const { data: previousMessages, error: historyError } = await admin
        .from("chatbot_messages")
        .select("role, content")
        .eq("conversation_id", conversationId)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (historyError) throw historyError;
      history = (previousMessages ?? []).reverse() as ChatTurn[];
    }

    const answer = await answerChatCloudQuestion({ question, history, context });
    const title = question.replace(/\s+/g, " ").slice(0, 80);
    if (!conversationId) {
      const { data: created, error: createError } = await admin
        .from("chatbot_conversations")
        .insert({ user_id: user.id, title })
        .select("id")
        .single();
      if (createError) throw createError;
      conversationId = created.id;
    }

    const { data: messages, error: insertError } = await admin
      .from("chatbot_messages")
      .insert([
        { conversation_id: conversationId, user_id: user.id, role: "user", content: question },
        { conversation_id: conversationId, user_id: user.id, role: "assistant", content: answer },
      ])
      .select("id, role, content, created_at");
    if (insertError) throw insertError;

    const { error: updateError } = await admin
      .from("chatbot_conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId)
      .eq("user_id", user.id);
    if (updateError) throw updateError;

    return Response.json({ conversationId, messages: messages ?? [] }, { status: 201 });
  } catch (error) {
    console.error("[chatbot] answer generation failed:", error instanceof Error ? error.message : error);
    const message = error instanceof Error ? error.message : "";
    if (message.includes("not configured")) {
      return Response.json({ error: message }, { status: 503 });
    }
    if (/API_KEY_INVALID|API key not valid|401|403|permission denied|unauthorized/i.test(message)) {
      return Response.json({ error: "Gemini rejected the configured API key. Check the server-side GEMINI_API_KEY setting." }, { status: 502 });
    }
    if (/temporarily|timed?\s*out|503|UNAVAILABLE/i.test(message)) {
      return Response.json({ error: "The AI assistant is temporarily unavailable. Please try again shortly." }, { status: 503 });
    }
    return Response.json({ error: "Could not answer that question. Please try again." }, { status: 500 });
  }
}
