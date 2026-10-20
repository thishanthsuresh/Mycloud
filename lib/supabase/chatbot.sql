CREATE TABLE IF NOT EXISTS public.chatbot_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id)
);

CREATE INDEX IF NOT EXISTS chatbot_conversations_user_updated_idx
  ON public.chatbot_conversations (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.chatbot_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.chatbot_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL CHECK (length(content) BETWEEN 1 AND 12000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chatbot_messages_conversation_owner_fk
    FOREIGN KEY (conversation_id, user_id)
    REFERENCES public.chatbot_conversations(id, user_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS chatbot_messages_conversation_created_idx
  ON public.chatbot_messages (conversation_id, created_at);

ALTER TABLE public.chatbot_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chatbot_messages ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.chatbot_conversations TO authenticated;
GRANT SELECT ON public.chatbot_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chatbot_conversations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chatbot_messages TO service_role;

DROP POLICY IF EXISTS "Users can view their chatbot conversations" ON public.chatbot_conversations;
CREATE POLICY "Users can view their chatbot conversations"
  ON public.chatbot_conversations FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can view their chatbot messages" ON public.chatbot_messages;
CREATE POLICY "Users can view their chatbot messages"
  ON public.chatbot_messages FOR SELECT TO authenticated
  USING (user_id = auth.uid());
