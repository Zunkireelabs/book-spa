-- Migration 141: every staff transfer requires a duration + auto-revert (additive, REVERSIBLE)
--
-- Removes the permanent-transfer model entirely. From now on, transferring a staffer ALWAYS
-- requires a start time and a duration (Minute/Hour/Day/Week); the staffer is automatically
-- moved back to their ORIGINAL branch when that duration elapses. Historical rows created before
-- this migration have no duration data and are simply never touched by the new revert job — no
-- backfill, no behavior change for past records.
--
-- Builds on migration-038 (staff_transfers + therapists.org_id), migration-039 (transfer fn),
-- migration-041 (scheduled transfers + apply_due_staff_transfers cron + 4-arg signature), and
-- migration-048 (transfer also syncs the matching staff user's login branch_id). Idempotent
-- (IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT) and portable (no hardcoded UUIDs).
--
-- Reversible:
--   SELECT cron.unschedule('apply-due-staff-transfers');
--   PERFORM cron.schedule('apply-due-staff-transfers', '5 * * * *', 'SELECT public.apply_due_staff_transfers();');
--   DROP FUNCTION IF EXISTS public.apply_due_staff_reverts();
--   DROP FUNCTION IF EXISTS public.transfer_therapist(uuid, uuid, time, integer, text, text, date);
--   -- then re-run migration-048's CREATE OR REPLACE bodies for transfer_therapist()/apply_due_staff_transfers()
--   ALTER TABLE public.staff_transfers DROP CONSTRAINT IF EXISTS staff_transfers_duration_value_positive_chk;
--   DROP INDEX IF EXISTS public.idx_staff_transfers_pending_revert;
--   ALTER TABLE public.staff_transfers
--     DROP COLUMN IF EXISTS start_time, DROP COLUMN IF EXISTS duration_value,
--     DROP COLUMN IF EXISTS duration_unit, DROP COLUMN IF EXISTS revert_at,
--     DROP COLUMN IF EXISTS reverted, DROP COLUMN IF EXISTS reverted_at;

-- 1. New columns ---------------------------------------------------------------
-- Nullable at the DB level ONLY so historical (pre-141) rows aren't broken. The
-- transfer_therapist() function below makes them mandatory for every NEW transfer.
ALTER TABLE public.staff_transfers
  ADD COLUMN IF NOT EXISTS start_time      time,
  ADD COLUMN IF NOT EXISTS duration_value  integer,
  ADD COLUMN IF NOT EXISTS duration_unit   text CHECK (duration_unit IN ('minute','hour','day','week')),
  ADD COLUMN IF NOT EXISTS revert_at       timestamptz,
  ADD COLUMN IF NOT EXISTS reverted        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reverted_at     timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staff_transfers_duration_value_positive_chk'
  ) THEN
    ALTER TABLE public.staff_transfers
      ADD CONSTRAINT staff_transfers_duration_value_positive_chk
      CHECK (duration_value IS NULL OR duration_value > 0);
  END IF;
END $$;

-- Partial index for the revert-scan job, symmetric with idx_staff_transfers_pending.
CREATE INDEX IF NOT EXISTS idx_staff_transfers_pending_revert
  ON public.staff_transfers (revert_at)
  WHERE revert_at IS NOT NULL AND applied = true AND reverted = false;

-- 2. Replace transfer_therapist with the duration-required version -------------
-- Signature change (start_time/duration_value/duration_unit are now required, so they must
-- precede the defaulted p_note/p_effective_date) — drop the old 4-arg overload first so a
-- named-arg RPC call is never ambiguous, matching how migration-041 handled its own arg-count
-- change.
DROP FUNCTION IF EXISTS public.transfer_therapist(uuid, uuid, text, date);

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

  IF p_duration_unit IS NULL OR p_duration_unit NOT IN ('minute','hour','day','week') THEN
    RAISE EXCEPTION 'transfer_therapist: duration unit must be one of minute, hour, day, week';
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

  -- Every transfer is now duration-based: block a new one while the staffer has ANY
  -- unresolved transfer — not yet applied, OR applied but not yet reverted (currently "on loan").
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

    -- migration-048: keep the staff user's login branch in sync (staff role only).
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

REVOKE ALL ON FUNCTION public.transfer_therapist(uuid, uuid, time, integer, text, text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transfer_therapist(uuid, uuid, time, integer, text, text, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.transfer_therapist(uuid, uuid, time, integer, text, text, date) TO authenticated;

-- 3. Auto-revert: move a staffer back to their original branch once revert_at is due ----------
-- Mirrors apply_due_staff_transfers's defensive style: only acts if the staffer is STILL at the
-- destination branch (never yanks them from wherever a human may have manually moved them to
-- since); otherwise just marks the row resolved without forcing anything.
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
      SELECT COALESCE(max(display_order), -1) + 1 INTO v_new_order
      FROM public.therapists WHERE branch_id = v_rec.from_branch_id;

      UPDATE public.therapists
         SET branch_id = v_rec.from_branch_id,
             display_order = v_new_order
       WHERE id = v_rec.therapist_id;

      PERFORM public._sync_user_branch_for_transfer(v_rec.therapist_id, v_rec.org_id, v_rec.from_branch_id);

      INSERT INTO public.staff_transfers
        (therapist_id, org_id, from_branch_id, to_branch_id, transferred_by, note, effective_date, applied, start_time)
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

-- apply_due_staff_reverts is invoked by cron (the postgres role); no client grant.
REVOKE ALL ON FUNCTION public.apply_due_staff_reverts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_due_staff_reverts() FROM anon;
REVOKE ALL ON FUNCTION public.apply_due_staff_reverts() FROM authenticated;

-- 4. Reschedule the cron job to also run the revert scan, at a finer cadence -------------------
-- Bumped from hourly to every 5 minutes (same cadence as migration-108's outreach-drain-outbox
-- job) so hour/minute-scale durations revert with reasonable promptness without per-minute cron
-- overhead.
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'apply-due-staff-transfers') THEN
    PERFORM cron.unschedule('apply-due-staff-transfers');
  END IF;
  PERFORM cron.schedule(
    'apply-due-staff-transfers',
    '*/5 * * * *',
    'SELECT public.apply_due_staff_transfers(); SELECT public.apply_due_staff_reverts();'
  );
END;
$$;

-- 5. Record migration ---------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('145', 'required-transfer-duration')
ON CONFLICT (version) DO NOTHING;
