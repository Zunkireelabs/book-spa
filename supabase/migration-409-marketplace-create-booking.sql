-- Migration 409 (ZNLY-332): marketplace booking, bookX side, part 1.
-- Ported from Anish's branch zennly-connectors (his 335 + 340, final version), rebuilt to match stage's current rules.
--   * organizations.marketplace_booking_enabled (default false): per-org opt-in, the gate public_create_booking checks.
--   * public_create_booking: service_role only (called by the marketplace-create-booking edge function).
--       - Server safety checks, each returning success:false + error_code + a plain message, run before any write:
--           IN_THE_PAST, CLOSED_DATE (migration-390 _closed_online_dates), BRANCH_CLOSED / OUTSIDE_OPENING_HOURS (start before open or end after close)
--           (branch_working_hours per weekday, else branches.open_time/close_time: the slot grid's rule).
--       - Customer link via create_customer_for_booking (ZNLY-274, migration-402): no overwrite of an existing customer.
--       - The booking is inserted with created_by NULL, so it counts as online: it appears in the Booking Inbox
--         (migration-335 trigger) and the calendar. bookings.is_walk_in stays false.
--       - All of Anish's other checks are kept (org opt-in, branch/service org boundary, rooms capacity, therapist
--         active/branch/absent/checked-out/eligibility, idempotent client_request_id replay, trigger error mapping).
--   * The booking is tagged bookings.booking_source = 'marketplace' (column added by migration 412, applied right after;
--     the function only reads it when called, so the order inside one deploy is safe).
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE with one signature (only one overload exists on stage and prod).
-- Rollback (manual): DROP FUNCTION public.public_create_booking(text, uuid, uuid, date, time, text, text, text, text, text, text, uuid[], uuid, jsonb, uuid);
--   ALTER TABLE public.organizations DROP COLUMN IF EXISTS marketplace_booking_enabled;

BEGIN;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS marketplace_booking_enabled boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.public_create_booking(
  p_org_slug text,
  p_branch_id uuid,
  p_service_id uuid,
  p_date date,
  p_start_time time,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_customer_gender text,
  p_special_requests text,
  p_gender_preference text,
  p_therapist_ids uuid[] DEFAULT NULL,
  p_room_id uuid DEFAULT NULL,
  p_therapist_room_overrides jsonb DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_industry_type text;
  v_enable_rooms boolean;
  v_service record;
  v_branch record;
  v_end_time time;
  v_room record;
  v_available_room_id uuid;
  v_available_room_name text;
  v_customer_id uuid;
  v_phone text;
  v_email text;
  v_existing record;
  v_primary_therapist_id uuid;
  v_all_therapist_ids uuid[];
  v_therapist_name_snapshot text;
  v_at_dt timestamptz;
  v_therapist_count int;
  v_resolved_base_amount numeric;
  v_tier_price numeric;
  v_booking record;
  v_existing_booking record;
  v_room_count int;
  v_idx int;
  v_tid uuid;
  v_override_room uuid;
  v_junction_room uuid;
  rec record;
  v_dow smallint;
  v_wh record;
  v_open time;
  v_close time;
  v_start_at timestamptz;
  v_gender_pref text;
BEGIN
  ----------------------------------------------------------------
  -- 0. Idempotent replay: an existing row with this key wins outright.
  ----------------------------------------------------------------
  IF p_idempotency_key IS NOT NULL THEN
    -- Scoped to the caller's org (resolved without the opt-in flag, so a replay still works if the org was switched
    -- off after the booking). A key that belongs to another org's booking is refused without returning any of its data.
    SELECT o.id INTO v_org_id FROM public.organizations o WHERE o.slug = p_org_slug AND o.is_active = true;

    IF v_org_id IS NOT NULL THEN
      SELECT b.* INTO v_existing_booking
      FROM public.bookings b
      JOIN public.branches br ON br.id = b.branch_id
      WHERE b.client_request_id = p_idempotency_key AND br.org_id = v_org_id
      LIMIT 1;

      IF FOUND THEN
        RETURN jsonb_build_object(
          'success', true,
          'booking', jsonb_build_object(
            'id', v_existing_booking.id,
            'booking_number', v_existing_booking.booking_number,
            'status', v_existing_booking.status,
            'date', v_existing_booking.date,
            'start_time', v_existing_booking.start_time,
            'end_time', v_existing_booking.end_time,
            'service_name_snapshot', v_existing_booking.service_name_snapshot,
            'room_name_snapshot', v_existing_booking.room_name_snapshot,
            'therapist_name_snapshot', v_existing_booking.therapist_name_snapshot,
            'final_amount', v_existing_booking.final_amount
          )
        );
      END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM public.bookings b WHERE b.client_request_id = p_idempotency_key) THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'IDEMPOTENCY_KEY_CONFLICT',
        'message', 'This request id has already been used. Please start the booking again.');
    END IF;
    v_org_id := NULL;
  END IF;

  ----------------------------------------------------------------
  -- 0b. Phone required — same gate as createBooking's top-level check (the
  --     knownCustomerId exemption there is a staff-only waitlist-conversion path with no
  --     equivalent here). Normalized once, up front, so it's always available for the
  --     insert below even if the dedup block further down hits its own exception.
  ----------------------------------------------------------------
  IF p_customer_phone IS NULL OR btrim(p_customer_phone) = '' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'NO_CONTACT_INFO',
      'message', 'Phone number is required');
  END IF;
  v_phone := public.normalize_phone_e164(p_customer_phone);

  -- bookings.gender_preference only allows male / female / no-preference (or NULL): accept the usual spellings
  -- ('No_Preference', 'any') and refuse anything else with a plain code instead of a database error.
  v_gender_pref := lower(replace(btrim(p_gender_preference), '_', '-'));
  IF v_gender_pref IN ('', 'any') THEN v_gender_pref := NULL; END IF;
  IF v_gender_pref IS NOT NULL AND v_gender_pref NOT IN ('male', 'female', 'no-preference') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_GENDER_PREFERENCE',
      'message', 'Gender preference must be male, female or no-preference.');
  END IF;

  ----------------------------------------------------------------
  -- 1. Org resolution + opt-in gate, then branch/service org-boundary checks.
  --    These two checks (INVALID_BRANCH / INVALID_SERVICE) are NOT part of
  --    createBooking's taxonomy -- see migration-335's header.
  ----------------------------------------------------------------
  SELECT id INTO v_org_id
  FROM public.organizations
  WHERE slug = p_org_slug AND is_active = true AND marketplace_booking_enabled = true;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ORG_NOT_ENABLED',
      'message', 'This business is not accepting marketplace bookings.');
  END IF;

  SELECT * INTO v_branch FROM public.branches WHERE id = p_branch_id AND org_id = v_org_id;
  IF FOUND AND v_branch.is_active IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'LOCATION_INACTIVE',
      'message', 'This location is not taking new appointments.');
  END IF;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_BRANCH',
      'message', 'Selected branch is not available for this business.');
  END IF;

  SELECT wp.id, wp.name, wp.duration_minutes, wp.price_type, wp.category, wp.org_id,
         wp.effective_price_npr, wp.is_couple, wp.is_active, wp.bookable_online
  INTO v_service
  FROM public.services_with_offer_pricing wp
  WHERE wp.id = p_service_id;

  IF NOT FOUND OR v_service.org_id IS DISTINCT FROM v_org_id
     OR v_service.is_active IS NOT TRUE OR v_service.bookable_online IS FALSE THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_SERVICE',
      'message', 'Selected service is not available for this business.');
  END IF;

  -- The service must be offered at the chosen location: same rule as the customer flow (fetchServices) and
  -- marketplace_readiness_blockers (migration 413). branch_service_links: no rows = every branch, rows = only
  -- those branches; and not in the branch's excluded_service_categories (uncategorised counts as offered).
  -- Runs before any customer or booking row is written.
  IF EXISTS (SELECT 1 FROM public.branch_service_links l WHERE l.service_id = p_service_id)
     AND NOT EXISTS (SELECT 1 FROM public.branch_service_links l
                     WHERE l.service_id = p_service_id AND l.branch_id = p_branch_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'SERVICE_NOT_AT_LOCATION',
      'message', 'That service isn''t offered at this location. Please choose another location or service.');
  END IF;
  IF v_service.category IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.branches b
       WHERE b.id = p_branch_id AND v_service.category = ANY (COALESCE(b.excluded_service_categories, '{}'))) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'SERVICE_NOT_AT_LOCATION',
      'message', 'That service isn''t offered at this location. Please choose another location or service.');
  END IF;

  v_end_time := p_start_time + (v_service.duration_minutes * interval '1 minute');

  SELECT i.enable_rooms INTO v_enable_rooms
  FROM public.organizations o
  LEFT JOIN public.industries i ON i.id = o.industry_type
  WHERE o.id = v_org_id;
  v_enable_rooms := COALESCE(v_enable_rooms, true);

  ----------------------------------------------------------------
  -- 1b. Server safety checks (ZNLY-332). The edge function calls this as service_role, so the
  --     online-only triggers (migration-390 closed date, 138 capacity) do not fire: every rule the
  --     customer page enforces in the browser has to be enforced here. All run BEFORE any customer
  --     row is written, so a refused booking leaves no trace. The idempotent replay above already
  --     returned, so a retry of an accepted booking still gets the same booking back.
  ----------------------------------------------------------------
  IF p_date IS NULL OR p_start_time IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_TIME',
      'message', 'Choose a date and a start time.');
  END IF;

  -- Not in the past (Nepal time). Same instant maths as the therapist checks below.
  v_start_at := (p_date + p_start_time) AT TIME ZONE 'Asia/Kathmandu';
  IF v_start_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'IN_THE_PAST',
      'message', 'That time has already passed. Please choose a later time.');
  END IF;

  -- Closed date: a whole-location full-day block that prevents online booking (migration-390, ZNLY-224).
  IF EXISTS (SELECT 1 FROM public._closed_online_dates(p_branch_id, p_date, p_date)) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'CLOSED_DATE',
      'message', 'This location is closed on that date. Please choose another day.');
  END IF;

  -- Opening hours: the weekday row in branch_working_hours (0 = Monday .. 6 = Sunday) wins; a weekday
  -- with no row falls back to branches.open_time/close_time. Same rule as slotRangeForDate in the app.
  v_dow := (extract(isodow FROM p_date)::int - 1)::smallint;
  SELECT * INTO v_wh FROM public.branch_working_hours
  WHERE branch_id = p_branch_id AND day_of_week = v_dow;
  IF FOUND THEN
    IF v_wh.is_day_off OR v_wh.start_time IS NULL OR v_wh.end_time IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'BRANCH_CLOSED',
        'message', 'This location is closed on that day of the week. Please choose another day.');
    END IF;
    v_open := v_wh.start_time;
    v_close := v_wh.end_time;
  ELSE
    v_open := v_branch.open_time;
    v_close := v_branch.close_time;
  END IF;

  IF v_open IS NULL OR v_close IS NULL THEN
    -- No hours configured anywhere: refuse rather than accept any time (the slot grid's legacy 10-18 is not copied here).
    RETURN jsonb_build_object('success', false, 'error_code', 'BRANCH_CLOSED',
      'message', 'This location has no opening hours set, so it cannot take bookings.');
  END IF;
  IF TRUE THEN
    IF p_start_time < v_open THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'OUTSIDE_OPENING_HOURS',
        'message', format('This location opens at %s. Please choose a later time.', to_char(v_open, 'HH12:MI AM')));
    END IF;
    IF p_start_time >= v_close OR v_end_time > v_close THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'OUTSIDE_OPENING_HOURS',
        'message', format('This service would run past closing time (%s). Please choose an earlier time.', to_char(v_close, 'HH12:MI AM')));
    END IF;
  END IF;

  ----------------------------------------------------------------
  -- 2. Room handling — explicit room or auto-assign, same capacity accounting as
  --    check_room_capacity() (migration-171): bookings.room_id matches UNION
  --    booking_therapists.room_id override matches, both filtered to overlapping
  --    time ranges and non-terminal status.
  ----------------------------------------------------------------
  v_available_room_id := NULL;
  v_available_room_name := NULL;

  IF v_enable_rooms AND p_room_id IS NOT NULL THEN
    SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id AND branch_id = p_branch_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_ROOM',
        'message', 'Selected room is not available in this branch.');
    END IF;
    IF NOT v_room.is_active THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'ROOM_INACTIVE',
        'message', 'Selected room is not active.');
    END IF;

    SELECT
      (SELECT count(*) FROM public.bookings b
        WHERE b.room_id = p_room_id AND b.branch_id = p_branch_id AND b.date = p_date
          AND b.status NOT IN ('Cancelled', 'No Show')
          AND b.start_time < v_end_time AND b.end_time > p_start_time)
      +
      (SELECT count(*) FROM public.booking_therapists bt
        JOIN public.bookings b2 ON b2.id = bt.booking_id
        WHERE bt.room_id = p_room_id AND b2.branch_id = p_branch_id AND b2.date = p_date
          AND b2.status NOT IN ('Cancelled', 'No Show')
          AND COALESCE(bt.start_time, b2.start_time) < v_end_time
          AND COALESCE(bt.end_time, b2.end_time) > p_start_time)
    INTO v_room_count;

    IF v_room_count >= COALESCE(v_room.capacity, 1) THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'ROOM_FULL',
        'message', format('%s is fully booked at this time (capacity: %s).', v_room.name, COALESCE(v_room.capacity, 1)));
    END IF;

    v_available_room_id := v_room.id;
    v_available_room_name := v_room.name;
  ELSIF v_enable_rooms THEN
    -- Auto-assign: first active room in the branch with remaining capacity.
    FOR rec IN
      SELECT id, name, capacity FROM public.rooms
      WHERE branch_id = p_branch_id AND is_active = true
      ORDER BY name
    LOOP
      SELECT
        (SELECT count(*) FROM public.bookings b
          WHERE b.room_id = rec.id AND b.branch_id = p_branch_id AND b.date = p_date
            AND b.status NOT IN ('Cancelled', 'No Show')
            AND b.start_time < v_end_time AND b.end_time > p_start_time)
        +
        (SELECT count(*) FROM public.booking_therapists bt
          JOIN public.bookings b2 ON b2.id = bt.booking_id
          WHERE bt.room_id = rec.id AND b2.branch_id = p_branch_id AND b2.date = p_date
            AND b2.status NOT IN ('Cancelled', 'No Show')
            AND COALESCE(bt.start_time, b2.start_time) < v_end_time
            AND COALESCE(bt.end_time, b2.end_time) > p_start_time)
      INTO v_room_count;

      IF v_room_count < COALESCE(rec.capacity, 1) THEN
        v_available_room_id := rec.id;
        v_available_room_name := rec.name;
        EXIT;
      END IF;
    END LOOP;

    IF v_available_room_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'ROOMS_FULL',
        'message', 'Selected time slot is fully booked.');
    END IF;
  END IF;

  ----------------------------------------------------------------
  -- 4. Therapist resolution — count/inactive/transfer-branch/absence/checkout/eligibility,
  --    in the same order createBooking checks them.
  ----------------------------------------------------------------
  v_all_therapist_ids := COALESCE(p_therapist_ids, ARRAY[]::uuid[]);
  v_primary_therapist_id := NULL;
  v_therapist_name_snapshot := NULL;

  IF array_length(v_all_therapist_ids, 1) > 0 THEN
    v_primary_therapist_id := v_all_therapist_ids[1];
    v_at_dt := v_start_at;

    SELECT count(*) INTO v_therapist_count
    FROM public.therapists WHERE id = ANY(v_all_therapist_ids);
    IF v_therapist_count IS DISTINCT FROM array_length(v_all_therapist_ids, 1) THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_THERAPIST',
        'message', 'One or more selected therapists are not available in this branch.');
    END IF;

    FOR rec IN SELECT id, name, is_active, branch_id FROM public.therapists WHERE id = ANY(v_all_therapist_ids)
    LOOP
      IF NOT rec.is_active THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'THERAPIST_INACTIVE',
          'message', format('Therapist %s is not active.', rec.name));
      END IF;

      -- Home branch, or lent here by an open staff_transfers window at the start time (ZNLY-113).
      IF rec.branch_id IS DISTINCT FROM p_branch_id
         AND public._therapist_open_window_branch(rec.id, v_at_dt) IS DISTINCT FROM p_branch_id THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_THERAPIST',
          'message', format('%s is not available in this location at this time.', rec.name));
      END IF;

      IF rec.id = v_primary_therapist_id THEN
        v_therapist_name_snapshot := rec.name;
      END IF;
    END LOOP;

    -- Availability, leave, shift, overlap, eligibility, attendance: the one rule set the desk uses,
    -- check_therapist_booking_guards (migration-353/361, ZNLY-113). Run here so a refusal happens BEFORE any
    -- customer row is written; the bookings trigger runs it again at insert. An anonymous caller never has a
    -- manager override, so every refusal is final. The guard raises 'CODE: plain message'; that code is returned as is
    -- (THERAPIST_NOT_ELIGIBLE, THERAPIST_ABSENT, THERAPIST_CHECKED_OUT, ON_LEAVE, OVERLAP, BLOCKED, ON_BREAK, ...).
    FOREACH v_tid IN ARRAY v_all_therapist_ids LOOP
      BEGIN
        PERFORM public.check_therapist_booking_guards(
          v_tid, p_service_id, p_date, v_start_at, p_branch_id,
          v_start_at + (v_service.duration_minutes * interval '1 minute'), NULL, NULL, false);
      EXCEPTION WHEN SQLSTATE 'P0006' OR SQLSTATE 'PT409' OR SQLSTATE 'PT403' THEN
        RETURN jsonb_build_object('success', false,
          'error_code', split_part(SQLERRM, ':', 1),
          'message', btrim(substr(SQLERRM, position(':' IN SQLERRM) + 1)));
      END;
    END LOOP;
  END IF;

  ----------------------------------------------------------------
  -- 4b. Customer link (runs after every refusal check above, so a refused booking creates no customer) (ZNLY-274): create_customer_for_booking (migration-402) finds the org's customer by
  --    normalized phone, then email, or creates one. It NEVER updates an existing customer, so a stranger
  --    typing someone else's phone cannot repoint that person's name or email (the leak migration-340
  --    fixed). Non-blocking, like createBooking. bookings.is_walk_in keeps its default (false).
  ----------------------------------------------------------------
  v_customer_id := NULL;
  BEGIN
    v_email := lower(btrim(p_customer_email));
    IF v_email = '' THEN v_email := NULL; END IF;
    v_customer_id := public.create_customer_for_booking(
      v_org_id, p_branch_id, p_customer_name, v_phone, v_email, p_customer_gender);
  EXCEPTION WHEN OTHERS THEN
    v_customer_id := NULL; -- non-blocking: a booking without a profile link beats a lost booking
    RAISE WARNING 'public_create_booking: customer link failed: %', SQLERRM;
  END;

  ----------------------------------------------------------------
  -- 5. Price snapshot — tiered pricing follows whoever is actually requested, same as
  --    every other price type; "any available" still charges the Unassigned rate.
  ----------------------------------------------------------------
  v_resolved_base_amount := v_service.effective_price_npr;
  IF v_service.price_type = 'tiered' AND v_primary_therapist_id IS NOT NULL THEN
    SELECT public.service_price_for_therapist(p_service_id, v_primary_therapist_id) INTO v_tier_price;
    IF v_tier_price IS NOT NULL THEN
      v_resolved_base_amount := v_tier_price;
    END IF;
  END IF;

  ----------------------------------------------------------------
  -- 6. Insert — triggers compute end_time/datetimes/final_amount/booking_number, and are
  --    the real enforcement point for everything checked above plus more (EXCLUDE
  --    constraints, branch online capacity). Errors mapped to the exact same codes
  --    createBooking's orgSlug branch already returns to callers.
  ----------------------------------------------------------------
  BEGIN
    INSERT INTO public.bookings (
      branch_id, room_id, service_id, therapist_id, customer_id,
      customer_name, customer_email, customer_phone, customer_gender, gender_preference,
      date, start_time, base_amount, discount_amount, special_requests,
      created_by, client_request_id, booking_source,
      service_name_snapshot, service_duration_snapshot, service_price_snapshot,
      service_category_snapshot, room_name_snapshot, therapist_name_snapshot
    ) VALUES (
      p_branch_id, v_available_room_id, p_service_id, v_primary_therapist_id, v_customer_id,
      p_customer_name, p_customer_email, v_phone, p_customer_gender, v_gender_pref,
      p_date, p_start_time, v_resolved_base_amount, 0, p_special_requests,
      NULL, p_idempotency_key, 'marketplace',
      v_service.name, v_service.duration_minutes, v_resolved_base_amount,
      v_service.category, v_available_room_name, v_therapist_name_snapshot
    )
    RETURNING * INTO v_booking;
  EXCEPTION
    WHEN exclusion_violation THEN -- 23P01, excl_room_overlap / excl_therapist_overlap
      RETURN jsonb_build_object('success', false, 'error_code', 'THERAPIST_CONFLICT',
        'message', 'One or more selected therapists are already booked during this time slot.');
    WHEN SQLSTATE 'P0003' THEN -- check_room_capacity() / check_booking_therapist_room_capacity()
      RETURN jsonb_build_object('success', false, 'error_code', 'ROOMS_FULL',
        'message', 'Scheduling conflict. Please try a different time or room.');
    WHEN SQLSTATE 'P0005' THEN -- check_branch_online_capacity(), or the migration-390 closed-date trigger
      IF SQLERRM LIKE 'BRANCH_CLOSED_ONLINE:%' THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'CLOSED_DATE',
          'message', 'This location is closed on that date. Please choose another day.');
      END IF;
      RETURN jsonb_build_object('success', false, 'error_code', 'BRANCH_ONLINE_CAPACITY',
        'message', 'This time is fully booked — no therapists available. Please choose another time.');
    WHEN SQLSTATE 'P0007' THEN -- check_branch_advance_booking_window() (migration-303)
      RETURN jsonb_build_object('success', false, 'error_code', 'BRANCH_ADVANCE_BOOKING_WINDOW',
        'message', 'Bookings are not open that far in advance for this location. Please choose an earlier date.');
    WHEN SQLSTATE 'PT409' OR SQLSTATE 'PT403' THEN -- availability guard raised at insert (same 'CODE: message' form)
      RETURN jsonb_build_object('success', false,
        'error_code', split_part(SQLERRM, ':', 1),
        'message', btrim(substr(SQLERRM, position(':' IN SQLERRM) + 1)));
    WHEN SQLSTATE 'P0006' THEN -- check_therapist_booking_guards(), CODE: prefix in message
      IF SQLERRM LIKE 'THERAPIST_NOT_ELIGIBLE:%' THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'THERAPIST_NOT_ELIGIBLE',
          'message', split_part(SQLERRM, 'THERAPIST_NOT_ELIGIBLE:', 2));
      ELSIF SQLERRM LIKE 'THERAPIST_ABSENT:%' THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'THERAPIST_ABSENT',
          'message', split_part(SQLERRM, 'THERAPIST_ABSENT:', 2));
      ELSIF SQLERRM LIKE 'THERAPIST_CHECKED_OUT:%' THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'THERAPIST_CHECKED_OUT',
          'message', split_part(SQLERRM, 'THERAPIST_CHECKED_OUT:', 2));
      ELSE
        RAISE;
      END IF;
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'LOCATION_INACTIVE:%' THEN -- migration-385
        RETURN jsonb_build_object('success', false, 'error_code', 'LOCATION_INACTIVE',
          'message', 'This location is not taking new appointments.');
      END IF;
      IF SQLERRM LIKE '%BOOKING_CROSSES_MIDNIGHT%' THEN -- compute_booking_datetimes(), no ERRCODE set
        RETURN jsonb_build_object('success', false, 'error_code', 'BOOKING_CROSSES_MIDNIGHT',
          'message', COALESCE(split_part(SQLERRM, 'BOOKING_CROSSES_MIDNIGHT:', 2), 'This time would extend past midnight — please choose an earlier start time.'));
      END IF;
      RAISE;
  END;

  ----------------------------------------------------------------
  -- 7. booking_therapists junction — upsert, not insert: sync_booking_therapists_from_booking
  --    (migration-252) already inserted the primary therapist's row with room_id NULL off
  --    the AFTER INSERT trigger. Must stay non-blocking, same as createBooking.
  ----------------------------------------------------------------
  IF array_length(v_all_therapist_ids, 1) > 0 THEN
    BEGIN
      v_idx := 0;
      FOREACH v_tid IN ARRAY v_all_therapist_ids LOOP
        v_junction_room := NULL;
        IF v_idx > 0 AND p_therapist_room_overrides IS NOT NULL
           AND p_therapist_room_overrides ? v_tid::text THEN
          v_junction_room := (p_therapist_room_overrides ->> v_tid::text)::uuid;
        END IF;

        INSERT INTO public.booking_therapists (booking_id, therapist_id, start_time, end_time, room_id)
        VALUES (v_booking.id, v_tid, v_booking.start_time, v_booking.end_time, v_junction_room)
        ON CONFLICT (booking_id, therapist_id) DO UPDATE
          SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, room_id = EXCLUDED.room_id;

        v_idx := v_idx + 1;
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      NULL; -- non-blocking: the booking row itself already committed
    END;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'booking', jsonb_build_object(
      'id', v_booking.id,
      'booking_number', v_booking.booking_number,
      'status', v_booking.status,
      'date', v_booking.date,
      'start_time', v_booking.start_time,
      'end_time', v_booking.end_time,
      'service_name_snapshot', v_booking.service_name_snapshot,
      'room_name_snapshot', v_booking.room_name_snapshot,
      'therapist_name_snapshot', v_booking.therapist_name_snapshot,
      'final_amount', v_booking.final_amount
    )
  );
END;
$$;


REVOKE ALL ON FUNCTION public.public_create_booking(text, uuid, uuid, date, time, text, text, text, text, text, text, uuid[], uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_create_booking(text, uuid, uuid, date, time, text, text, text, text, text, text, uuid[], uuid, jsonb, uuid) TO service_role;

INSERT INTO public.schema_migrations (version, name)
VALUES ('409', 'marketplace-create-booking')
ON CONFLICT (version) DO NOTHING;

COMMIT;
