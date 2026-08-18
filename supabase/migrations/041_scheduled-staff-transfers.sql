-- Migration 041: scheduled staff transfers (Phase 5 — additive, REVERSIBLE)
--
-- Lets a transfer be queued for a FUTURE date instead of only "now". The attendance
-- page sets the effective date from its date filter; a transfer effective today/past
-- applies immediately, a future one is recorded as pending and auto-applied by an
-- hourly pg_cron job (computed in Asia/Kathmandu, the business timezone).
--
-- Builds on migration-038 (staff_transfers table + therapists.org_id) and migration-039
-- (transfer_therapist fn). Idempotent (IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT)
-- and portable (no hardcoded UUIDs; resolves everything by the caller's session).
--
-- Reversible:
--   SELECT cron.unschedule('apply-due-staff-transfers');
--   DROP FUNCTION IF EXISTS public.cancel_scheduled_transfer(uuid);
--   DROP FUNCTION IF EXISTS public.apply_due_staff_transfers();
--   DROP FUNCTION IF EXISTS public.transfer_therapist(uuid, uuid, text, date);
--   DROP INDEX IF EXISTS public.idx_staff_transfers_pending;
--   ALTER TABLE public.staff_transfers DROP COLUMN IF EXISTS applied, DROP COLUMN IF EXISTS effective_date;

-- 1. New columns --------------------------------------------------------------
ALTER TABLE public.staff_transfers
  ADD COLUMN IF NOT EXISTS effective_date date    NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS applied        boolean NOT NULL DEFAULT true;

-- Partial index to find due/pending transfers cheaply.
CREATE INDEX IF NOT EXISTS idx_staff_transfers_pending
  ON public.staff_transfers (effective_date)
  WHERE applied = false;

-- 2. Replace transfer_therapist with the scheduling-aware version -------------
-- The new signature adds p_effective_date. Drop the old 3-arg overload so a
-- 3-named-arg RPC call is never ambiguous ("function is not unique").
DROP FUNCTION IF EXISTS public.transfer_therapist(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.transfer_therapist(
  p_therapist_id  uuid,
  p_to_branch_id  uuid,
  p_note          text DEFAULT NULL,
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

  -- One pending transfer per staffer at a time (avoids conflicting schedules)
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

-- 3. Apply due (pending, effective_date <= Kathmandu today) transfers ---------
-- Idempotent: only flips a staffer who is not already at the destination, then
-- marks the row applied. Safe to run repeatedly (the cron job and manual runs).
CREATE OR REPLACE FUNCTION public.apply_due_staff_transfers()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_today          date := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  v_rec            record;
  v_new_order      int;
  v_current_branch uuid;
  v_count          int := 0;
BEGIN
  FOR v_rec IN
    SELECT * FROM public.staff_transfers
    WHERE applied = false AND effective_date <= v_today
    ORDER BY effective_date, transferred_at
  LOOP
    SELECT branch_id INTO v_current_branch
    FROM public.therapists WHERE id = v_rec.therapist_id;

    IF v_current_branch IS NULL THEN
      -- staffer removed; clear the queued transfer
      UPDATE public.staff_transfers SET applied = true WHERE id = v_rec.id;
      CONTINUE;
    END IF;

    IF v_current_branch IS DISTINCT FROM v_rec.to_branch_id THEN
      SELECT COALESCE(max(display_order), -1) + 1 INTO v_new_order
      FROM public.therapists WHERE branch_id = v_rec.to_branch_id;

      UPDATE public.therapists
         SET branch_id = v_rec.to_branch_id,
             display_order = v_new_order
       WHERE id = v_rec.therapist_id;
    END IF;

    UPDATE public.staff_transfers SET applied = true WHERE id = v_rec.id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- 4. Cancel a scheduled (not-yet-applied) transfer ---------------------------
CREATE OR REPLACE FUNCTION public.cancel_scheduled_transfer(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role          user_role := get_user_role();
  v_caller_org    uuid := get_user_org_id();
  v_caller_branch uuid := get_user_branch_id();
  v_rec           record;
BEGIN
  SELECT * INTO v_rec FROM public.staff_transfers WHERE id = p_id;

  IF v_rec.id IS NULL THEN
    RAISE EXCEPTION 'cancel_scheduled_transfer: transfer not found';
  END IF;
  IF v_rec.applied THEN
    RAISE EXCEPTION 'cancel_scheduled_transfer: transfer already applied';
  END IF;
  IF v_rec.org_id IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'cancel_scheduled_transfer: not your organization';
  END IF;
  IF NOT (
    v_role = 'admin'
    OR (v_role = 'manager' AND v_rec.from_branch_id = v_caller_branch)
  ) THEN
    RAISE EXCEPTION 'cancel_scheduled_transfer: insufficient permissions';
  END IF;

  DELETE FROM public.staff_transfers WHERE id = p_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_scheduled_transfer(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_scheduled_transfer(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_scheduled_transfer(uuid) TO authenticated;

-- apply_due_staff_transfers is invoked by cron (the postgres role); no client grant.
REVOKE ALL ON FUNCTION public.apply_due_staff_transfers() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_due_staff_transfers() FROM anon;
REVOKE ALL ON FUNCTION public.apply_due_staff_transfers() FROM authenticated;

-- 5. Hourly cron job to auto-apply due transfers -----------------------------
-- Requires the pg_cron extension. On Supabase, enable it once under
-- Database → Extensions (or it is created here if you have privileges).
-- Re-schedules idempotently by unscheduling any prior job of the same name.
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'apply-due-staff-transfers') THEN
    PERFORM cron.unschedule('apply-due-staff-transfers');
  END IF;
  PERFORM cron.schedule(
    'apply-due-staff-transfers',
    '5 * * * *',
    'SELECT public.apply_due_staff_transfers();'
  );
END;
$$;

-- 6. Record migration ---------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('041', 'scheduled-staff-transfers')
ON CONFLICT (version) DO NOTHING;
