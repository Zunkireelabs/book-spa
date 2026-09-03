-- Migration 145: preserve a transferred-out therapist's ORIGINAL column position at their
-- origin branch (bugfix/feature, additive, REVERSIBLE)
--
-- Two related problems, both caused by the same root cause: therapists.display_order is a
-- single column that gets overwritten with the DESTINATION branch's ordering the moment a
-- transfer applies, so the origin branch's calendar loses any memory of where they used to sit:
--
--   1. On the origin branch's calendar, the transferred-out (grayed/filled) column always shows
--      up LAST, appended after every normal column — regardless of where they actually sat in
--      the list before leaving.
--   2. When they're auto-reverted back, apply_due_staff_reverts() also appends them to the END
--      of the origin's list (max(display_order)+1) instead of restoring their old spot.
--
-- Fix: capture the therapist's display_order AT THE ORIGIN, at the moment a transfer is
-- created (before it's ever overwritten), into a new from_display_order column. The origin
-- calendar merge (getCalendarBookings, in application code) uses this captured value to sort
-- the transferred-out column back into its original position instead of the end of the array;
-- apply_due_staff_reverts() uses it to restore the real display_order on actual return.
--
-- Builds on migration-145/146/147/148.
--
-- Reversible:
--   ALTER TABLE public.staff_transfers DROP COLUMN IF EXISTS from_display_order;
--   -- then re-run migration-148's CREATE OR REPLACE body for apply_due_staff_reverts()
--   -- and migration-147's body for transfer_therapist().

-- 1. New column ----------------------------------------------------------------
ALTER TABLE public.staff_transfers
  ADD COLUMN IF NOT EXISTS from_display_order integer;

-- 2. transfer_therapist: capture the origin display_order before it's overwritten ----------
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
     applied, start_time, duration_value, duration_unit, revert_at, from_display_order)
  VALUES
    (p_therapist_id, v_caller_org, v_from_branch, p_to_branch_id, auth.uid(), p_note, v_effective,
     v_immediate, p_start_time, p_duration_value, p_duration_unit, v_revert_at, v_from_display_order)
  RETURNING id INTO v_transfer_id;

  RETURN v_transfer_id;
END;
$$;

-- 3. apply_due_staff_reverts: restore the original origin display_order on return ----------
CREATE OR REPLACE FUNCTION public.apply_due_staff_reverts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_now            timestamptz := now();
  v_rec            record;
  v_new_order      int;
  v_current_branch uuid;
  v_count          int := 0;
BEGIN
  FOR v_rec IN
    SELECT * FROM public.staff_transfers
    WHERE revert_at IS NOT NULL AND applied = true AND reverted = false AND revert_at <= v_now
    ORDER BY revert_at
  LOOP
    SELECT branch_id INTO v_current_branch
    FROM public.therapists WHERE id = v_rec.therapist_id;

    IF v_current_branch IS NULL THEN
      UPDATE public.staff_transfers SET reverted = true, reverted_at = v_now WHERE id = v_rec.id;
      CONTINUE;
    END IF;

    IF v_current_branch = v_rec.to_branch_id THEN
      -- Prefer the captured original spot; fall back to append-at-end for legacy rows
      -- (pre-145) that never captured one, or if that slot is somehow already taken.
      IF v_rec.from_display_order IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.therapists
        WHERE branch_id = v_rec.from_branch_id AND display_order = v_rec.from_display_order
          AND id <> v_rec.therapist_id
      ) THEN
        v_new_order := v_rec.from_display_order;
      ELSE
        SELECT COALESCE(max(display_order), -1) + 1 INTO v_new_order
        FROM public.therapists WHERE branch_id = v_rec.from_branch_id;
      END IF;

      UPDATE public.therapists
         SET branch_id = v_rec.from_branch_id, display_order = v_new_order
       WHERE id = v_rec.therapist_id;

      PERFORM public._sync_user_branch_for_transfer(v_rec.therapist_id, v_rec.org_id, v_rec.from_branch_id);

      INSERT INTO public.staff_transfers
        (therapist_id, org_id, from_branch_id, to_branch_id, transferred_by, note,
         effective_date, applied, start_time)
      VALUES
        (v_rec.therapist_id, v_rec.org_id, v_rec.to_branch_id, v_rec.from_branch_id, NULL,
         'Auto-reverted after scheduled duration', (v_now AT TIME ZONE 'Asia/Kathmandu')::date, true,
         (v_now AT TIME ZONE 'Asia/Kathmandu')::time);
    ELSE
      RAISE NOTICE 'apply_due_staff_reverts: therapist % no longer at % (transfer %); skipping auto-revert, marking resolved',
        v_rec.therapist_id, v_rec.to_branch_id, v_rec.id;
    END IF;

    UPDATE public.staff_transfers SET reverted = true, reverted_at = v_now WHERE id = v_rec.id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_due_staff_reverts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_due_staff_reverts() FROM anon;
REVOKE ALL ON FUNCTION public.apply_due_staff_reverts() FROM authenticated;

-- 4. Record migration ---------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('149', 'preserve-origin-column-position')
ON CONFLICT (version) DO NOTHING;
