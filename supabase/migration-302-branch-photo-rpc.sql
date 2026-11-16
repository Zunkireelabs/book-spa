-- Migration 302: admin write path for branches.photo_url
--
-- branches.photo_url already exists and is read by BranchGate.jsx (the multi-branch
-- picker's storefront photo, falling back to a generic icon tile when empty) — but no
-- admin UI could set it, because `branches` has RLS enabled with SELECT-only policies
-- (migration-012 / rls.sql): a plain .update() from the admin UI would silently affect
-- zero rows and report success, exactly the gap update_branch_online_capacity()
-- (migration-301) closed for online_booking_capacity. This is the same fix for
-- photo_url: a SECURITY DEFINER RPC, admin-only, scoped to the caller's own org.
--
-- Reversible (manual):
--   DROP FUNCTION IF EXISTS public.update_branch_photo(uuid, text);
--
-- Applied: stage 2026-10-27 / prod HELD.

BEGIN;

CREATE OR REPLACE FUNCTION public.update_branch_photo(
  p_branch_id uuid,
  p_photo_url text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org_id uuid := get_user_org_id();
  v_role   text := get_user_role();
  v_found  uuid;
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'update_branch_photo: admin only';
  END IF;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'update_branch_photo: no organization context';
  END IF;

  UPDATE public.branches
  SET photo_url = p_photo_url
  WHERE id = p_branch_id
    AND org_id = v_org_id
  RETURNING id INTO v_found;

  IF v_found IS NULL THEN
    RAISE EXCEPTION 'update_branch_photo: branch % not found in this organization', p_branch_id;
  END IF;

  RETURN p_photo_url;
END;
$$;

-- Staff-only: revoke from anon explicitly as well as PUBLIC — a default-privileges
-- grant straight to anon would survive the PUBLIC revoke on its own (same belt-and-
-- braces as migration-298/301).
REVOKE ALL ON FUNCTION public.update_branch_photo(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_branch_photo(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_branch_photo(uuid, text) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('302', 'branch-photo-rpc')
ON CONFLICT (version) DO NOTHING;

COMMIT;
