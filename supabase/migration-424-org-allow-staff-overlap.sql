-- Migration 424: per-org setting "allow staff overlap" (organizations.allow_staff_overlap, default OFF)
--
-- Why: some tenants (Sami's) really do book one staff member on two overlapping appointments; the database refuses that
-- (excl_therapist_overlap, mig 414). The rule becomes a per-org switch instead of a bypass. Orgs with the switch OFF
-- (every org today, Nuad Thai included) behave exactly as before: same constraint, same triggers, same error text.
--
-- Design:
--   * organizations.allow_staff_overlap boolean NOT NULL DEFAULT false (every existing org is false).
--   * bookings.allows_overlap / booking_combo_items.allows_overlap: stamped ONLY by a BEFORE INSERT trigger from the org
--     setting (a client-supplied value is overwritten) and immutable afterwards (own trigger: enforce_booking_immutability has
--     an admin escape hatch). Toggling the org setting later never changes an existing row. A reschedule keeps its stamp.
--   * excl_therapist_overlap, excl_combo_item_therapist_overlap, the junction trigger and the combo-item trigger exempt ONLY
--     stamped-true rows. The OVERLAP rows of therapist_unavailable_ranges (the single source for the staff picker, the
--     public availability RPCs and check_therapist_booking_guards) follow the same rule. Leave, shift, break, block,
--     branch, service-eligibility and room checks are untouched and apply to everyone.
--   * The constraint is rebuilt from its LIVE definition (+ AND NOT allows_overlap), so it keeps whatever predicate the
--     database already has (local: schema.sql form; prod: mig 414 form with the go-live cutoff).
--
-- Idempotent. Reversible (manual):
--   restore the constraint predicate without "AND NOT allows_overlap", drop the triggers trg_00_bookings_stamp_allows_overlap /
--   trg_0_a_combo_item_stamp_allows_overlap and their functions, drop the two allows_overlap columns and the org column,
--   and re-run migration 414 / 363 / 288 function bodies.

BEGIN;

ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS allow_staff_overlap boolean NOT NULL DEFAULT false;
-- explicit, not just the column default: no org changes behaviour by this migration
UPDATE public.organizations SET allow_staff_overlap = false WHERE allow_staff_overlap IS DISTINCT FROM false;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS allows_overlap boolean NOT NULL DEFAULT false;
ALTER TABLE public.booking_combo_items ADD COLUMN IF NOT EXISTS allows_overlap boolean NOT NULL DEFAULT false;

-- 1. stamp triggers -----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stamp_booking_allows_overlap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_flag text := current_setting('app.overlap_stamp', true);
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_flag IN ('true', 'false') THEN           -- reschedule_booking copies the stamp of the booking it replaces
      NEW.allows_overlap := (v_flag = 'true');
    ELSE
      SELECT COALESCE(o.allow_staff_overlap, false) INTO NEW.allows_overlap
        FROM public.branches br JOIN public.organizations o ON o.id = br.org_id WHERE br.id = NEW.branch_id;
      NEW.allows_overlap := COALESCE(NEW.allows_overlap, false);
    END IF;
  ELSIF NEW.allows_overlap IS DISTINCT FROM OLD.allows_overlap THEN
    RAISE EXCEPTION 'ALLOWS_OVERLAP_PROTECTED: allows_overlap is set when a booking is created and cannot be changed.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.stamp_booking_allows_overlap() FROM PUBLIC, anon, authenticated;

-- trg_00_ sorts before every other bookings trigger, so the stamp is final when the guards run
DROP TRIGGER IF EXISTS trg_00_bookings_stamp_allows_overlap ON public.bookings;
CREATE TRIGGER trg_00_bookings_stamp_allows_overlap
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.stamp_booking_allows_overlap();

CREATE OR REPLACE FUNCTION public.stamp_combo_item_allows_overlap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT COALESCE(b.allows_overlap, false) INTO NEW.allows_overlap FROM public.bookings b WHERE b.id = NEW.booking_id;
    NEW.allows_overlap := COALESCE(NEW.allows_overlap, false);
  ELSIF NEW.allows_overlap IS DISTINCT FROM OLD.allows_overlap THEN
    RAISE EXCEPTION 'ALLOWS_OVERLAP_PROTECTED: allows_overlap is set when a booking is created and cannot be changed.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.stamp_combo_item_allows_overlap() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_0_a_combo_item_stamp_allows_overlap ON public.booking_combo_items;
CREATE TRIGGER trg_0_a_combo_item_stamp_allows_overlap
  BEFORE INSERT OR UPDATE ON public.booking_combo_items
  FOR EACH ROW EXECUTE FUNCTION public.stamp_combo_item_allows_overlap();

-- 2. exclusion constraints: exempt stamped rows only, keeping the live predicate ---------------------------------------
DO $$
DECLARE r record; v_def text; v_at int;
BEGIN
  FOR r IN SELECT * FROM (VALUES ('bookings', 'excl_therapist_overlap'),
                                 ('booking_combo_items', 'excl_combo_item_therapist_overlap')) AS t(tbl, cname)
  LOOP
    SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_constraint c
     WHERE c.conname = r.cname AND c.conrelid = ('public.' || r.tbl)::regclass;
    IF v_def IS NULL THEN
      RAISE EXCEPTION 'migration 424: constraint % on % not found; expected from schema.sql / migration 414', r.cname, r.tbl;
    END IF;
    IF v_def LIKE '%allows_overlap%' THEN CONTINUE; END IF;   -- already migrated
    v_at := position(' WHERE (' IN v_def);
    IF v_at = 0 THEN
      RAISE EXCEPTION 'migration 424: constraint % has no WHERE predicate (%)', r.cname, v_def;
    END IF;
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.tbl, r.cname);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I %s AND NOT allows_overlap)',
                   r.tbl, r.cname, left(v_def, length(v_def) - 1));
  END LOOP;
END $$;

-- 4. functions ------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_therapist_junction_overlap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_cutoff constant timestamptz := '2026-11-21 18:15:00+00';
  v_bid uuid; v_tid uuid; v_start timestamptz; v_end timestamptz;
  b record;
BEGIN
  IF TG_TABLE_NAME = 'bookings' THEN
    -- a booking's own therapist against companions of OTHER bookings
    IF NEW.therapist_id IS NULL OR NEW.status IN ('Cancelled', 'No Show')
       OR NEW.date IS NULL OR NEW.start_time IS NULL OR NEW.end_time IS NULL THEN
      RETURN NEW;
    END IF;
    IF NEW.allows_overlap THEN  -- ZNLY org setting: this booking was created while its org allowed staff overlap
      RETURN NEW;
    END IF;
    -- from date + time (the source of truth), not start_datetime: the compute trigger that fills it may fire after this one
    v_start := (NEW.date + NEW.start_time) AT TIME ZONE 'Asia/Kathmandu';
    v_end   := (NEW.date + NEW.end_time) AT TIME ZONE 'Asia/Kathmandu';
    IF v_start < c_cutoff THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.therapist_id IS NOT DISTINCT FROM OLD.therapist_id
       AND NEW.date IS NOT DISTINCT FROM OLD.date AND NEW.start_time IS NOT DISTINCT FROM OLD.start_time
       AND NEW.end_time IS NOT DISTINCT FROM OLD.end_time AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
      RETURN NEW;
    END IF;
    v_bid := NEW.id; v_tid := NEW.therapist_id;
    IF EXISTS (
      SELECT 1 FROM public.booking_therapists bt JOIN public.bookings b2 ON b2.id = bt.booking_id
      WHERE bt.therapist_id = v_tid AND b2.id <> v_bid AND b2.status NOT IN ('Cancelled', 'No Show')
        AND tstzrange((b2.date + COALESCE(bt.start_time, b2.start_time)) AT TIME ZONE 'Asia/Kathmandu',
                      (b2.date + COALESCE(bt.end_time, b2.end_time)) AT TIME ZONE 'Asia/Kathmandu') && tstzrange(v_start, v_end)
    ) THEN
      RAISE EXCEPTION 'THERAPIST_CONFLICT: This therapist already has a booking at that time. Pick another time or person.'
        USING ERRCODE = '23P01', CONSTRAINT = 'excl_therapist_overlap';
    END IF;
    RETURN NEW;
  END IF;

  -- booking_therapists row against other bookings (primary) and other junction rows
  SELECT id, date, start_time, end_time, status, allows_overlap INTO b FROM public.bookings WHERE id = NEW.booking_id;
  IF b.id IS NULL OR b.status IN ('Cancelled', 'No Show') OR b.allows_overlap THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.booking_id IS NOT DISTINCT FROM OLD.booking_id
     AND NEW.therapist_id IS NOT DISTINCT FROM OLD.therapist_id
     AND NEW.start_time IS NOT DISTINCT FROM OLD.start_time
     AND NEW.end_time IS NOT DISTINCT FROM OLD.end_time THEN
    RETURN NEW;
  END IF;
  v_start := (b.date + COALESCE(NEW.start_time, b.start_time)) AT TIME ZONE 'Asia/Kathmandu';
  v_end   := (b.date + COALESCE(NEW.end_time, b.end_time)) AT TIME ZONE 'Asia/Kathmandu';
  IF v_start IS NULL OR v_end IS NULL OR v_start < c_cutoff THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.bookings b2
    WHERE b2.therapist_id = NEW.therapist_id AND b2.id <> NEW.booking_id AND b2.status NOT IN ('Cancelled', 'No Show')
      AND tstzrange(b2.start_datetime, b2.end_datetime) && tstzrange(v_start, v_end)
  ) OR EXISTS (
    SELECT 1 FROM public.booking_therapists bt JOIN public.bookings b2 ON b2.id = bt.booking_id
    WHERE bt.therapist_id = NEW.therapist_id AND bt.booking_id <> NEW.booking_id AND b2.status NOT IN ('Cancelled', 'No Show')
      AND tstzrange((b2.date + COALESCE(bt.start_time, b2.start_time)) AT TIME ZONE 'Asia/Kathmandu',
                    (b2.date + COALESCE(bt.end_time, b2.end_time)) AT TIME ZONE 'Asia/Kathmandu') && tstzrange(v_start, v_end)
  ) THEN
    RAISE EXCEPTION 'THERAPIST_CONFLICT: This therapist already has a booking at that time. Pick another time or person.'
      USING ERRCODE = '23P01', CONSTRAINT = 'excl_therapist_overlap';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_booking_combo_item_therapist_conflict()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conflict_count integer;
  v_booking_status text;
BEGIN
  IF NEW.therapist_id IS NULL OR NEW.start_datetime IS NULL OR NEW.allows_overlap THEN
    RETURN NEW;
  END IF;

  SELECT status INTO v_booking_status FROM bookings WHERE id = NEW.booking_id;
  IF v_booking_status IN ('Cancelled', 'No Show') THEN
    RETURN NEW;
  END IF;

  SELECT
    (SELECT count(*)
       FROM bookings b
       WHERE b.therapist_id = NEW.therapist_id
         AND b.status NOT IN ('Cancelled', 'No Show')
         AND b.id != NEW.booking_id
         AND tstzrange(b.start_datetime, b.end_datetime) && tstzrange(NEW.start_datetime, NEW.end_datetime))
    +
    (SELECT count(*)
       FROM booking_therapists bt
       JOIN bookings b2 ON b2.id = bt.booking_id
       WHERE bt.therapist_id = NEW.therapist_id
         AND b2.status NOT IN ('Cancelled', 'No Show')
         AND bt.booking_id != NEW.booking_id
         AND tstzrange(
               (b2.date + COALESCE(bt.start_time, b2.start_time)) AT TIME ZONE 'Asia/Kathmandu',
               (b2.date + COALESCE(bt.end_time, b2.end_time)) AT TIME ZONE 'Asia/Kathmandu'
             ) && tstzrange(NEW.start_datetime, NEW.end_datetime))
    +
    (SELECT count(*)
       FROM booking_combo_items bci
       JOIN bookings b3 ON b3.id = bci.booking_id
       WHERE bci.therapist_id = NEW.therapist_id
         AND b3.status NOT IN ('Cancelled', 'No Show')
         AND (TG_OP = 'INSERT' OR bci.id != NEW.id)
         AND bci.start_datetime IS NOT NULL
         AND tstzrange(bci.start_datetime, bci.end_datetime) && tstzrange(NEW.start_datetime, NEW.end_datetime))
  INTO v_conflict_count;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'THERAPIST_CONFLICT: Therapist is already booked during this time slot.'
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.therapist_unavailable_ranges(p_therapist_id uuid, p_date date, p_branch_id uuid DEFAULT NULL::uuid, p_exclude_booking_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(start_min integer, end_min integer, code text, reason text, label text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_branch uuid;
  v_shift  jsonb;
  v_day0   timestamptz := (p_date::timestamp AT TIME ZONE 'Asia/Kathmandu');
  v_day1   timestamptz := ((p_date + 1)::timestamp AT TIME ZONE 'Asia/Kathmandu');
  v_allow  boolean;
BEGIN
  SELECT COALESCE(p_branch_id, t.branch_id) INTO v_branch FROM public.therapists t WHERE t.id = p_therapist_id;
  v_shift := public.therapist_shift_for(p_therapist_id, p_date, v_branch);

  -- Staff-overlap rule: an existing booking is judged by its own stamp (bookings.allows_overlap); a booking that does not exist
  -- yet by its org's current setting (which is what the stamp trigger will write). The one place every reader and guard asks.
  v_allow := COALESCE(
    (SELECT b0.allows_overlap FROM public.bookings b0 WHERE b0.id = p_exclude_booking_id),
    (SELECT o.allow_staff_overlap FROM public.branches br JOIN public.organizations o ON o.id = br.org_id WHERE br.id = v_branch),
    false);

  -- full-day leave
  RETURN QUERY SELECT 0, 1440, 'ON_LEAVE'::text, 'leave_full'::text, ta.status::text
    FROM public.therapist_attendance ta
   WHERE ta.therapist_id = p_therapist_id AND ta.date = p_date
     AND ta.status::text IN ('Absent', 'Leave', 'Annual Leave', 'Sick Leave', 'Day Off');
  -- half-day leave
  RETURN QUERY SELECT (x->>'start_min')::int, (x->>'end_min')::int, 'ON_LEAVE'::text, 'leave_half'::text, NULL::text
    FROM jsonb_array_elements(v_shift->'off') x;

  -- shift
  IF NOT (v_shift->>'works')::boolean THEN
    RETURN QUERY SELECT 0, 1440, 'OFF_SHIFT'::text, 'day_off'::text, NULL::text;
  ELSIF v_shift->>'start_min' IS NOT NULL THEN
    IF (v_shift->>'start_min')::int > 0 THEN
      RETURN QUERY SELECT 0, (v_shift->>'start_min')::int, 'OFF_SHIFT'::text, 'before_shift'::text, NULL::text;
    END IF;
    IF (v_shift->>'end_min')::int < 1440 THEN
      RETURN QUERY SELECT (v_shift->>'end_min')::int, 1440, 'OFF_SHIFT'::text, 'after_shift'::text, NULL::text;
    END IF;
  END IF;

  -- breaks
  RETURN QUERY SELECT (x->>'start_min')::int, (x->>'end_min')::int, 'ON_BREAK'::text, 'break'::text, x->>'name'
    FROM jsonb_array_elements(v_shift->'breaks') x
   WHERE (v_shift->>'works')::boolean;

  -- manual blocks: this therapist's, and whole-location ones (no room, no therapist) at the booking branch
  RETURN QUERY
  SELECT (EXTRACT(EPOCH FROM mb.start_time) / 60)::int,
         LEAST(1440, (EXTRACT(EPOCH FROM mb.start_time) / 60)::int + mb.duration_minutes),
         'BLOCKED'::text, 'block'::text, mb.description
    FROM public.manual_blocks mb
   CROSS JOIN LATERAL (
     SELECT public.manual_block_occurrence_date(mb.block_date, mb.recurrence_freq, mb.recurrence_interval, n) AS occ_date
       FROM generate_series(0, CASE WHEN mb.recurrence_freq IS NULL THEN 0 ELSE LEAST(COALESCE(mb.recurrence_count, 500) - 1, 500) END) AS n
   ) occ
   WHERE (mb.therapist_id = p_therapist_id OR (mb.therapist_id IS NULL AND mb.room_id IS NULL AND mb.branch_id = v_branch))
     AND mb.is_cancelled = false
     AND mb.block_date <= p_date
     AND occ.occ_date = p_date
     AND (mb.recurrence_end_date IS NULL OR occ.occ_date <= mb.recurrence_end_date)
     AND NOT EXISTS (SELECT 1 FROM public.manual_block_exceptions mbe
                      WHERE mbe.series_id = mb.series_id AND mbe.exception_date = occ.occ_date);

  -- transfer windows: while a window is open the therapist is bookable only at its destination.
  -- A window ends at revert_at / reverted_at, or when the next transfer of the same therapist starts.
  RETURN QUERY
  WITH w AS (
    SELECT st.to_branch_id, st.revert_at, st.reverted, st.reverted_at,
           ((st.effective_date + COALESCE(st.start_time, '00:00'::time)) AT TIME ZONE 'Asia/Kathmandu') AS ws
      FROM public.staff_transfers st WHERE st.therapist_id = p_therapist_id
  ), w2 AS (
    SELECT w.*, LEAST(COALESCE(w.revert_at, 'infinity'::timestamptz),
                      CASE WHEN w.reverted THEN COALESCE(w.reverted_at, w.ws) ELSE 'infinity'::timestamptz END,
                      COALESCE(lead(w.ws) OVER (ORDER BY w.ws), 'infinity'::timestamptz)) AS we
      FROM w
  )
  SELECT GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (w2.ws - v_day0)) / 60)::int),
         LEAST(1440, CASE WHEN w2.we = 'infinity' THEN 1440 ELSE CEIL(EXTRACT(EPOCH FROM (w2.we - v_day0)) / 60)::int END),
         'OTHER_BRANCH'::text, 'other_branch'::text, (SELECT name FROM public.branches WHERE id = w2.to_branch_id)
    FROM w2
   WHERE w2.to_branch_id <> v_branch AND w2.ws < v_day1 AND w2.we > v_day0;

  -- ZNLY-113: away from home, they are bookable here only inside a window into this branch. Mark every other minute.
  IF v_branch IS DISTINCT FROM (SELECT t.branch_id FROM public.therapists t WHERE t.id = p_therapist_id) THEN
    RETURN QUERY
    -- Every minute of the day OUTSIDE the union of this branch's windows (two visits in one day leave the gap between them marked too).
    WITH wins AS (
      SELECT GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (w.ws - v_day0)) / 60)::int) AS s,
             CASE WHEN w.we = 'infinity' THEN 1440 ELSE LEAST(1440, CEIL(EXTRACT(EPOCH FROM (w.we - v_day0)) / 60)::int) END AS e
        FROM public._staff_transfer_windows(ARRAY[p_therapist_id]) w
       WHERE w.to_branch_id = v_branch AND NOT w.is_return_leg AND NOT w.is_permanent
         AND w.ws < v_day1 AND w.we > v_day0
    ), ordered AS (
      SELECT o.s, COALESCE(max(o.e) OVER (ORDER BY o.s, o.e ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS prev_e FROM wins o
    ), gaps AS (
      SELECT ordered.prev_e AS s, ordered.s AS e FROM ordered WHERE ordered.s > ordered.prev_e
      UNION ALL
      SELECT COALESCE((SELECT max(wins.e) FROM wins), 0), 1440
    ), home AS (SELECT (SELECT name FROM public.branches WHERE id = t.branch_id) AS n FROM public.therapists t WHERE t.id = p_therapist_id)
    SELECT g.s, g.e, 'OTHER_BRANCH'::text, 'other_branch'::text, (SELECT n FROM home)
      FROM gaps g
     WHERE g.e > g.s;
  END IF;

  IF NOT v_allow THEN
    -- overlapping bookings: own, companion (junction) and combo items
    RETURN QUERY
    SELECT GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (b.start_datetime - v_day0)) / 60)::int),
           LEAST(1440, CEIL(EXTRACT(EPOCH FROM (b.end_datetime - v_day0)) / 60)::int),
           'OVERLAP'::text, 'booking'::text, b.booking_number
      FROM public.bookings b
     WHERE b.therapist_id = p_therapist_id AND b.status NOT IN ('Cancelled', 'No Show')
       AND (p_exclude_booking_id IS NULL OR b.id <> p_exclude_booking_id)
       AND b.start_datetime < v_day1 AND b.end_datetime > v_day0;
    RETURN QUERY
    SELECT GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (x.s - v_day0)) / 60)::int),
           LEAST(1440, CEIL(EXTRACT(EPOCH FROM (x.e - v_day0)) / 60)::int),
           'OVERLAP'::text, 'booking'::text, x.num
      FROM (
        SELECT (b2.date + COALESCE(bt.start_time, b2.start_time)) AT TIME ZONE 'Asia/Kathmandu' AS s,
               (b2.date + COALESCE(bt.end_time, b2.end_time)) AT TIME ZONE 'Asia/Kathmandu' AS e,
               b2.booking_number AS num
          FROM public.booking_therapists bt JOIN public.bookings b2 ON b2.id = bt.booking_id
         WHERE bt.therapist_id = p_therapist_id AND b2.status NOT IN ('Cancelled', 'No Show')
           AND (p_exclude_booking_id IS NULL OR bt.booking_id <> p_exclude_booking_id)
           AND b2.date BETWEEN p_date - 1 AND p_date + 1
        UNION ALL
        SELECT bci.start_datetime, bci.end_datetime, b3.booking_number
          FROM public.booking_combo_items bci JOIN public.bookings b3 ON b3.id = bci.booking_id
         WHERE bci.therapist_id = p_therapist_id AND b3.status NOT IN ('Cancelled', 'No Show')
           AND bci.start_datetime IS NOT NULL
           AND (p_exclude_booking_id IS NULL OR bci.booking_id <> p_exclude_booking_id)
      ) x
     WHERE x.s < v_day1 AND x.e > v_day0;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reschedule_booking(p_booking_id uuid, p_date date, p_start_time time without time zone, p_therapist_id uuid, p_room_id uuid, p_reason text, p_override_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role            user_role := get_user_role();
  v_org             uuid      := get_user_org_id();
  v_orig            record;
  v_branch_org      uuid;
  v_room_id         uuid;
  v_new_id          uuid := gen_random_uuid();
  v_new_number      text;
  v_therapist_name  text;
  v_room_name       text;
  v_base            numeric(10,2);
  v_discount        numeric(10,2);
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('staff', 'manager', 'admin') THEN
    RAISE EXCEPTION 'reschedule_booking: staff, manager, or admin role required';
  END IF;

  SELECT * INTO v_orig FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reschedule_booking: booking % not found', p_booking_id;
  END IF;

  SELECT br.org_id INTO v_branch_org FROM public.branches br WHERE br.id = v_orig.branch_id;
  IF v_branch_org IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'reschedule_booking: booking does not belong to your organization';
  END IF;

  IF v_role <> 'admin' AND NOT (v_orig.branch_id = ANY (get_user_branch_ids())) THEN
    RAISE EXCEPTION 'reschedule_booking: booking is not at one of your branches';
  END IF;

  IF v_orig.status IN ('Completed', 'Cancelled', 'No Show') THEN
    RAISE EXCEPTION 'reschedule_booking: cannot reschedule a % booking', v_orig.status
      USING ERRCODE = 'P0002';
  END IF;

  IF v_orig.is_locked THEN
    RAISE EXCEPTION 'DAY_LOCKED: This day has been closed. No further modifications allowed.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_orig.payment_status IN ('paid', 'partial') THEN
    RAISE EXCEPTION 'BOOKING_PAID: This booking is already paid — cancel and refund it explicitly, or collect the difference, before rescheduling.'
      USING ERRCODE = 'P0006';
  END IF;

  -- Keep the original's room when the caller doesn't name one (therapist-column
  -- drop), matching createBooking's intent without duplicating its auto-assign
  -- search. bookings.room_id is NOT NULL, so v_orig.room_id is always set.
  v_room_id := COALESCE(p_room_id, v_orig.room_id);

  IF p_therapist_id IS NOT NULL THEN
    SELECT name INTO v_therapist_name FROM public.therapists WHERE id = p_therapist_id;
  END IF;
  IF v_room_id IS NOT NULL THEN
    SELECT name INTO v_room_name FROM public.rooms WHERE id = v_room_id;
  END IF;

  -- ZNLY-208: a tiered service is priced from the NEW team member's tier (nobody assigned / no tier = the standard price). Combo
  -- bookings keep their per-part prices. Nothing is paid here (guard above), so the price is free to move. A rupee discount stays
  -- a discount on top of the new price and never exceeds it.
  v_base := v_orig.base_amount;
  IF EXISTS (SELECT 1 FROM public.services s WHERE s.id = v_orig.service_id AND s.price_type = 'tiered')
     AND NOT EXISTS (SELECT 1 FROM public.booking_combo_items ci WHERE ci.booking_id = v_orig.id) THEN
    v_base := public.service_price_for_therapist(v_orig.service_id, p_therapist_id);
  END IF;
  v_discount := LEAST(v_orig.discount_amount, v_base);

  -- Cancel the original BEFORE inserting the new row: this releases its room and
  -- therapist so the new row's INSERT is checked against excl_therapist_overlap /
  -- check_room_capacity without the original still holding the slot it's moving
  -- out of. Same transaction, so atomicity is unchanged.
  UPDATE public.bookings
  SET status = 'Cancelled', cancellation_reason = p_reason
  WHERE id = p_booking_id;

  -- Bypass trg_bookings_require_phone (migration-263) for this one copy-forward
  -- INSERT: v_orig.customer_phone may be blank on a pre-migration booking, and
  -- rescheduling it must keep working exactly as before. SET LOCAL is
  -- transaction-scoped and resets automatically — nothing leaks past this call.
  PERFORM set_config('app.skip_phone_check', 'on', true);
  -- the moved booking keeps the staff-overlap stamp of the one it replaces (the stamp trigger honours this, then it is cleared)
  PERFORM set_config('app.overlap_stamp', v_orig.allows_overlap::text, true);

  -- New booking: same branch/service/customer/pricing/discount as the original;
  -- date/start_time/therapist/room take the new values. Status starts Pending —
  -- triggers compute end_time, start/end_datetime, final_amount, booking_number.
  INSERT INTO public.bookings (
    id, branch_id, room_id, service_id, therapist_id,
    customer_name, customer_email, customer_phone, customer_gender,
    date, start_time, status,
    special_requests, payment_status,
    base_amount, discount_amount, discount_status, discount_approved_by,
    discount_reason, discount_requested_by, discount_requested_to,
    customer_id, service_name_snapshot, service_duration_snapshot,
    service_price_snapshot, service_category_snapshot,
    therapist_name_snapshot, room_name_snapshot,
    created_by, booking_group_id, referred_by,
    referral_commission_type, referral_commission_value,
    customer_account_id, referral_source, referral_source_detail,
    due_holder_name, companion_name, companion_phone, availability_override_reason
  )
  VALUES (
    v_new_id, v_orig.branch_id, v_room_id, v_orig.service_id, p_therapist_id,
    v_orig.customer_name, v_orig.customer_email, v_orig.customer_phone, v_orig.customer_gender,
    p_date, p_start_time, 'Pending',
    v_orig.special_requests, 'unpaid',
    v_base, v_discount, v_orig.discount_status, v_orig.discount_approved_by,
    v_orig.discount_reason, v_orig.discount_requested_by, v_orig.discount_requested_to,
    v_orig.customer_id, v_orig.service_name_snapshot, v_orig.service_duration_snapshot,
    v_orig.service_price_snapshot, v_orig.service_category_snapshot,
    v_therapist_name, v_room_name,
    auth.uid(), v_orig.booking_group_id, v_orig.referred_by,
    v_orig.referral_commission_type, v_orig.referral_commission_value,
    v_orig.customer_account_id, v_orig.referral_source, v_orig.referral_source_detail,
    v_orig.due_holder_name, v_orig.companion_name, v_orig.companion_phone, NULLIF(btrim(COALESCE(p_override_reason, '')), '')
  );

  PERFORM set_config('app.overlap_stamp', '', true);

  -- the reason only authorises THIS insert; never leave it on the row
  UPDATE public.bookings SET availability_override_reason = NULL WHERE id = v_new_id AND availability_override_reason IS NOT NULL;

  SELECT booking_number INTO v_new_number FROM public.bookings WHERE id = v_new_id;

  RETURN jsonb_build_object('id', v_new_id, 'booking_number', v_new_number);
END;
$function$;

-- Admin-only switch (organizations has no UPDATE policy, same pattern as set_enforce_staff_availability, migration 357).
CREATE OR REPLACE FUNCTION public.set_allow_staff_overlap(p_value boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org_id uuid := (SELECT get_user_org_id());
  v_new    boolean;
BEGIN
  IF (SELECT get_user_role()) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'set_allow_staff_overlap: admin only' USING ERRCODE = '42501';
  END IF;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'set_allow_staff_overlap: no organization context';
  END IF;
  UPDATE public.organizations SET allow_staff_overlap = COALESCE(p_value, false) WHERE id = v_org_id RETURNING allow_staff_overlap INTO v_new;
  IF v_new IS NULL THEN
    RAISE EXCEPTION 'set_allow_staff_overlap: organization % not found', v_org_id;
  END IF;
  RETURN v_new;
END $$;
REVOKE ALL ON FUNCTION public.set_allow_staff_overlap(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_allow_staff_overlap(boolean) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('424', 'org-allow-staff-overlap')
ON CONFLICT (version) DO NOTHING;

COMMIT;
