-- Migration 384 (ZNLY-210 + ZNLY-216, board B4.2): "has a PIN" comes from a function; the PIN column is no longer readable.
--   * has_pin(p_user_id DEFAULT NULL) -> boolean, SECURITY DEFINER. NULL / own id: the signed-in user. Another person: admin or manager of
--     the SAME organisation only (the Access screen). Returns whether a PIN is set, never the PIN.
--   * SELECT on users.pin is taken away from anon and authenticated. Postgres has no "revoke one column" on top of a table-wide grant, so the
--     table-wide SELECT is revoked and re-granted for every column EXCEPT pin (listed from the catalog at migration time). The app never read
--     the column except to ask "is it set?" (fetchTherapistAccess, moved to has_pin) and through select('*') on the profile (AuthContext, now an
--     explicit list). INSERT / UPDATE of pin stay allowed: saving a PIN works as before. service_role (the pin-login Edge Function) is untouched.
--   * verify_pin(email, pin, org_slug) is revoked from PUBLIC / anon / authenticated: the app never calls it (grep), and as an anon-callable
--     function it was a way to guess any person's 4-digit PIN. service_role keeps it.
-- CAUTION for later migrations: a column added to public.users after this one is NOT readable by the app until it is granted:
--   GRANT SELECT (new_column) ON public.users TO anon, authenticated;   (the qc-4c test fails loudly when one is forgotten)
-- How PINs are stored: PLAIN TEXT in users.pin (migration-018 compares u.pin = p_pin). Hashing needs the pin-login Edge Function to change
-- too, which is not in this repo; tracked separately.
-- Rollback (manual): GRANT SELECT ON public.users TO anon, authenticated; DROP FUNCTION public.has_pin(uuid); GRANT EXECUTE ON FUNCTION public.verify_pin(text,text,text) TO PUBLIC, anon, authenticated;
-- Applied: stage - / prod HELD.

BEGIN;

CREATE OR REPLACE FUNCTION public.has_pin(p_user_id uuid DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me uuid := auth.uid(); v_role user_role; v_org uuid; v_target_org uuid;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'has_pin: must be signed in'; END IF;
  IF p_user_id IS NULL OR p_user_id = v_me THEN
    RETURN EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_me AND u.pin IS NOT NULL AND btrim(u.pin) <> '');
  END IF;
  SELECT role, org_id INTO v_role, v_org FROM public.users WHERE id = v_me;
  SELECT org_id INTO v_target_org FROM public.users WHERE id = p_user_id;
  IF v_role IS NULL OR v_role NOT IN ('admin', 'manager') OR v_target_org IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'has_pin: not allowed';
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user_id AND u.pin IS NOT NULL AND btrim(u.pin) <> '');
END $$;
REVOKE ALL ON FUNCTION public.has_pin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_pin(uuid) TO authenticated;

DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name <> 'pin';
  REVOKE SELECT ON public.users FROM anon, authenticated;
  EXECUTE format('GRANT SELECT (%s) ON public.users TO anon, authenticated', cols);
END $$;

REVOKE ALL ON FUNCTION public.verify_pin(text, text, text) FROM PUBLIC, anon, authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('384', 'pin-not-readable')
ON CONFLICT (version) DO NOTHING;

COMMIT;
