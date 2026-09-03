-- Migration 154: restore transfer_therapist(uuid, uuid, text, date) (additive, REVERSIBLE)
--
-- Incident (2026-09-03): PR #184 (feature/attendance, migrations 145-153 as originally
-- numbered on that branch) was mistakenly merged into stage, then promoted to main. Before
-- the mistake was caught and PR #184 reverted, CI's Apply Migrations step had already run
-- the original migration-145 through migration-150 to completion against PRODUCTION (it
-- failed on the original migration-151, which assumed the public.attendance_status enum
-- exists — production's therapist_attendance.status column is plain text, not that enum, a
-- pre-existing schema divergence from staging). The original migration-145's
-- `DROP FUNCTION public.transfer_therapist(uuid, uuid, text, date)` removed the exact
-- overload the still-deployed (pre-#184) production frontend calls — see
-- src/services/api.js's transferTherapist(), which calls the RPC with named params
-- p_therapist_id/p_to_branch_id/p_note/p_effective_date. Deploy itself never ran (gated on
-- Apply Migrations succeeding), so the frontend never changed — only this one RPC broke.
--
-- This migration restores that exact overload (byte-for-byte the migration-048 body, the
-- last version actually live before the incident) so the deployed frontend works again. It
-- does not touch the new 8-arg transfer_therapist(...) overload or any of the new columns
-- migrations 146-150 added (all additive/nullable) — both signatures coexist afterward.
-- Once feature/attendance is fixed and re-promoted, this old overload can be dropped again
-- alongside a corrected version of the original migration-145.
--
-- Reversible: DROP FUNCTION IF EXISTS public.transfer_therapist(uuid, uuid, text, date);

CREATE OR REPLACE FUNCTION public.transfer_therapist(
  p_therapist_id   uuid,
  p_to_branch_id   uuid,
  p_note           text DEFAULT NULL,
  p_effective_date date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role          user_role;
  v_caller_org    uuid;
  v_caller_branch uuid;
  v_from_branch   uuid;
  v_therapist_org uuid;
  v_to_branch_org uuid;
  v_new_order     int;
  v_transfer_id   uuid;
  v_today         date;
  v_effective     date;
  v_immediate     boolean;
BEGIN
  v_role          := get_user_role();
  v_caller_org    := get_user_org_id();
  v_caller_branch := get_user_branch_id();
  v_today         := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  v_effective     := COALESCE(p_effective_date, v_today);

  SELECT branch_id, org_id INTO v_from_branch, v_therapist_org
  FROM public.therapists
  WHERE id = p_therapist_id;

  IF v_from_branch IS NULL THEN
    RAISE EXCEPTION 'transfer_therapist: therapist % not found', p_therapist_id;
  END IF;

  IF v_therapist_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'transfer_therapist: therapist is not in your organization';
  END IF;

  SELECT org_id INTO v_to_branch_org
  FROM public.branches
  WHERE id = p_to_branch_id;

  IF v_to_branch_org IS NULL THEN
    RAISE EXCEPTION 'transfer_therapist: destination branch % not found', p_to_branch_id;
  END IF;

  IF v_to_branch_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'transfer_therapist: destination branch is not in your organization';
  END IF;

  IF p_to_branch_id = v_from_branch THEN
    RAISE EXCEPTION 'transfer_therapist: staffer is already at that branch';
  END IF;

  IF NOT (
    v_role = 'admin'
    OR (v_role = 'manager' AND v_from_branch = v_caller_branch)
  ) THEN
    RAISE EXCEPTION 'transfer_therapist: only an admin or the current branch''s manager may transfer this staffer';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.staff_transfers
    WHERE therapist_id = p_therapist_id AND applied = false
  ) THEN
    RAISE EXCEPTION 'transfer_therapist: a scheduled transfer already exists for this staffer; cancel it first';
  END IF;

  v_immediate := v_effective <= v_today;

  IF v_immediate THEN
    SELECT COALESCE(max(display_order), -1) + 1 INTO v_new_order
    FROM public.therapists
    WHERE branch_id = p_to_branch_id;

    UPDATE public.therapists
       SET branch_id = p_to_branch_id,
           display_order = v_new_order
     WHERE id = p_therapist_id;

    -- migration-048: keep the staff user's login branch in sync (staff role only).
    PERFORM public._sync_user_branch_for_transfer(p_therapist_id, v_caller_org, p_to_branch_id);
  END IF;

  INSERT INTO public.staff_transfers
    (therapist_id, org_id, from_branch_id, to_branch_id, transferred_by, note, effective_date, applied)
  VALUES
    (p_therapist_id, v_caller_org, v_from_branch, p_to_branch_id, auth.uid(), p_note, v_effective, v_immediate)
  RETURNING id INTO v_transfer_id;

  RETURN v_transfer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_therapist(uuid, uuid, text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transfer_therapist(uuid, uuid, text, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.transfer_therapist(uuid, uuid, text, date) TO authenticated;

-- Record migration ---------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('154', 'restore-transfer-therapist-signature')
ON CONFLICT (version) DO NOTHING;
