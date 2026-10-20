CREATE TABLE IF NOT EXISTS public.messenger_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE,
  display_name text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.messenger_profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.messenger_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messenger_profiles TO service_role;
DROP POLICY IF EXISTS "Users can view their own Messenger profile" ON public.messenger_profiles;
CREATE POLICY "Users can view their own Messenger profile"
  ON public.messenger_profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.sync_messenger_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.messenger_profiles (user_id, email, display_name, updated_at)
  VALUES (
    NEW.id,
    lower(NEW.email),
    coalesce(
      nullif(btrim(NEW.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(NEW.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(NEW.email, ''), '@', 1), ''),
      'MyCloud user'
    ),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET email = excluded.email,
      display_name = excluded.display_name,
      updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_messenger_profile ON auth.users;
CREATE TRIGGER on_auth_user_messenger_profile
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_messenger_profile();

INSERT INTO public.messenger_profiles (user_id, email, display_name)
SELECT
  id,
  lower(email),
  coalesce(
    nullif(btrim(raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(email, ''), '@', 1), ''),
    'MyCloud user'
  )
FROM auth.users
ON CONFLICT (user_id) DO UPDATE
SET email = excluded.email,
    display_name = excluded.display_name,
    updated_at = now();

CREATE TABLE IF NOT EXISTS public.messenger_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_one uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_two uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT messenger_conversations_sorted_users CHECK (user_one <= user_two),
  CONSTRAINT messenger_conversations_unique_pair UNIQUE (user_one, user_two)
);

CREATE TABLE IF NOT EXISTS public.messenger_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.messenger_conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL DEFAULT '',
  media_path text,
  media_name text,
  media_type text,
  media_size bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT messenger_messages_content_check CHECK (
    length(body) <= 4000 AND (length(btrim(body)) > 0 OR media_path IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS messenger_messages_conversation_created_idx
  ON public.messenger_messages (conversation_id, created_at DESC);

ALTER TABLE public.messenger_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messenger_messages ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.messenger_conversations TO authenticated;
GRANT SELECT ON public.messenger_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messenger_conversations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messenger_messages TO service_role;

DROP POLICY IF EXISTS "Participants can view Messenger conversations" ON public.messenger_conversations;
CREATE POLICY "Participants can view Messenger conversations"
  ON public.messenger_conversations FOR SELECT TO authenticated
  USING (auth.uid() = user_one OR auth.uid() = user_two);

DROP POLICY IF EXISTS "Participants can view Messenger messages" ON public.messenger_messages;
CREATE POLICY "Participants can view Messenger messages"
  ON public.messenger_messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.messenger_conversations c
      WHERE c.id = conversation_id
        AND (auth.uid() = c.user_one OR auth.uid() = c.user_two)
    )
  );

CREATE OR REPLACE FUNCTION public.touch_messenger_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.messenger_conversations
  SET updated_at = NEW.created_at
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_messenger_message_created ON public.messenger_messages;
CREATE TRIGGER on_messenger_message_created
  AFTER INSERT ON public.messenger_messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_messenger_conversation();

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'messenger-media',
  'messenger-media',
  false,
  10485760,
  ARRAY['image/*', 'video/*', 'audio/*', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
