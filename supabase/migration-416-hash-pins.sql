-- migration-416-hash-pins.sql  (ZNLY-219)
--
-- WHY: users.pin holds the staff 4-digit PIN as PLAIN TEXT (prod: every user). Anyone who can read the table (a backup, a leaked dump, a
--      service-role slip) reads every PIN. PINs are now stored only as bcrypt hashes (pgcrypto crypt), and wrong guesses lock the account.
-- WHAT:
--   1. Hash in place: pin := crypt(pin, gen_salt('bf')) for every row not already a bcrypt hash ('$2' prefix). Re-running changes nothing.
--      A blank PIN becomes NULL (has_pin() treats '' as "no PIN"; a hash of '' would wrongly count as one).
--   2. login_with_pin and verify_pin compare with crypt(p_pin, pin) = pin. Same signatures, same return shapes, same grants (service_role only).
--   3. ONE writer: set_user_pin(p_user_id, p_pin), SECURITY DEFINER. Validates exactly 4 digits, then the role rule the users policies use
--      (migration 386): an admin of the same organisation; a manager only for 'staff' in their own branches; a person themselves only if admin
--      (the Access screen: "an admin has no manager to ask"). A trigger on users makes this the ONLY way: a signed-in browser role
--      (anon/authenticated) can no longer insert or change users.pin directly, and any other writer (service_role, SQL) gets a plain value hashed
--      automatically. No plain PIN can be stored again.
--   4. Lockout: 5 wrong PINs within 15 minutes of each other -> locked 15 minutes (older failures are forgotten). Table pin_attempts (no browser access). A right PIN clears the count. The refusal
--      text is 'Too many attempts, try again in N minutes' (the pin-login Edge Function passes error text through; the app shows it).
--   Edge Function pin-login is unchanged (it only checks /^\d{4}$/ and calls login_with_pin).
-- ROLLBACK: restoring plain PINs is NOT possible (hashes are one-way). Back up users before running. To undo the code path only: re-apply 397's
--      login_with_pin and 018's verify_pin, DROP TRIGGER users_pin_guard, DROP FUNCTION set_user_pin. PINs would then need to be reset by managers.
-- Applied: prod - / stage -.

BEGIN;

SET LOCAL search_path = public, extensions;

-- pgcrypto: prod has it. Make sure a fresh database does too, wherever the platform keeps extensions.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
      CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
    ELSE
      CREATE EXTENSION pgcrypto;
    END IF;
  END IF;
END $$;

-- ── lockout state ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pin_attempts (
  user_id        uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  failed_count   integer NOT NULL DEFAULT 0,
  locked_until   timestamptz,
  last_failed_at timestamptz
);
ALTER TABLE public.pin_attempts ENABLE ROW LEVEL SECURITY;   -- no policies: only the SECURITY DEFINER functions below (and service_role) touch it
REVOKE ALL ON public.pin_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.pin_attempts TO service_role;

-- Internal helpers (not callable from the browser).
CREATE OR REPLACE FUNCTION public._pin_lock_message(p_until timestamptz) RETURNS text
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT 'Too many attempts, try again in ' || greatest(1, ceil(extract(epoch FROM (p_until - now())) / 60))::int
         || CASE WHEN greatest(1, ceil(extract(epoch FROM (p_until - now())) / 60))::int = 1 THEN ' minute' ELSE ' minutes' END;
$$;

-- Is this person locked right now? Returns the unlock time, or NULL. An expired lock is cleared.
CREATE OR REPLACE FUNCTION public._pin_locked_until(p_user_id uuid) RETURNS timestamptz
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_until timestamptz;
BEGIN
  SELECT locked_until INTO v_until FROM public.pin_attempts WHERE user_id = p_user_id FOR UPDATE;
  IF v_until IS NOT NULL AND v_until > now() THEN RETURN v_until; END IF;
  IF v_until IS NOT NULL THEN
    UPDATE public.pin_attempts SET failed_count = 0, locked_until = NULL WHERE user_id = p_user_id;
  END IF;
  RETURN NULL;
END $$;

-- Count one wrong PIN. Returns the unlock time when this one caused the lock, else NULL.
CREATE OR REPLACE FUNCTION public._pin_register_failure(p_user_id uuid) RETURNS timestamptz
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  INSERT INTO public.pin_attempts AS a (user_id, failed_count, last_failed_at) VALUES (p_user_id, 1, now())
  -- Wrong PINs weeks apart are not an attack: a count whose last failure is older than the 15-minute window starts again at 1.
  ON CONFLICT (user_id) DO UPDATE SET
    failed_count = CASE WHEN a.last_failed_at IS NULL OR a.last_failed_at < now() - interval '15 minutes' THEN 1 ELSE a.failed_count + 1 END,
    last_failed_at = now()
  RETURNING failed_count INTO v_count;
  IF v_count >= 5 THEN
    UPDATE public.pin_attempts SET locked_until = now() + interval '15 minutes' WHERE user_id = p_user_id;
    RETURN now() + interval '15 minutes';
  END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public._pin_lock_message(timestamptz), public._pin_locked_until(uuid), public._pin_register_failure(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._pin_lock_message(timestamptz), public._pin_locked_until(uuid), public._pin_register_failure(uuid) TO service_role;

-- ── the one writer ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_user_pin(p_user_id uuid, p_pin text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_me uuid := auth.uid(); v_role text; v_org uuid; v_target record;
BEGIN
  IF p_pin IS NULL OR p_pin !~ '^\d{4}$' THEN RAISE EXCEPTION 'PIN must be exactly 4 digits'; END IF;
  -- service_role / SQL (no signed-in person) may set a PIN; a signed-in person goes through the role rule below.
  IF v_me IS NOT NULL THEN
    SELECT u.role::text, u.org_id INTO v_role, v_org FROM public.users u WHERE u.id = v_me;
    SELECT u.id, u.org_id, u.role::text AS role, u.branch_id INTO v_target FROM public.users u WHERE u.id = p_user_id;
    IF v_target.id IS NULL OR v_role IS NULL OR v_target.org_id IS DISTINCT FROM v_org THEN RAISE EXCEPTION 'set_user_pin: not allowed'; END IF;
    IF NOT (
      (v_role = 'admin')
      OR (v_role = 'manager' AND v_target.id <> v_me AND v_target.role = 'staff'
          AND v_target.branch_id = ANY ((SELECT public.get_user_branch_ids())::uuid[]))
    ) THEN RAISE EXCEPTION 'set_user_pin: not allowed'; END IF;
  END IF;
  UPDATE public.users SET pin = crypt(p_pin, gen_salt('bf')) WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'set_user_pin: no such user'; END IF;
  DELETE FROM public.pin_attempts WHERE user_id = p_user_id;   -- a new PIN starts clean (also lifts a lock)
END $$;
REVOKE ALL ON FUNCTION public.set_user_pin(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_pin(uuid, text) TO authenticated, service_role;

-- A browser role can no longer write users.pin directly; anyone else's plain value is hashed on the way in.
CREATE OR REPLACE FUNCTION public.users_pin_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, extensions AS $$
BEGIN
  IF NEW.pin IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.pin IS NOT DISTINCT FROM OLD.pin THEN RETURN NEW; END IF;
  IF current_user IN ('anon', 'authenticated') THEN RAISE EXCEPTION 'A PIN can only be set with set_user_pin()'; END IF;
  IF btrim(NEW.pin) = '' THEN NEW.pin := NULL; RETURN NEW; END IF;
  IF NEW.pin !~ '^\$2[abxy]\$' THEN
    IF NEW.pin !~ '^\d{4}$' THEN RAISE EXCEPTION 'PIN must be exactly 4 digits'; END IF;
    NEW.pin := crypt(NEW.pin, gen_salt('bf'));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS users_pin_guard ON public.users;
CREATE TRIGGER users_pin_guard BEFORE INSERT OR UPDATE OF pin ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.users_pin_guard();

-- ── 1. hash what is stored (the trigger lets a '$2' value straight through) ───────────────────────────────────────────────────────────
UPDATE public.users SET pin = NULL WHERE pin IS NOT NULL AND btrim(pin) = '';
UPDATE public.users SET pin = crypt(pin, gen_salt('bf')) WHERE pin IS NOT NULL AND pin !~ '^\$2[abxy]\$';

-- ── 2. readers compare the hash ──────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.login_with_pin(p_email text, p_pin text, p_org_slug text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_user record;
  v_until timestamptz;
BEGIN
  SELECT u.id, u.email, u.role, u.full_name, u.is_active, u.pin, o.slug AS org_slug
  INTO v_user
  FROM users u
  LEFT JOIN organizations o ON u.org_id = o.id
  WHERE u.email = p_email;

  -- User not found: generic error to avoid email enumeration
  IF v_user.id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Invalid email or PIN');
  END IF;

  -- Locked after too many wrong PINs
  v_until := public._pin_locked_until(v_user.id);
  IF v_until IS NOT NULL THEN
    RETURN json_build_object('success', false, 'error', public._pin_lock_message(v_until));
  END IF;

  -- No usable PIN (none set): nothing to guess, nothing to count
  IF v_user.pin IS NULL OR v_user.pin !~ '^\$2[abxy]\$' THEN
    RETURN json_build_object('success', false, 'error', 'Invalid email or PIN');
  END IF;

  IF crypt(p_pin, v_user.pin) <> v_user.pin THEN
    v_until := public._pin_register_failure(v_user.id);
    IF v_until IS NOT NULL THEN
      RETURN json_build_object('success', false, 'error', public._pin_lock_message(v_until));
    END IF;
    RETURN json_build_object('success', false, 'error', 'Invalid email or PIN');
  END IF;

  -- Right PIN: the count starts over
  DELETE FROM public.pin_attempts WHERE user_id = v_user.id;

  IF NOT v_user.is_active THEN
    RETURN json_build_object('success', false, 'error', 'Account is deactivated');
  END IF;

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

CREATE OR REPLACE FUNCTION public.verify_pin(p_email text, p_pin text, p_org_slug text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user record;
  v_until timestamptz;
BEGIN
  SELECT u.id, u.email, u.role, u.full_name, u.pin, o.slug AS org_slug
  INTO v_user
  FROM users u
  LEFT JOIN organizations o ON u.org_id = o.id
  WHERE u.email = p_email AND u.is_active = true;

  IF v_user.id IS NULL THEN
    RETURN json_build_object('valid', false, 'error', 'Invalid email or PIN');
  END IF;

  v_until := public._pin_locked_until(v_user.id);
  IF v_until IS NOT NULL THEN
    RETURN json_build_object('valid', false, 'error', public._pin_lock_message(v_until));
  END IF;

  IF v_user.pin IS NULL OR v_user.pin !~ '^\$2[abxy]\$' THEN
    RETURN json_build_object('valid', false, 'error', 'Invalid email or PIN');
  END IF;

  IF crypt(p_pin, v_user.pin) <> v_user.pin THEN
    v_until := public._pin_register_failure(v_user.id);
    IF v_until IS NOT NULL THEN
      RETURN json_build_object('valid', false, 'error', public._pin_lock_message(v_until));
    END IF;
    RETURN json_build_object('valid', false, 'error', 'Invalid email or PIN');
  END IF;

  DELETE FROM public.pin_attempts WHERE user_id = v_user.id;

  IF p_org_slug IS NOT NULL AND v_user.org_slug != p_org_slug THEN
    RETURN json_build_object('valid', false, 'error', 'User does not belong to this organization');
  END IF;

  RETURN json_build_object(
    'valid', true,
    'user_id', v_user.id,
    'email', v_user.email,
    'role', v_user.role,
    'full_name', v_user.full_name
  );
END;
$$;

-- Grants exactly as 384 / 387 / 397 leave them: service_role only.
REVOKE ALL ON FUNCTION public.login_with_pin(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.login_with_pin(text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.verify_pin(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_pin(text, text, text) TO service_role;

INSERT INTO public.schema_migrations (version, name) VALUES ('416', 'hash-pins')
ON CONFLICT (version) DO NOTHING;
COMMIT;
