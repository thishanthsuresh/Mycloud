CREATE TABLE IF NOT EXISTS public.security_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_device_id text NOT NULL CHECK (length(client_device_id) BETWEEN 16 AND 100),
  device_name text NOT NULL CHECK (length(device_name) BETWEEN 1 AND 160),
  user_agent text NOT NULL DEFAULT '',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_device_id)
);

CREATE INDEX IF NOT EXISTS security_devices_user_last_seen_idx
  ON public.security_devices (user_id, last_seen_at DESC);

ALTER TABLE public.security_devices ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.security_devices TO service_role;

ALTER TABLE public.cloud_files
  ADD COLUMN IF NOT EXISTS is_vaulted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.security_vault_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  original_file_id uuid NOT NULL UNIQUE REFERENCES public.cloud_files(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 200),
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  encryption_salt text NOT NULL,
  encryption_iv text NOT NULL,
  pin_digits smallint NOT NULL DEFAULT 8 CHECK (pin_digits IN (4, 8)),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.security_vault_files
  ADD COLUMN IF NOT EXISTS pin_digits smallint NOT NULL DEFAULT 8 CHECK (pin_digits IN (4, 8));

CREATE INDEX IF NOT EXISTS security_vault_files_user_created_idx
  ON public.security_vault_files (user_id, created_at DESC);

ALTER TABLE public.security_vault_files ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.security_vault_files TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.security_vault_files TO service_role;
DROP POLICY IF EXISTS "Users can view their own vault files" ON public.security_vault_files;
CREATE POLICY "Users can view their own vault files"
  ON public.security_vault_files FOR SELECT TO authenticated
  USING (user_id = auth.uid());

ALTER TABLE public.messenger_messages
  ADD COLUMN IF NOT EXISTS is_encrypted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS encryption_salt text,
  ADD COLUMN IF NOT EXISTS encryption_iv text,
  ADD COLUMN IF NOT EXISTS pin_digits smallint NOT NULL DEFAULT 8 CHECK (pin_digits IN (4, 8)),
  ADD COLUMN IF NOT EXISTS original_mime_type text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'messenger-media',
  'messenger-media',
  false,
  10485760,
  ARRAY['image/*', 'video/*', 'audio/*', 'application/pdf', 'application/octet-stream']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
