-- migration-397-login-with-pin.sql  (ZNLY-220)
--
-- WHY: the pin-login Edge Function calls public.login_with_pin(text, text, text) on PRODUCTION, but the function was created by hand and no
--      migration in the repo defines it, so a fresh database / stage / local did not have it (schema drift). Migration 387 only revoked its grants.
-- WHAT: capture the production definition, byte-faithful (pg_get_functiondef from the prod copy; SECURITY DEFINER, search_path public).
--       No logic is changed or hardened here. Grants copy prod's actual ACL: executable by service_role (and the owner) ONLY; PUBLIC, anon
--       and authenticated cannot, per migration 387 (ZNLY-219). On prod this migration is a no-op (CREATE OR REPLACE with the same body).
-- NOT HERE: PINs are stored and compared as PLAIN TEXT (users.pin, v_user.pin <> p_pin). Hashing (pgcrypto crypt) in login_with_pin, verify_pin
--       and every place a PIN is saved is a later ticket, done in one step with the Edge Function. Do not change it in this migration.
-- ROLLBACK: DROP FUNCTION public.login_with_pin(text, text, text);   (breaks pin-login on any database that relies on it, so only on a DB that never had it)

BEGIN;

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


REVOKE ALL ON FUNCTION public.login_with_pin(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.login_with_pin(text, text, text) TO service_role;

INSERT INTO public.schema_migrations (version, name) VALUES ('397', 'login-with-pin')
ON CONFLICT (version) DO NOTHING;
COMMIT;
