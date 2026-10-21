CREATE TABLE IF NOT EXISTS public.professional_organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.professional_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.professional_organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('manager', 'employee')),
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active')),
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, email)
);

CREATE UNIQUE INDEX IF NOT EXISTS professional_members_org_user_idx
  ON public.professional_members (organization_id, user_id)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS professional_members_user_status_idx
  ON public.professional_members (user_id, status);
CREATE INDEX IF NOT EXISTS professional_members_email_status_idx
  ON public.professional_members (lower(email), status);

CREATE TABLE IF NOT EXISTS public.professional_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.professional_organizations(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  due_date date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'submitted', 'approved', 'changes_requested')),
  assigned_member_id uuid NOT NULL REFERENCES public.professional_members(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  attachment_path text UNIQUE,
  attachment_name text,
  attachment_type text,
  attachment_size bigint CHECK (attachment_size IS NULL OR attachment_size > 0),
  submitted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS professional_requests_org_created_idx
  ON public.professional_requests (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS professional_requests_assigned_status_idx
  ON public.professional_requests (assigned_member_id, status);

CREATE TABLE IF NOT EXISTS public.professional_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.professional_organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS professional_folders_org_created_idx
  ON public.professional_folders (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.professional_folder_access (
  folder_id uuid NOT NULL REFERENCES public.professional_folders(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.professional_members(id) ON DELETE CASCADE,
  granted_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (folder_id, member_id)
);

CREATE TABLE IF NOT EXISTS public.professional_folder_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id uuid NOT NULL REFERENCES public.professional_folders(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL CHECK (length(btrim(file_name)) BETWEEN 1 AND 200),
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS professional_folder_files_folder_created_idx
  ON public.professional_folder_files (folder_id, created_at DESC);

ALTER TABLE public.professional_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professional_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professional_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professional_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professional_folder_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professional_folder_files ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.professional_organizations TO authenticated;
GRANT SELECT ON public.professional_members TO authenticated;
GRANT SELECT ON public.professional_requests TO authenticated;
GRANT SELECT ON public.professional_folders TO authenticated;
GRANT SELECT ON public.professional_folder_access TO authenticated;
GRANT SELECT ON public.professional_folder_files TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.professional_organizations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.professional_members TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.professional_requests TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.professional_folders TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.professional_folder_access TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.professional_folder_files TO service_role;

DROP POLICY IF EXISTS "Organization members can view organizations" ON public.professional_organizations;
CREATE POLICY "Organization members can view organizations"
  ON public.professional_organizations FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.professional_members m
      WHERE m.organization_id = professional_organizations.id
        AND m.user_id = auth.uid() AND m.status = 'active'
    )
  );

DROP POLICY IF EXISTS "Users can view their professional membership" ON public.professional_members;
CREATE POLICY "Users can view their professional membership"
  ON public.professional_members FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Assigned staff can view their requests" ON public.professional_requests;
CREATE POLICY "Assigned staff can view their requests"
  ON public.professional_requests FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.professional_members m
      WHERE m.id = assigned_member_id AND m.user_id = auth.uid() AND m.status = 'active'
    )
    OR EXISTS (
      SELECT 1 FROM public.professional_members m
      WHERE m.organization_id = professional_requests.organization_id
        AND m.user_id = auth.uid() AND m.status = 'active' AND m.role = 'manager'
    )
  );

DROP POLICY IF EXISTS "Organization members can view shared folders" ON public.professional_folders;
CREATE POLICY "Organization members can view shared folders"
  ON public.professional_folders FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.professional_members m
      WHERE m.organization_id = professional_folders.organization_id
        AND m.user_id = auth.uid() AND m.status = 'active'
        AND (
          m.role = 'manager'
          OR EXISTS (
            SELECT 1 FROM public.professional_folder_access a
            WHERE a.folder_id = professional_folders.id AND a.member_id = m.id
          )
        )
    )
  );

DROP POLICY IF EXISTS "Members can view their folder access" ON public.professional_folder_access;
CREATE POLICY "Members can view their folder access"
  ON public.professional_folder_access FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.professional_members m
      WHERE m.id = member_id AND m.user_id = auth.uid() AND m.status = 'active'
    )
  );

DROP POLICY IF EXISTS "Members can view permitted folder files" ON public.professional_folder_files;
CREATE POLICY "Members can view permitted folder files"
  ON public.professional_folder_files FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.professional_folders f
      JOIN public.professional_members m ON m.organization_id = f.organization_id
      WHERE f.id = folder_id AND m.user_id = auth.uid() AND m.status = 'active'
        AND (
          m.role = 'manager'
          OR EXISTS (
            SELECT 1 FROM public.professional_folder_access a
            WHERE a.folder_id = f.id AND a.member_id = m.id
          )
        )
    )
  );

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'professional-space',
  'professional-space',
  false,
  10485760,
  ARRAY['image/*', 'application/pdf', 'text/plain', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
