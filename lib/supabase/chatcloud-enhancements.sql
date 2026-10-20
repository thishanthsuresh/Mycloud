-- Run this migration in the Supabase SQL Editor before using custom categories,
-- file usage sorting, or saved renewal reminder schedules.

CREATE TABLE IF NOT EXISTS public.chatcloud_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 40),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE UNIQUE INDEX IF NOT EXISTS chatcloud_categories_user_name_ci
  ON public.chatcloud_categories (user_id, lower(name));

ALTER TABLE public.chatcloud_categories ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.chatcloud_categories TO service_role;

ALTER TABLE public.cloud_files
  ADD COLUMN IF NOT EXISTS last_accessed_at timestamptz;

ALTER TABLE public.renewals
  ADD COLUMN IF NOT EXISTS remind_at timestamptz;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.renewals TO service_role;
