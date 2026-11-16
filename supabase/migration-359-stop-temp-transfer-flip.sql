-- Migration 359: temporary transfers no longer change branch_id; backfill open windows (ZNLY-113).
-- Home = therapists.branch_id (and the linked login's users.branch_id). A TEMPORARY transfer (revert_at set, not
-- is_permanent) only records the window in staff_transfers (applied/reverted, return-leg row, booking guards exactly
-- as before); only a PERMANENT transfer (is_permanent, or the legacy 4-arg form with no return time) moves home.
-- Redefines (from the live defs): transfer_therapist (8 args; the 4-arg legacy form is permanent already and is
-- unchanged), apply_due_staff_transfers, apply_due_staff_reverts, revert_staff_transfer_now.
-- Then sends every currently-flipped temp therapist/login back home. Idempotent. Applied: stage - / prod -.

BEGIN;

CREATE OR REPLACE FUNCTION public.transfer_therapist(p_therapist_id uuid, p_to_branch_id uuid, p_start_time time without time zone, p_duration_value integer, p_duration_unit text, p_note text DEFAULT NULL::text, p_effective_date date DEFAULT NULL::date, p_permanent boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    OR (v_role = 'manager' AND (
      v_from_branch = v_caller_branch
      OR EXISTS (SELECT 1 FROM public.user_branches WHERE user_id = auth.uid() AND branch_id = v_from_branch)
    ))
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

  -- ZNLY-113: only a permanent transfer moves home. A temporary one just records the window.
  IF v_immediate AND p_permanent THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.apply_due_staff_transfers()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_now            timestamp := now() AT TIME ZONE 'Asia/Kathmandu';
  v_rec            record;
  v_new_order      int;
  v_current_branch uuid;
  v_count          int := 0;
BEGIN
  FOR v_rec IN
    SELECT * FROM public.staff_transfers
    WHERE applied = false
      AND (effective_date::text || ' ' || COALESCE(start_time, '00:00:00'::time)::text)::timestamp <= v_now
    ORDER BY effective_date, start_time, transferred_at
  LOOP
    SELECT branch_id INTO v_current_branch
    FROM public.therapists WHERE id = v_rec.therapist_id;

    IF v_current_branch IS NULL THEN
      UPDATE public.staff_transfers SET applied = true WHERE id = v_rec.id;
      CONTINUE;
    END IF;

    IF (v_rec.is_permanent OR v_rec.revert_at IS NULL) AND v_current_branch IS DISTINCT FROM v_rec.to_branch_id THEN  -- ZNLY-113: temp windows never move home
      SELECT COALESCE(max(display_order), -1) + 1 INTO v_new_order
      FROM public.therapists WHERE branch_id = v_rec.to_branch_id;

      UPDATE public.therapists
         SET branch_id = v_rec.to_branch_id,
             display_order = v_new_order
       WHERE id = v_rec.therapist_id;

      PERFORM public._sync_user_branch_for_transfer(v_rec.therapist_id, v_rec.org_id, v_rec.to_branch_id);
    END IF;

    UPDATE public.staff_transfers SET applied = true WHERE id = v_rec.id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_due_staff_reverts()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_now            timestamptz := now();
  v_rec            record;
  v_current_branch uuid;
  v_count          int := 0;
  v_conflict_count int;
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

    -- ZNLY-113: branch_id never flipped for a temporary window, so there is nothing to move back.
    -- Booking guard unchanged: don't end the window while they still have a live booking at the receiving branch.
    SELECT count(*) INTO v_conflict_count
    FROM public.bookings b
    WHERE b.therapist_id = v_rec.therapist_id
      AND b.branch_id = v_rec.to_branch_id
      AND b.status NOT IN ('Completed', 'Cancelled', 'No Show')
      AND b.end_datetime > v_now;

    IF v_conflict_count > 0 THEN
      RAISE NOTICE 'apply_due_staff_reverts: therapist % still has % non-terminal booking% at % (transfer %); deferring auto-revert to next tick',
        v_rec.therapist_id, v_conflict_count, CASE WHEN v_conflict_count = 1 THEN '' ELSE 's' END, v_rec.to_branch_id, v_rec.id;
      CONTINUE;
    END IF;

    INSERT INTO public.staff_transfers
      (therapist_id, org_id, from_branch_id, to_branch_id, transferred_by, note,
       effective_date, applied, start_time, is_return_leg)
    VALUES
      (v_rec.therapist_id, v_rec.org_id, v_rec.to_branch_id, v_rec.from_branch_id, NULL,
       'Auto-reverted after scheduled duration', (v_now AT TIME ZONE 'Asia/Kathmandu')::date, true,
       (v_now AT TIME ZONE 'Asia/Kathmandu')::time, true);

    UPDATE public.staff_transfers SET reverted = true, reverted_at = v_now WHERE id = v_rec.id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.revert_staff_transfer_now(p_transfer_id uuid, p_reverted_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role              user_role;
  v_caller_org        uuid;
  v_caller_branch     uuid;
  v_rec               record;
  v_current_branch    uuid;
  v_new_order         int;
  v_now               timestamptz := COALESCE(p_reverted_at, now());
  v_reverted_count    int;
  v_conflict_count    int;
  v_last_end          timestamptz;
BEGIN
  SELECT * INTO v_rec FROM public.staff_transfers WHERE id = p_transfer_id;

  IF v_rec.id IS NULL THEN
    RAISE EXCEPTION 'revert_staff_transfer_now: transfer not found';
  END IF;

  v_role          := get_user_role();
  v_caller_org    := get_user_org_id();
  v_caller_branch := get_user_branch_id();

  IF v_rec.org_id IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'revert_staff_transfer_now: not your organization';
  END IF;

  IF v_rec.revert_at IS NULL THEN
    RAISE EXCEPTION 'revert_staff_transfer_now: this transfer has no scheduled return time';
  END IF;

  IF NOT (v_rec.applied = true AND v_rec.reverted = false) THEN
    RAISE EXCEPTION 'revert_staff_transfer_now: this transfer has already ended';
  END IF;

  IF p_reverted_at IS NOT NULL THEN
    IF p_reverted_at > now() THEN
      RAISE EXCEPTION 'revert_staff_transfer_now: return time cannot be in the future';
    END IF;
    IF p_reverted_at < v_rec.transferred_at THEN
      RAISE EXCEPTION 'revert_staff_transfer_now: return time cannot be before the transfer started';
    END IF;
    IF p_reverted_at >= v_rec.revert_at THEN
      RAISE EXCEPTION 'revert_staff_transfer_now: return time must be before the scheduled return';
    END IF;
  END IF;

  -- Authorization: the manager of the staffer's CURRENT (destination) branch may act (mirrors
  -- extend_staff_transfer()), since that's who is reporting them back — and so may the manager
  -- of the ORIGIN branch (from_branch_id), since they're the one who sent the staffer away and
  -- may want to cancel/recall that transfer. Either side also counts via a user_branches grant,
  -- not just the manager's single primary branch (migration-157's fix, extended here).
  IF NOT (
    v_role = 'admin'
    OR (v_role = 'manager' AND (
      v_rec.to_branch_id = v_caller_branch
      OR EXISTS (SELECT 1 FROM public.user_branches WHERE user_id = auth.uid() AND branch_id = v_rec.to_branch_id)
    ))
    OR (v_role = 'manager' AND (
      v_rec.from_branch_id = v_caller_branch
      OR EXISTS (SELECT 1 FROM public.user_branches WHERE user_id = auth.uid() AND branch_id = v_rec.from_branch_id)
    ))
  ) THEN
    RAISE EXCEPTION 'revert_staff_transfer_now: only an admin, the destination branch''s manager, or the origin branch''s manager may end this transfer';
  END IF;

  SELECT branch_id INTO v_current_branch
  FROM public.therapists WHERE id = v_rec.therapist_id;

  IF v_current_branch IS NULL THEN
    RAISE EXCEPTION 'revert_staff_transfer_now: therapist no longer exists';
  END IF;

  -- Booking guard: don't pull them off a booking that's still in progress or hasn't
  -- started/finished yet at the branch they're currently at. Any non-terminal status (Pending
  -- included — the therapist is already assigned to it) counts; only Completed/Cancelled/No Show
  -- are excluded. Report the LAST scheduled booking's end time (not just the first one that
  -- happens to conflict) so the manager sees the real all-clear time instead of retrying into a
  -- second block.
  SELECT count(*), max(b.end_datetime) INTO v_conflict_count, v_last_end
  FROM public.bookings b
  WHERE b.therapist_id = v_rec.therapist_id
    AND b.branch_id = v_rec.to_branch_id
    AND b.status NOT IN ('Completed', 'Cancelled', 'No Show')
    AND b.end_datetime > v_now;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'revert_staff_transfer_now: still booked at this branch until % (% booking%) — wait until their last scheduled booking finishes, then mark them returned (you can enter that exact time)',
      to_char(v_last_end AT TIME ZONE 'Asia/Kathmandu', 'DD Mon HH24:MI'),
      v_conflict_count,
      CASE WHEN v_conflict_count = 1 THEN '' ELSE 's' END;
  END IF;

  -- ZNLY-113: branch_id never flipped for a temporary window, so nothing moves back.

  INSERT INTO public.staff_transfers
    (therapist_id, org_id, from_branch_id, to_branch_id, transferred_by, note,
     effective_date, applied, start_time, is_return_leg)
  VALUES
    (v_rec.therapist_id, v_rec.org_id, v_rec.to_branch_id, v_rec.from_branch_id, auth.uid(),
     'Returned early (marked by manager)', (v_now AT TIME ZONE 'Asia/Kathmandu')::date, true,
     (v_now AT TIME ZONE 'Asia/Kathmandu')::time, true);

  UPDATE public.staff_transfers
     SET reverted = true, reverted_at = v_now
   WHERE id = p_transfer_id
     AND applied = true
     AND reverted = false;

  GET DIAGNOSTICS v_reverted_count = ROW_COUNT;

  IF v_reverted_count = 0 THEN
    RAISE EXCEPTION 'revert_staff_transfer_now: this transfer has already ended';
  END IF;

  RETURN v_now;
END;
$function$;

-- Backfill: send every flipped temp therapist (and linked login) back to the origin branch. Rows already past
-- revert_at are also marked reverted (the cron would have done it).
DO $$
DECLARE
  r record;
  v_order int;
BEGIN
  FOR r IN
    SELECT st.*, t.branch_id AS cur_branch
      FROM public.staff_transfers st
      JOIN public.therapists t ON t.id = st.therapist_id
     WHERE st.applied = true AND st.reverted = false AND st.is_return_leg = false
       AND st.is_permanent = false AND st.revert_at IS NOT NULL
  LOOP
    IF r.cur_branch = r.to_branch_id THEN
      IF r.from_display_order IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.therapists WHERE branch_id = r.from_branch_id AND display_order = r.from_display_order AND id <> r.therapist_id
      ) THEN
        v_order := r.from_display_order;
      ELSE
        SELECT COALESCE(max(display_order), -1) + 1 INTO v_order FROM public.therapists WHERE branch_id = r.from_branch_id;
      END IF;
      UPDATE public.therapists SET branch_id = r.from_branch_id, display_order = v_order WHERE id = r.therapist_id;
      PERFORM public._sync_user_branch_for_transfer(r.therapist_id, r.org_id, r.from_branch_id);
    END IF;
    IF r.revert_at <= now() THEN
      UPDATE public.staff_transfers SET reverted = true, reverted_at = r.revert_at WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('359', 'stop-temp-transfer-flip')
ON CONFLICT (version) DO NOTHING;

COMMIT;
