-- supabase/migration-113-platform-admins.sql
-- Platform-wide super-admin identity. A user is "platform admin" iff they have
-- a row here. No org_id anywhere = not tenant-scoped. Deny-all RLS; only
-- SECURITY DEFINER RPCs (which bypass RLS as table owner) touch this table.

CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
-- No policies => authenticated/anon cannot read or write directly.

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('113', 'platform-admins') ON CONFLICT (version) DO NOTHING;
