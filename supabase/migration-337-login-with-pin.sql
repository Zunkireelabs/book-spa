-- Migration 337: capture login_with_pin, another untracked hand-created object
--
-- Found 2026-11-19 while debugging PIN login failing on staging (401,
-- "permission denied for function login_with_pin"). Same class of gap migration-013
-- documented for service_categories/client_request_id: this function exists live on staging
-- (and presumably production) but was never committed to this repo. verify_pin (migration-018)
-- IS tracked; login_with_pin is a separate, newer function that is not.
--
-- Pulled verbatim from staging via pg_get_functiondef() on 2026-11-19 -- this is not a
-- reconstruction from how callers use it, it's the live definition itself.
--
-- INVESTIGATION NOTE, so this isn't mistaken for the actual fix: staging's 401 is NOT a
-- missing grant. `SELECT proacl FROM pg_proc WHERE proname = 'login_with_pin'` on staging
-- already shows `{postgres=X/postgres,service_role=X/postgres}` -- service_role already has
-- EXECUTE, and neither anon nor PUBLIC does, which is exactly correct (never grant this to
-- anon: the anon key ships in every browser, and PIN brute-forcing becomes trivial the moment
-- it can call this directly instead of through the pin-login Edge Function's own rate
-- limiting). The grants below are therefore NOT a fix -- they reproduce what's already
-- correctly live, so this migration is a documentation/reproducibility change, not a
-- permission change. The actual 401 cause is that the pin-login Edge Function (dashboard-
-- managed, not in this repo -- see CLAUDE.md) is evidently not calling this RPC as
-- service_role, most likely because SUPABASE_SERVICE_ROLE_KEY isn't set in that Edge
-- Function's own secrets and it fell back to the anon identity the browser's request carried.
-- That's a dashboard configuration fix, not something this migration -- or any SQL -- can
-- apply.
--
-- Idempotent: CREATE OR REPLACE FUNCTION; REVOKE/GRANT are both naturally idempotent.
-- Reversible (manual):
--   DROP FUNCTION IF EXISTS public.login_with_pin(text, text, text);

CREATE OR REPLACE FUNCTION public.login_with_pin(p_email text, p_pin text, p_org_slug text DEFAULT NULL::text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user record;
BEGIN
  -- Look up the user with their org slug
  SELECT u.id, u.email, u.role, u.full_name, u.is_active, u.pin, o.slug AS org_slug
  INTO v_user
  FROM users u
  LEFT JOIN organizations o ON u.org_id = o.id
  WHERE u.email = p_email;

  -- User not found or wrong PIN — generic error to avoid email enumeration
  IF v_user.id IS NULL OR v_user.pin IS NULL OR v_user.pin <> p_pin THEN
    RETURN json_build_object('success', false, 'error', 'Invalid email or PIN');
  END IF;

  -- Inactive user
  IF NOT v_user.is_active THEN
    RETURN json_build_object('success', false, 'error', 'Account is deactivated');
  END IF;

  -- Optional org scoping
  IF p_org_slug IS NOT NULL AND v_user.org_slug IS DISTINCT FROM p_org_slug THEN
    RETURN json_build_object('success', false, 'error', 'User does not belong to this organization');
  END IF;

  RETURN json_build_object(
    'success', true,
    'user_id', v_user.id,
    'email',   v_user.email,
    'role',    v_user.role,
    'full_name', v_user.full_name
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.login_with_pin(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.login_with_pin(text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.login_with_pin(text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.login_with_pin(text, text, text) TO service_role;

INSERT INTO public.schema_migrations (version, name)
VALUES ('337', 'login-with-pin')
ON CONFLICT (version) DO NOTHING;
