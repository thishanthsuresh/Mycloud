CREATE TABLE IF NOT EXISTS public.financial_savings_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  target_amount numeric(12, 2) NOT NULL CHECK (target_amount > 0),
  saved_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (saved_amount >= 0),
  target_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS financial_savings_goals_user_created_idx
  ON public.financial_savings_goals (user_id, created_at DESC);

ALTER TABLE public.financial_savings_goals ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.financial_savings_goals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_savings_goals TO service_role;
DROP POLICY IF EXISTS "Users can view their own savings goals" ON public.financial_savings_goals;
CREATE POLICY "Users can view their own savings goals"
  ON public.financial_savings_goals FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.financial_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vendor text NOT NULL CHECK (length(btrim(vendor)) BETWEEN 1 AND 160),
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  category text NOT NULL CHECK (length(btrim(category)) BETWEEN 1 AND 60),
  attachment_path text UNIQUE,
  attachment_name text,
  attachment_type text,
  attachment_size bigint CHECK (attachment_size IS NULL OR attachment_size > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS financial_bills_user_created_idx
  ON public.financial_bills (user_id, created_at DESC);

ALTER TABLE public.financial_bills ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.financial_bills TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_bills TO service_role;
DROP POLICY IF EXISTS "Users can view their own bills" ON public.financial_bills;
CREATE POLICY "Users can view their own bills"
  ON public.financial_bills FOR SELECT TO authenticated
  USING (user_id = auth.uid());

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'financial-bills',
  'financial-bills',
  false,
  4194304,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
