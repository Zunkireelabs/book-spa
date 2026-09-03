-- Migration 153: close the concurrent-transfer race condition on transfer_therapist()
-- (additive, REVERSIBLE)
--
-- transfer_therapist() (migration-150) does a SELECT EXISTS "is there already a pending/
-- in-progress transfer for this staffer?" check, then a separate INSERT — not atomic,
-- same class of bug migration-140 fixed for issue_voucher()'s manual-code path. Two
-- concurrent transfer_therapist() calls for the same therapist (e.g. two managers
-- double-clicking "Transfer" at once) could both pass the EXISTS check before either
-- INSERT lands, producing two conflicting active transfers for one staffer.
--
-- Fix mirrors migration-140: a partial UNIQUE INDEX encodes the "at most one
-- pending-or-in-progress transfer per therapist" invariant as a real DB constraint (the
-- predicate matches the existing EXISTS check's boolean logic verbatim), and the INSERT
-- is wrapped in a nested BEGIN/EXCEPTION so a duplicate that slips past the pre-check
-- still raises the same friendly message instead of a raw constraint error.
--
-- Because the index predicate is `applied = false OR (applied = true AND revert_at IS
-- NOT NULL AND reverted = false)`, a transfer drops out of the index the moment it's
-- reverted (or, for a permanent transfer, the moment it's applied with no revert_at) —
-- so this does NOT block legitimate SEQUENTIAL transfers (staffer moves to Branch B,
-- that transfer completes/reverts, then later moves to Branch C); it only blocks two
-- transfers being active/pending for the same staffer AT THE SAME TIME.
--
-- The index alone still leaves ONE gap: two Permanent transfers applied IMMEDIATELY
-- (revert_at is always NULL for those) never match the "still active" predicate, so
-- two truly simultaneous immediate-Permanent requests for the same therapist could
-- both insert successfully before either commits. A per-therapist
-- pg_advisory_xact_lock() closes that: it fully serializes every transfer_therapist()
-- call for a given therapist_id (auto-released at transaction end, so it never
-- outlives this call and can't deadlock across therapists), so the second caller
-- simply waits for the first to commit/rollback before its own EXISTS check even
-- runs. The unique index stays as defense-in-depth against any future write path
-- that bypasses this function.
--
-- Builds on migration-150. Same 8-arg signature — CREATE OR REPLACE in place, no DROP
-- FUNCTION needed since the arity isn't changing.
--
-- Reversible:
--   DROP INDEX IF EXISTS public.idx_staff_transfers_one_active_per_therapist;
--   -- then re-run migration-150's CREATE OR REPLACE body for transfer_therapist()

-- 1. Atomic uniqueness invariant --------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_transfers_one_active_per_therapist
  ON public.staff_transfers (therapist_id)
  WHERE (applied = false) OR (applied = true AND revert_at IS NOT NULL AND reverted = false);

-- 2. transfer_therapist: catch the race with a friendly message instead of raw 23505
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

  -- Serialize every transfer_therapist() call for THIS therapist. Released
  -- automatically at transaction end (commit or rollback) — never held past this
  -- call, so it can't deadlock or strand a lock across requests.
  PERFORM pg_advisory_xact_lock(hashtext('staff_transfer:' || p_therapist_id::text)::bigint);

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

  -- Fast-path, friendly-message pre-check (kept from migration-150). The nested
  -- INSERT below is the real safety net for the concurrent case: two callers can
  -- both pass this SELECT before either commits, but only one INSERT can win
  -- against idx_staff_transfers_one_active_per_therapist — the loser hits the
  -- EXCEPTION block instead of a raw unique_violation.
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

  BEGIN
    INSERT INTO public.staff_transfers
      (therapist_id, org_id, from_branch_id, to_branch_id, transferred_by, note, effective_date,
       applied, start_time, duration_value, duration_unit, revert_at, from_display_order, is_permanent)
    VALUES
      (p_therapist_id, v_caller_org, v_from_branch, p_to_branch_id, auth.uid(), p_note, v_effective,
       v_immediate, p_start_time, p_duration_value, p_duration_unit, v_revert_at, v_from_display_order, p_permanent)
    RETURNING id INTO v_transfer_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'transfer_therapist: a transfer is already pending or in progress for this staffer; cancel or wait for it first';
  END;

  RETURN v_transfer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_therapist(uuid, uuid, time, integer, text, text, date, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transfer_therapist(uuid, uuid, time, integer, text, text, date, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.transfer_therapist(uuid, uuid, time, integer, text, text, date, boolean) TO authenticated;

-- 3. Record migration ---------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('153', 'transfer-therapist-race-fix')
ON CONFLICT (version) DO NOTHING;
