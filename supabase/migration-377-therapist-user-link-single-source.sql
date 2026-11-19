-- Migration 377 (ZNLY-198 step 4a / ZNLY-205, logic half): therapists.user_id is the ONLY login <-> therapist link.
--
-- Two competing links existed: users.therapist_id (mig 358, the Zennly "Login" field on a staff member, set through
-- set_user_therapist from mig 369) and therapists.user_id (mig 318, written by Staff access). Decision (owner, ZNLY-205):
-- keep therapists.user_id, drop users.therapist_id.
--
--  1. Copy every users.therapist_id into therapists.user_id where that column is empty and the match is unambiguous.
--     Nothing is overwritten and nothing is guessed. Every link that is NOT copied is saved, with the reason, in
--     public.znly205_link_conflicts (RLS on, admin read only) BEFORE the column is dropped, and a RAISE NOTICE gives the count.
--  2. Repoint everything that read users.therapist_id (the "my day" id list, the effective-branch helper, the transfer
--     user-branch sync, the set_user_therapist RPC) to therapists.user_id. Then drop users.therapist_id.
--  3. Login off blocks sign-in. login_access is NOT NULL DEFAULT 'none' (mig 318), so a login created outside Staff access
--     (onboarding script, hand-made account) carries 'none' without anyone having switched it off. Those must not be locked out:
--       - the column default becomes 'email' from here on;
--       - existing 'none' rows with NO linked therapist are account-only logins (owner/office), not a Staff-access "login off":
--         they are set to 'email' and each one is recorded in znly205_link_conflicts (reason 'login_access_backfilled_to_email').
--       - 'none' on a login that IS linked to a therapist stays off: that is the Staff-access switch.
--     The app treats a missing/NULL value as allowed. public.auth_hook_block_login_off() is the optional server-side half
--     (Auth "Custom Access Token" hook): it refuses to mint a token for a login-off user, so password, PIN and refresh all stop.
--     It does nothing until it is enabled in the Supabase Auth settings.
--
-- Reversible (manual): re-add users.therapist_id + idx_users_therapist_id_unique and refill from therapists.user_id; restore
-- the four function bodies from migrations 358/360/369; znly205_link_conflicts can be dropped once reviewed.
--
-- Applied: local only.

BEGIN;

-- ── 1. Save conflicts, copy the rest ─────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.znly205_link_conflicts (
  id                       bigserial PRIMARY KEY,
  org_id                   uuid,
  user_id                  uuid,
  therapist_id             uuid,
  therapist_current_user_id uuid,
  reason                   text NOT NULL,
  recorded_at              timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.znly205_link_conflicts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can read link conflicts" ON public.znly205_link_conflicts;
CREATE POLICY "Admins can read link conflicts" ON public.znly205_link_conflicts
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_user_org_id()) AND (SELECT public.get_user_role()) = 'admin');
REVOKE ALL ON public.znly205_link_conflicts FROM PUBLIC, anon;
GRANT SELECT ON public.znly205_link_conflicts TO authenticated;

DO $$
DECLARE
  v_total int; v_copied int; v_conflicts int; v_backfilled int;
BEGIN
  SELECT count(*) INTO v_total FROM public.users WHERE therapist_id IS NOT NULL;

  -- Not copied, with the reason. A link is copyable only when: same organisation, the therapist has no login yet, and this login
  -- is not already linked to a different therapist.
  INSERT INTO public.znly205_link_conflicts (org_id, user_id, therapist_id, therapist_current_user_id, reason)
  SELECT u.org_id, u.id, u.therapist_id, t.user_id,
         CASE
           WHEN t.id IS NULL                                  THEN 'therapist_row_missing'
           WHEN t.org_id IS DISTINCT FROM u.org_id            THEN 'org_mismatch'
           WHEN t.user_id IS NOT NULL AND t.user_id <> u.id   THEN 'therapist_already_linked_to_another_login'
           ELSE 'login_already_linked_to_another_therapist'
         END
    FROM public.users u
    LEFT JOIN public.therapists t ON t.id = u.therapist_id
   WHERE u.therapist_id IS NOT NULL
     AND NOT (t.id IS NOT NULL AND t.org_id = u.org_id AND t.user_id IS NOT DISTINCT FROM u.id)      -- already the same link: fine
     AND NOT (t.id IS NOT NULL AND t.org_id = u.org_id AND t.user_id IS NULL
              AND NOT EXISTS (SELECT 1 FROM public.therapists o WHERE o.user_id = u.id));            -- copyable below
  GET DIAGNOSTICS v_conflicts = ROW_COUNT;

  UPDATE public.therapists t
     SET user_id = u.id
    FROM public.users u
   WHERE u.therapist_id = t.id
     AND t.org_id = u.org_id
     AND t.user_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.therapists o WHERE o.user_id = u.id);
  GET DIAGNOSTICS v_copied = ROW_COUNT;

  -- Logins created outside Staff access carry the column default 'none' without being switched off: keep them able to sign in.
  WITH fix AS (
    UPDATE public.users u SET login_access = 'email'
     WHERE u.login_access = 'none'
       AND NOT EXISTS (SELECT 1 FROM public.therapists t WHERE t.user_id = u.id)
    RETURNING u.id, u.org_id
  )
  INSERT INTO public.znly205_link_conflicts (org_id, user_id, reason)
  SELECT org_id, id, 'login_access_backfilled_to_email' FROM fix;
  GET DIAGNOSTICS v_backfilled = ROW_COUNT;

  RAISE NOTICE 'znly205: % users.therapist_id links: % copied to therapists.user_id, % saved in znly205_link_conflicts (+ % login_access backfills, same table)',
    v_total, v_copied, v_conflicts, v_backfilled;
END $$;

ALTER TABLE public.users ALTER COLUMN login_access SET DEFAULT 'email';

-- ── 2. Repoint the readers / writer of the old link ────────────────────────────────────────────────────────────────────────
-- "My day": the therapist(s) this login is.
CREATE OR REPLACE FUNCTION public._dashboard_my_therapist_ids()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(array_agg(t.id), '{}') FROM public.therapists t WHERE t.user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public._dashboard_my_therapist_ids() FROM PUBLIC, anon, authenticated;

-- A staff login follows the person they are while that person is lent to another branch.
CREATE OR REPLACE FUNCTION public._user_effective_branch(p_user_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
           CASE WHEN u.role = 'staff'
                THEN (SELECT public._therapist_open_window_branch(t.id, now())
                        FROM public.therapists t WHERE t.user_id = u.id LIMIT 1) END,
           u.branch_id)
    FROM public.users u WHERE u.id = p_user_id;
$function$;

-- Transfer sync: move the linked staff login's branch with the person.
CREATE OR REPLACE FUNCTION public._sync_user_branch_for_transfer(p_therapist_id uuid, p_org_id uuid, p_to_branch_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n int;
BEGIN
  UPDATE public.users u
     SET branch_id = p_to_branch_id
    FROM public.therapists t
   WHERE t.id = p_therapist_id
     AND t.user_id = u.id
     AND u.org_id = p_org_id
     AND u.role = 'staff'
     AND u.branch_id IS DISTINCT FROM p_to_branch_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n = 0 AND NOT EXISTS (
       SELECT 1 FROM public.therapists t JOIN public.users u ON u.id = t.user_id
        WHERE t.id = p_therapist_id AND u.org_id = p_org_id AND u.role = 'staff') THEN
    RAISE NOTICE 'transfer: no staff login linked to therapist %; users.branch_id unchanged', p_therapist_id;
    RETURN false;
  END IF;
  RETURN true;
END;
$function$;

-- The guarded way to link / unlink from the app (the staff "Login" field). Now writes therapists.user_id; NULL unlinks the login.
CREATE OR REPLACE FUNCTION public.set_user_therapist(p_user_id uuid, p_therapist_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org uuid := public.get_user_org_id();
  v_t record;
BEGIN
  IF public.get_user_role() NOT IN ('manager', 'admin') THEN
    RAISE EXCEPTION 'set_user_therapist: managers and admins only' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user_id AND u.org_id = v_org) THEN
    RAISE EXCEPTION 'set_user_therapist: user not in your organization' USING ERRCODE = '42501';
  END IF;
  IF p_therapist_id IS NOT NULL THEN
    SELECT t.id, t.branch_id, t.user_id INTO v_t FROM public.therapists t WHERE t.id = p_therapist_id AND t.org_id = v_org;
    IF NOT FOUND THEN RAISE EXCEPTION 'set_user_therapist: therapist not in your organization' USING ERRCODE = '42501'; END IF;
    IF NOT public._can_manage_branch(v_t.branch_id) THEN
      RAISE EXCEPTION 'set_user_therapist: not allowed for that branch' USING ERRCODE = '42501';
    END IF;
    IF v_t.user_id IS NOT NULL AND v_t.user_id <> p_user_id THEN
      RAISE EXCEPTION 'set_user_therapist: that person is already linked to another login' USING ERRCODE = '23505';
    END IF;
    IF EXISTS (SELECT 1 FROM public.therapists x WHERE x.user_id = p_user_id AND x.id <> p_therapist_id) THEN
      RAISE EXCEPTION 'set_user_therapist: that login is already linked to another person' USING ERRCODE = '23505';
    END IF;
    UPDATE public.therapists SET user_id = p_user_id WHERE id = p_therapist_id;
  ELSE
    UPDATE public.therapists SET user_id = NULL WHERE user_id = p_user_id AND org_id = v_org;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.set_user_therapist(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_therapist(uuid, uuid) TO authenticated;

-- Drop the old link (its FK constraint goes with the column).
DROP INDEX IF EXISTS public.idx_users_therapist_id_unique;
ALTER TABLE public.users DROP COLUMN IF EXISTS therapist_id;

-- ── 3. Optional server-side half of "login off blocks sign-in" ──────────────────────────────────────────────────────────────
-- Supabase Auth "Custom Access Token" hook: runs whenever a token is minted (password sign-in, PIN sign-in through the
-- pin-login OTP, and refresh). Raising here refuses the sign-in. A missing user or a missing/NULL value is allowed.
CREATE OR REPLACE FUNCTION public.auth_hook_block_login_off(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.users u WHERE u.id = (event ->> 'user_id')::uuid AND u.login_access = 'none') THEN
    RAISE EXCEPTION 'Sign-in is turned off for this account. Ask your administrator.' USING ERRCODE = '42501';
  END IF;
  RETURN event;
END;
$$;
REVOKE ALL ON FUNCTION public.auth_hook_block_login_off(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_hook_block_login_off(jsonb) TO supabase_auth_admin;

INSERT INTO public.schema_migrations (version, name)
VALUES ('377', 'therapist-user-link-single-source')
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
