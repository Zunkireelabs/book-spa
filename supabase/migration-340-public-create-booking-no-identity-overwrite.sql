-- Migration 340: stop the marketplace booking path from overwriting a customer's name/email
-- (additive, CREATE OR REPLACE)
--
-- The gap, found verifying Step 1 of the marketplace booking integration (two test bookings
-- made under two different marketplace accounts, same phone number, on purpose): 335's dedup
-- UPDATE unconditionally overwrites customers.full_name and customers.email with whatever the
-- CURRENT booking says, keyed only on phone. Typing a stranger's phone number at booking time —
-- a typo, or deliberately — repoints that stranger's customer row's email to the typist's
-- address. marketplace_lookup_customer (336) matches by email, so the next lookup under the
-- typist's own account then returns the ORIGINAL customer's booking history, spend and
-- membership; the original customer's own lookup comes back empty. Proven live: account B's
-- booking left customer 5cf30f4a-1403-4978-a666-82b1b2210666's email as account B's address,
-- and marketplace_lookup_customer('sbal', 'email', <account A's email>) returned found:false.
--
-- The fix extends a rule 335 already applies to gender ("a booking-time pick shouldn't clobber
-- a previously confirmed value") to full_name and email too: fill only when the existing value
-- is empty (NULL or blank), never overwrite a value that's already there. phone is untouched —
-- it's the match key, not something this function ever had a reason to silently change.
--
-- Why this can't check v_existing.full_name / v_existing.email the way gender checks
-- v_existing.gender: find_customer_for_booking (migration-098) returns only (id, gender) —
-- full_name and email were never part of its contract, and it's shared with book-spa's own
-- booking flow, so its return shape isn't this migration's to change. The fix instead reads the
-- row's own current full_name/email inside the UPDATE's SET expressions, which Postgres
-- evaluates against the pre-update row — same effect as checking v_existing, without needing
-- find_customer_for_booking to return anything new.
--
-- Scope is deliberately narrow: public_create_booking (the marketplace's own entry point) only.
-- book-spa's own createBooking (src/services/api.js ~6031-6042) does the identical unconditional
-- overwrite and is NOT changed here — keeping a regular's record current when staff rebook them
-- in person is the intended behaviour there, with a human in the loop who'd notice a wrong name.
-- The marketplace caller is an anonymous stranger with no such check; same shape of write,
-- different trust level, so only the marketplace's own entry point is tightened.
--
-- Rollback is one-way in practice: re-applying 335 restores the overwrite and the leak it
-- enables. If 340 turns out wrong, fix forward with 341 — don't revert to 335.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.
-- Reversible (manual, NOT RECOMMENDED — see above):
--   Re-running migration-335's CREATE OR REPLACE FUNCTION block restores the vulnerable version.

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
BEGIN
  ----------------------------------------------------------------
  -- 0. Idempotent replay: an existing row with this key wins outright.
  ----------------------------------------------------------------
  IF p_idempotency_key IS NOT NULL THEN
    SELECT b.* INTO v_existing_booking
    FROM public.bookings b
    WHERE b.client_request_id = p_idempotency_key
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'booking', jsonb_build_object(
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
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_BRANCH',
      'message', 'Selected branch is not available for this business.');
  END IF;

  SELECT wp.id, wp.name, wp.duration_minutes, wp.price_type, wp.category, wp.org_id,
         wp.effective_price_npr, wp.is_couple
  INTO v_service
  FROM public.services_with_offer_pricing wp
  WHERE wp.id = p_service_id;

  IF NOT FOUND OR v_service.org_id IS DISTINCT FROM v_org_id THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_SERVICE',
      'message', 'Selected service is not available for this business.');
  END IF;

  v_end_time := p_start_time + (v_service.duration_minutes * interval '1 minute');

  SELECT i.enable_rooms INTO v_enable_rooms
  FROM public.organizations o
  LEFT JOIN public.industries i ON i.id = o.industry_type
  WHERE o.id = v_org_id;
  v_enable_rooms := COALESCE(v_enable_rooms, true);

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
  -- 3. Customer dedup — reuses find_customer_for_booking() verbatim (migration-098),
  --    the same function createBooking itself calls. Non-blocking: a failure here
  --    must not fail the booking, matching createBooking's try/catch.
  --
  --    full_name and email are filled only when the existing row's value is empty
  --    (NULL or blank) — migration-340. find_customer_for_booking returns only (id,
  --    gender), so there's no v_existing.full_name/v_existing.email to test against;
  --    the CASE expressions below read the row's own current value instead, which
  --    Postgres evaluates against the pre-update row, same effect. phone is still the
  --    match key and is never overwritten by a booking-time value other than the
  --    normalized form of what was just typed. gender's fill-when-empty rule is
  --    unchanged from 335 — full_name/email now follow the same rule it already set.
  ----------------------------------------------------------------
  v_customer_id := NULL;
  BEGIN
    v_email := lower(btrim(p_customer_email));
    IF v_email = '' THEN v_email := NULL; END IF;

    SELECT * INTO v_existing FROM public.find_customer_for_booking(v_org_id, v_phone, v_email);

    IF FOUND THEN
      v_customer_id := v_existing.id;
      UPDATE public.customers
      SET full_name = CASE WHEN full_name IS NULL OR btrim(full_name) = ''
                            THEN p_customer_name ELSE full_name END,
          phone = COALESCE(v_phone, phone),
          email = CASE WHEN email IS NULL OR btrim(email) = ''
                       THEN v_email ELSE email END,
          gender = CASE WHEN v_existing.gender IS NULL AND p_customer_gender IS NOT NULL
                        THEN p_customer_gender ELSE gender END
      WHERE id = v_customer_id;
    ELSE
      BEGIN
        INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, gender)
        VALUES (v_org_id, p_branch_id, p_customer_name, v_phone, v_email, p_customer_gender)
        RETURNING id INTO v_customer_id;
      EXCEPTION WHEN unique_violation THEN
        -- Lost a race against customers_org_nphone_uniq (migration-036) — re-fetch the winner.
        SELECT id INTO v_customer_id FROM public.customers
        WHERE org_id = v_org_id AND phone = v_phone LIMIT 1;
      END;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_customer_id := NULL; -- non-blocking, same as createBooking's console.warn-and-continue
  END;

  ----------------------------------------------------------------
  -- 4. Therapist resolution — count/inactive/transfer-branch/absence/checkout/eligibility,
  --    in the same order createBooking checks them.
  ----------------------------------------------------------------
  v_all_therapist_ids := COALESCE(p_therapist_ids, ARRAY[]::uuid[]);
  v_primary_therapist_id := NULL;
  v_therapist_name_snapshot := NULL;

  IF array_length(v_all_therapist_ids, 1) > 0 THEN
    v_primary_therapist_id := v_all_therapist_ids[1];
    v_at_dt := (p_date + p_start_time) AT TIME ZONE 'Asia/Kathmandu';

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

      IF public.compute_therapist_branch_at(rec.id, rec.branch_id, v_at_dt) IS DISTINCT FROM p_branch_id THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_THERAPIST',
          'message', format('%s is not available in this branch at this time (transferred elsewhere for this date).', rec.name));
      END IF;

      IF rec.id = v_primary_therapist_id THEN
        v_therapist_name_snapshot := rec.name;
      END IF;
    END LOOP;

    -- Attendance: absence / leave-like statuses, then checkout time, each reported with
    -- the specific therapist's name, same as createBooking.
    FOR rec IN
      SELECT ta.therapist_id, ta.status, ta.check_out_time, t.name
      FROM public.therapist_attendance ta
      JOIN public.therapists t ON t.id = ta.therapist_id
      WHERE ta.therapist_id = ANY(v_all_therapist_ids) AND ta.date = p_date
    LOOP
      IF rec.status = 'Absent' OR rec.status IN ('Leave', 'Annual Leave', 'Sick Leave', 'Day Off') THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'THERAPIST_ABSENT',
          'message', format('%s is marked as %s on this date.', rec.name, rec.status));
      END IF;
      IF rec.check_out_time IS NOT NULL AND v_at_dt >= rec.check_out_time THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'THERAPIST_CHECKED_OUT',
          'message', format('%s already checked out for this date.', rec.name));
      END IF;
    END LOOP;

    -- Eligibility allow-list (migration-249/257): no rows for this service+branch means
    -- unrestricted; otherwise every selected therapist must be on the list.
    IF EXISTS (
      SELECT 1 FROM public.service_therapists st
      JOIN public.therapists t ON t.id = st.therapist_id
      WHERE st.service_id = p_service_id AND t.branch_id = p_branch_id
    ) THEN
      FOR rec IN
        SELECT t.id, t.name FROM public.therapists t WHERE t.id = ANY(v_all_therapist_ids)
      LOOP
        IF NOT EXISTS (
          SELECT 1 FROM public.service_therapists st WHERE st.service_id = p_service_id AND st.therapist_id = rec.id
        ) THEN
          RETURN jsonb_build_object('success', false, 'error_code', 'THERAPIST_NOT_ELIGIBLE',
            'message', format('%s is not eligible for %s.', rec.name, v_service.name));
        END IF;
      END LOOP;
    END IF;
  END IF;

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
      created_by, client_request_id,
      service_name_snapshot, service_duration_snapshot, service_price_snapshot,
      service_category_snapshot, room_name_snapshot, therapist_name_snapshot
    ) VALUES (
      p_branch_id, v_available_room_id, p_service_id, v_primary_therapist_id, v_customer_id,
      p_customer_name, p_customer_email, v_phone, p_customer_gender, p_gender_preference,
      p_date, p_start_time, v_resolved_base_amount, 0, p_special_requests,
      NULL, p_idempotency_key,
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
    WHEN SQLSTATE 'P0005' THEN -- check_branch_online_capacity()
      RETURN jsonb_build_object('success', false, 'error_code', 'BRANCH_ONLINE_CAPACITY',
        'message', 'This time is fully booked — no therapists available. Please choose another time.');
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

REVOKE ALL ON FUNCTION public.public_create_booking(text, uuid, uuid, date, time, text, text, text, text, text, text, uuid[], uuid, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_create_booking(text, uuid, uuid, date, time, text, text, text, text, text, text, uuid[], uuid, jsonb, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.public_create_booking(text, uuid, uuid, date, time, text, text, text, text, text, text, uuid[], uuid, jsonb, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.public_create_booking(text, uuid, uuid, date, time, text, text, text, text, text, text, uuid[], uuid, jsonb, uuid) TO service_role;

INSERT INTO public.schema_migrations (version, name)
VALUES ('340', 'public-create-booking-no-identity-overwrite')
ON CONFLICT (version) DO NOTHING;
