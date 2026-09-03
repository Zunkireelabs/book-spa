-- Migration 146: bring back a Permanent transfer option alongside required-duration
-- (Temporary) transfers (additive, REVERSIBLE)
--
-- Migration 141 removed the old permanent-transfer model entirely, making every transfer
-- require a start time + duration and auto-revert. This restores Permanent as a second mode,
-- selected via a new p_permanent flag on transfer_therapist():
--
--   - p_permanent = false (default): unchanged from migration-145/147/149 — start time and
--     duration are required, revert_at is computed, and the staffer auto-reverts to their
--     original branch when it elapses.
--   - p_permanent = true: behaves like the pre-141 model — no start time/duration required,
--     no revert_at, no auto-revert; the staffer simply moves to the destination branch (either
--     immediately or on p_effective_date if that's in the future) and stays there.
--
-- Builds on migration-145/146/147/149.
--
-- Reversible:
--   ALTER TABLE public.staff_transfers DROP COLUMN IF EXISTS is_permanent;
--   -- then re-run migration-149's CREATE OR REPLACE body for transfer_therapist()
--   DROP FUNCTION IF EXISTS public.transfer_therapist(uuid, uuid, time, integer, text, text, date, boolean);

-- 1. New column ------------------------------------------------------------------
ALTER TABLE public.staff_transfers
  ADD COLUMN IF NOT EXISTS is_permanent boolean NOT NULL DEFAULT false;

-- 2. transfer_therapist: make duration/start-time conditional on p_permanent -----
DROP FUNCTION IF EXISTS public.transfer_therapist(uuid, uuid, time, integer, text, text, date);

CREATE OR REPLACE FUNCTION public.transfer_therapist(
  p_therapist_id    uuid,
  p_to_branch_id    uuid,
  p_start_time      time,
  p_duration_value  integer,
  p_duration_unit   text,
  p_note            text DEFAULT NULL,
  p_effective_date  date DEFAULT NULL,
  p_permanent       boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role              user_role;
  v_caller_org        uuid;
  v_caller_branch     uuid;
  v_from_branch       uuid;
  v_from_display_order int;
  v_therapist_org     uuid;
  v_to_branch_org     uuid;
  v_new_order         int;
  v_transfer_id       uuid;
  v_now               timestamp;
  v_today             date;
  v_effective         date;
  v_start_ts          timestamp;
  v_revert_at         timestamptz;
  v_immediate         boolean;
BEGIN
  IF NOT p_permanent THEN
    IF p_duration_value IS NULL OR p_duration_value <= 0 THEN
      RAISE EXCEPTION 'transfer_therapist: duration value must be a positive number';
    END IF;

    IF p_duration_unit IS NULL OR p_duration_unit NOT IN ('minute','hour','day','week','month') THEN
      RAISE EXCEPTION 'transfer_therapist: duration unit must be one of minute, hour, day, week, month';
    END IF;

    IF p_start_time IS NULL THEN
      RAISE EXCEPTION 'transfer_therapist: start time is required';
    END IF;
  END IF;

  v_role          := get_user_role();
  v_caller_org    := get_user_org_id();
  v_caller_branch := get_user_branch_id();
  v_now           := now() AT TIME ZONE 'Asia/Kathmandu';
  v_today         := v_now::date;
  v_effective     := COALESCE(p_effective_date, v_today);
  v_start_ts      := (v_effective::text || ' ' || COALESCE(p_start_time, '00:00:00'::time)::text)::timestamp;

  SELECT branch_id, org_id, display_order INTO v_from_branch, v_therapist_org, v_from_display_order
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
    WHERE therapist_id = p_therapist_id
      AND (applied = false OR (applied = true AND revert_at IS NOT NULL AND reverted = false))
  ) THEN
    RAISE EXCEPTION 'transfer_therapist: a transfer is already pending or in progress for this staffer; cancel or wait for it first';
  END IF;

  v_immediate := v_start_ts <= v_now;
  v_revert_at := CASE WHEN p_permanent THEN NULL
    ELSE (v_start_ts + (p_duration_value || ' ' || p_duration_unit || 's')::interval) AT TIME ZONE 'Asia/Kathmandu'
  END;

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
    (therapist_id, org_id, from_branch_id, to_branch_id, transferred_by, note, effective_date,
     applied, start_time, duration_value, duration_unit, revert_at, from_display_order, is_permanent)
  VALUES
    (p_therapist_id, v_caller_org, v_from_branch, p_to_branch_id, auth.uid(), p_note, v_effective,
     v_immediate, p_start_time, p_duration_value, p_duration_unit, v_revert_at, v_from_display_order, p_permanent)
  RETURNING id INTO v_transfer_id;

  RETURN v_transfer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_therapist(uuid, uuid, time, integer, text, text, date, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transfer_therapist(uuid, uuid, time, integer, text, text, date, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.transfer_therapist(uuid, uuid, time, integer, text, text, date, boolean) TO authenticated;

-- 3. Record migration ---------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('150', 'permanent-transfer-option')
ON CONFLICT (version) DO NOTHING;
