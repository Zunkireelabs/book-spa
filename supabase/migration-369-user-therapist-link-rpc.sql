-- Migration 369: use the login <-> therapist link (users.therapist_id, mig 358) for "my day" + a guarded way to set it (ZNLY-150, V36b)
--
-- The link already exists: users.therapist_id (mig 358, unique, backfilled on an unambiguous name match, used by the transfer
-- sync). A second therapists.user_id would be a competing source of truth, so this migration reuses it.
--  1. _dashboard_my_therapist_ids() follows the link (no name match). get_dashboard's my_day / commission_inputs use it.
--  2. set_user_therapist(p_user_id, p_therapist_id): manager/admin only, same org, the therapist's branch must be one the caller manages,
--     the therapist must be unlinked (or already this user's), the user must be a staff/manager login. NULL unlinks.
--     users has no UPDATE policy, so nobody (staff included) can write their own link directly; this RPC is the only door.
-- Idempotent. Applied: stage - / prod -.

BEGIN;

CREATE OR REPLACE FUNCTION public._dashboard_my_therapist_ids()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(array_agg(u.therapist_id), '{}') FROM public.users u WHERE u.id = auth.uid() AND u.therapist_id IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public._dashboard_my_therapist_ids() FROM PUBLIC, anon, authenticated;

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
    SELECT t.id, t.branch_id INTO v_t FROM public.therapists t WHERE t.id = p_therapist_id AND t.org_id = v_org;
    IF NOT FOUND THEN RAISE EXCEPTION 'set_user_therapist: therapist not in your organization' USING ERRCODE = '42501'; END IF;
    IF NOT public._can_manage_branch(v_t.branch_id) THEN
      RAISE EXCEPTION 'set_user_therapist: not allowed for that branch' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM public.users x WHERE x.therapist_id = p_therapist_id AND x.id <> p_user_id) THEN
      RAISE EXCEPTION 'set_user_therapist: that person is already linked to another login' USING ERRCODE = '23505';
    END IF;
  END IF;
  UPDATE public.users SET therapist_id = p_therapist_id WHERE id = p_user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_user_therapist(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_therapist(uuid, uuid) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('369', 'user-therapist-link-rpc')
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
