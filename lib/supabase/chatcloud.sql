-- 1. Ensure table grants are active for the authenticated API role
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cloud_files TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.renewals TO authenticated;

-- The server-side ingestion pipeline writes with the Supabase service-role key.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cloud_files TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.renewals TO service_role;

-- 2. Grant usage on sequences if any
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- 3. Re-verify Row Level Security is active
ALTER TABLE public.cloud_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.renewals ENABLE ROW LEVEL SECURITY;