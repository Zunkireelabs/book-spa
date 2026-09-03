-- Migration 143: add "month" as a staff transfer duration unit (additive, REVERSIBLE)
--
-- Adds Month alongside Minute/Hour/Day/Week for transfer durations and extensions.
-- Builds on migration-145 (required-duration transfers) and migration-146 (extend).
--
-- Reversible:
--   ALTER TABLE public.staff_transfers DROP CONSTRAINT IF EXISTS staff_transfers_duration_unit_check;
--   ALTER TABLE public.staff_transfers ADD CONSTRAINT staff_transfers_duration_unit_check
--     CHECK (duration_unit = ANY (ARRAY['minute','hour','day','week']));
--   -- then re-run migration-145/146's transfer_therapist()/extend_staff_transfer() bodies
--   -- with 'month' removed from their allowed-unit checks.

-- 1. Widen the column CHECK to allow 'month' ----------------------------------
ALTER TABLE public.staff_transfers DROP CONSTRAINT IF EXISTS staff_transfers_duration_unit_check;
ALTER TABLE public.staff_transfers
  ADD CONSTRAINT staff_transfers_duration_unit_check
  CHECK (duration_unit = ANY (ARRAY['minute','hour','day','week','month']));

-- 2. transfer_therapist: allow 'month' in the unit validation -----------------
CREATE OR REPLACE FUNCTION public.transfer_therapist(
  p_therapist_id    uuid,
  p_to_branch_id    uuid,
  p_start_time      time,
  p_duration_value  integer,
  p_duration_unit   text,
  p_note            text DEFAULT NULL,
  p_effective_date  date DEFAULT NULL
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
  v_now           timestamp;
  v_today         date;
  v_effective     date;
  v_start_ts      timestamp;
  v_revert_at     timestamptz;
  v_immediate     boolean;
BEGIN
  IF p_duration_value IS NULL OR p_duration_value <= 0 THEN
    RAISE EXCEPTION 'transfer_therapist: duration value must be a positive number';
  END IF;

  IF p_duration_unit IS NULL OR p_duration_unit NOT IN ('minute','hour','day','week','month') THEN
    RAISE EXCEPTION 'transfer_therapist: duration unit must be one of minute, hour, day, week, month';
  END IF;

  IF p_start_time IS NULL THEN
    RAISE EXCEPTION 'transfer_therapist: start time is required';
  END IF;

  v_role          := get_user_role();
  v_caller_org    := get_user_org_id();
  v_caller_branch := get_user_branch_id();
  v_now           := now() AT TIME ZONE 'Asia/Kathmandu';
  v_today         := v_now::date;
  v_effective     := COALESCE(p_effective_date, v_today);
  v_start_ts      := (v_effective::text || ' ' || p_start_time::text)::timestamp;

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
    WHERE therapist_id = p_therapist_id
      AND (applied = false OR (applied = true AND revert_at IS NOT NULL AND reverted = false))
  ) THEN
    RAISE EXCEPTION 'transfer_therapist: a transfer is already pending or in progress for this staffer; cancel or wait for it first';
  END IF;

  v_immediate := v_start_ts <= v_now;
  v_revert_at := (v_start_ts + (p_duration_value || ' ' || p_duration_unit || 's')::interval) AT TIME ZONE 'Asia/Kathmandu';

  IF v_immediate THEN
    SELECT COALESCE(max(display_order), -1) + 1 INTO v_new_order
    FROM public.therapists
    WHERE branch_id = p_to_branch_id;

    UPDATE public.therapists
       SET branch_id = p_to_branch_id,
           display_order = v_new_order
     WHERE id = p_therapist_id;

    PERFORM public._sync_user_branch_for_transfer(p_therapist_id, v_caller_org, p_to_branch_id);
  END IF;

  INSERT INTO public.staff_transfers
    (therapist_id, org_id, from_branch_id, to_branch_id, transferred_by, note, effective_date,
     applied, start_time, duration_value, duration_unit, revert_at)
  VALUES
    (p_therapist_id, v_caller_org, v_from_branch, p_to_branch_id, auth.uid(), p_note, v_effective,
     v_immediate, p_start_time, p_duration_value, p_duration_unit, v_revert_at)
  RETURNING id INTO v_transfer_id;

  RETURN v_transfer_id;
END;
$$;

-- 3. extend_staff_transfer: allow 'month' in the unit validation --------------
CREATE OR REPLACE FUNCTION public.extend_staff_transfer(
  p_transfer_id      uuid,
  p_additional_value integer,
  p_additional_unit  text
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role          user_role;
  v_caller_org    uuid;
  v_caller_branch uuid;
  v_rec           record;
  v_new_revert_at timestamptz;
BEGIN
  IF p_additional_value IS NULL OR p_additional_value <= 0 THEN
    RAISE EXCEPTION 'extend_staff_transfer: additional duration must be a positive number';
  END IF;

  IF p_additional_unit IS NULL OR p_additional_unit NOT IN ('minute','hour','day','week','month') THEN
    RAISE EXCEPTION 'extend_staff_transfer: duration unit must be one of minute, hour, day, week, month';
  END IF;

  v_role          := get_user_role();
  v_caller_org    := get_user_org_id();
  v_caller_branch := get_user_branch_id();

  SELECT * INTO v_rec FROM public.staff_transfers WHERE id = p_transfer_id;

  IF v_rec.id IS NULL THEN
    RAISE EXCEPTION 'extend_staff_transfer: transfer not found';
  END IF;

  IF v_rec.org_id IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'extend_staff_transfer: not your organization';
  END IF;

  IF v_rec.revert_at IS NULL THEN
    RAISE EXCEPTION 'extend_staff_transfer: this transfer has no scheduled return time';
  END IF;

  IF NOT (
    v_role = 'admin'
    OR (v_role = 'manager' AND v_rec.to_branch_id = v_caller_branch)
  ) THEN
    RAISE EXCEPTION 'extend_staff_transfer: only an admin or the destination branch''s manager may extend this transfer';
  END IF;

  UPDATE public.staff_transfers
     SET revert_at = v_rec.revert_at + (p_additional_value || ' ' || p_additional_unit || 's')::interval,
         note = trim(both ' ' from
           COALESCE(v_rec.note || ' ', '') ||
           format('[+%s %s%s added %s]', p_additional_value, p_additional_unit, CASE WHEN p_additional_value = 1 THEN '' ELSE 's' END, to_char(now() AT TIME ZONE 'Asia/Kathmandu', 'DD Mon HH24:MI'))
         )
   WHERE id = p_transfer_id
     AND applied = true
     AND reverted = false
     AND revert_at > now()
  RETURNING revert_at INTO v_new_revert_at;

  IF v_new_revert_at IS NULL THEN
    RAISE EXCEPTION 'extend_staff_transfer: this transfer has already ended; start a new transfer instead';
  END IF;

  RETURN v_new_revert_at;
END;
$$;

-- 4. Record migration ---------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('147', 'add-month-duration-unit')
ON CONFLICT (version) DO NOTHING;
