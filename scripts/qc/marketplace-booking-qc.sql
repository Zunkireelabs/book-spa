-- ZNLY-332 QC harness: marketplace booking (public_create_booking, migrations 409-411).
-- One transaction that ROLLS BACK: leaves no data. Safe on local and staging. Exits non-zero on any FAIL.
-- NEVER run on PROD: it briefly locks branches (ALTER TABLE inside the rolled-back transaction) and runs real triggers.
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -v org_slug=nuad-thai-spa -f scripts/qc/marketplace-booking-qc.sql   # rooms tenant
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -v org_slug=samis-qc      -f scripts/qc/marketplace-booking-qc.sql   # room-less tenant
-- Discovers its own branch / service / staff by org slug (no hard-coded ids). Dates are 45+ days ahead, so it never
-- touches real bookings; every change (hours, blocks, flags) is rolled back. A SKIP means the tenant has no data for
-- that case (e.g. no rooms, one staff member): it is shown, never hidden, and never counts as a pass.
\set ON_ERROR_STOP on
\if :{?org_slug}
\else
  \set org_slug nuad-thai-spa
\endif
\pset format aligned
\pset tuples_only off
BEGIN;
SELECT set_config('qc.org_slug', :'org_slug', true);
CREATE TEMP TABLE qc (n serial, result text, name text, expected text, got text);

CREATE FUNCTION pg_temp.rec(p_name text, p_expected text, p_got text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO qc (result, name, expected, got)
  VALUES (CASE WHEN p_got = ANY (string_to_array(p_expected, '|')) OR p_expected IS NOT DISTINCT FROM p_got THEN 'PASS' ELSE 'FAIL' END, p_name, p_expected, p_got);
$$;
CREATE FUNCTION pg_temp.skip(p_name text, p_why text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO qc (result, name, expected, got) VALUES ('SKIP', p_name, '-', p_why);
$$;
-- p_expected may list alternatives with '|' (the desk's availability guard names a refusal differently when a tenant has it on).
-- code of a refusal, or 'ok' for a booking
CREATE FUNCTION pg_temp.code(r jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN (r->>'success')::boolean THEN 'ok' ELSE r->>'error_code' END;
$$;

DO $qc$
DECLARE
  v_slug text := current_setting('qc.org_slug');
  v_org uuid; v_rooms boolean; v_branch uuid; v_svc uuid; v_dur int; v_tiered boolean;
  v_a uuid; v_b uuid; v_nstaff int;
  v_sig text := 'public.public_create_booking(text, uuid, uuid, date, time, text, text, text, text, text, text, uuid[], uuid, jsonb, uuid)';
  v_today date := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  v_mon date; v_tue date; v_wed date; v_thu date; v_fri date; v_sat date; v_sun date; v_mon2 date;
  v_open time := '09:00'; v_close time := '21:00';
  r jsonb; r2 jsonb; k uuid; bk record; n int; txt text; v_expected_price numeric; v_phone1 text := '+9779800332001';
  v_nrooms int; v_cust uuid; v_cname text; v_cemail text; v_nowt time;
BEGIN
  -- ---------------------------------------------------------------- discovery
  SELECT o.id, COALESCE(i.enable_rooms, true) INTO v_org, v_rooms
  FROM organizations o LEFT JOIN industries i ON i.id = o.industry_type WHERE o.slug = v_slug;
  IF v_org IS NULL THEN RAISE EXCEPTION 'QC: org % not found', v_slug; END IF;
  SELECT b.id INTO v_branch FROM branches b
  WHERE b.org_id = v_org AND b.is_active
  ORDER BY (SELECT count(*) FROM therapists t WHERE t.branch_id = b.id AND t.is_active) DESC, b.name LIMIT 1;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'QC: org % has no active branch', v_slug; END IF;
  SELECT s.id, s.duration_minutes, (s.price_type = 'tiered') INTO v_svc, v_dur, v_tiered
  FROM services_with_offer_pricing s
  WHERE s.org_id = v_org AND s.is_active AND COALESCE(s.bookable_online, true) AND NOT COALESCE(s.is_couple, false)
    AND NOT COALESCE(s.is_addon, false) AND s.duration_minutes BETWEEN 15 AND 120
  ORDER BY (s.price_type = 'tiered') DESC, s.duration_minutes LIMIT 1;
  IF v_svc IS NULL THEN RAISE EXCEPTION 'QC: org % has no bookable service', v_slug; END IF;
  SELECT count(*) INTO v_nstaff FROM therapists WHERE branch_id = v_branch AND is_active;
  SELECT id INTO v_a FROM therapists WHERE branch_id = v_branch AND is_active ORDER BY name, id LIMIT 1;
  SELECT id INTO v_b FROM therapists WHERE branch_id = v_branch AND is_active AND id <> v_a ORDER BY name, id LIMIT 1;
  SELECT count(*) INTO v_nrooms FROM rooms WHERE branch_id = v_branch AND is_active;
  RAISE NOTICE 'QC tenant=% rooms_tenant=% active_rooms=% staff=% service_minutes=% tiered=%', v_slug, v_rooms, v_nrooms, v_nstaff, v_dur, v_tiered;

  -- dates: Mon..Sun of the first week starting 45+ days out
  v_mon := v_today + 45 + ((7 - extract(isodow FROM v_today + 45)::int + 1) % 7);
  v_tue := v_mon + 1; v_wed := v_mon + 2; v_thu := v_mon + 3; v_fri := v_mon + 4; v_sat := v_mon + 5; v_sun := v_mon + 6; v_mon2 := v_mon + 7;

  -- ---------------------------------------------------------------- setup (all rolled back)
  UPDATE organizations SET marketplace_booking_enabled = true WHERE id = v_org;
  UPDATE branches SET open_time = v_open, close_time = v_close, advance_booking_days = 365,
         online_booking_capacity = NULL WHERE id = v_branch;
  DELETE FROM branch_working_hours WHERE branch_id = v_branch;
  INSERT INTO branch_working_hours (branch_id, day_of_week, is_day_off) VALUES (v_branch, 1, true);                     -- Tue off
  INSERT INTO branch_working_hours (branch_id, day_of_week, start_time, end_time) VALUES (v_branch, 2, '10:00', '20:00'); -- Wed 10-20
  INSERT INTO manual_blocks (org_id, branch_id, block_date, start_time, duration_minutes, prevent_online_booking)
  VALUES (v_org, v_branch, v_thu, '00:00', 1440, true);                                                                  -- Thu closed date
  IF v_a IS NOT NULL THEN
    DELETE FROM service_therapists WHERE service_id = v_svc;
    INSERT INTO service_therapists (service_id, therapist_id) VALUES (v_svc, v_a);
    IF v_b IS NOT NULL THEN INSERT INTO service_therapists (service_id, therapist_id) VALUES (v_svc, v_b); END IF;
    DELETE FROM therapist_attendance WHERE therapist_id IN (v_a, v_b) AND date BETWEEN v_mon AND v_mon2 + 7;
    INSERT INTO therapist_attendance (branch_id, therapist_id, date, status) VALUES (v_branch, v_a, v_fri, 'Absent');
  END IF;

  -- ---------------------------------------------------------------- permissions
  PERFORM pg_temp.rec('perm: anon cannot EXECUTE', 'false', has_function_privilege('anon', v_sig, 'EXECUTE')::text);
  PERFORM pg_temp.rec('perm: authenticated cannot EXECUTE', 'false', has_function_privilege('authenticated', v_sig, 'EXECUTE')::text);
  PERFORM pg_temp.rec('perm: service_role can EXECUTE', 'true', has_function_privilege('service_role', v_sig, 'EXECUTE')::text);
  PERFORM pg_temp.rec('perm: only one public_create_booking overload', '1', (SELECT count(*)::text FROM pg_proc WHERE proname = 'public_create_booking'));
  PERFORM pg_temp.rec('perm: marketplace_lookup_customer service_role only', 'false/true',
    has_function_privilege('anon', 'public.marketplace_lookup_customer(text,text,text)', 'EXECUTE') || '/' || has_function_privilege('service_role', 'public.marketplace_lookup_customer(text,text,text)', 'EXECUTE'));
  PERFORM pg_temp.rec('perm: marketplace_update_customer_email service_role only', 'false/true',
    has_function_privilege('anon', 'public.marketplace_update_customer_email(text,text,text)', 'EXECUTE') || '/' || has_function_privilege('service_role', 'public.marketplace_update_customer_email(text,text,text)', 'EXECUTE'));
  -- the real thing: anon / authenticated actually get refused
  txt := 'no error';
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.public_create_booking(v_slug, v_branch, v_svc, v_mon, '11:00', 'X', NULL, '+9779800332999', NULL, NULL, 'no-preference', NULL, NULL, NULL, gen_random_uuid());
  EXCEPTION WHEN insufficient_privilege THEN txt := 'insufficient_privilege';
  END;
  RESET ROLE;
  PERFORM pg_temp.rec('perm: anon call is refused', 'insufficient_privilege', txt);

  -- ---------------------------------------------------------------- happy path + row checks
  k := gen_random_uuid();
  r := public_create_booking(v_slug, v_branch, v_svc, v_mon, '11:00', 'QC Marketplace One', 'qc.one@example.test', v_phone1, 'Female', 'qc note', 'no-preference',
                             CASE WHEN v_a IS NOT NULL THEN ARRAY[v_a] END, NULL, NULL, k);
  PERFORM pg_temp.rec('happy: booking accepted', 'ok', pg_temp.code(r));
  PERFORM pg_temp.rec('happy: response has id and booking_number', 'true', ((r->'booking'->>'id') IS NOT NULL AND (r->'booking'->>'booking_number') IS NOT NULL)::text);
  SELECT * INTO bk FROM bookings WHERE client_request_id = k;
  SELECT effective_price_npr INTO v_expected_price FROM services_with_offer_pricing WHERE id = v_svc;
  IF v_tiered AND v_a IS NOT NULL THEN v_expected_price := COALESCE(service_price_for_therapist(v_svc, v_a), v_expected_price); END IF;
  PERFORM pg_temp.rec('happy: row branch', v_branch::text, bk.branch_id::text);
  PERFORM pg_temp.rec('happy: row service', v_svc::text, bk.service_id::text);
  PERFORM pg_temp.rec('happy: row staff', COALESCE(v_a::text, ''), COALESCE(bk.therapist_id::text, ''));
  PERFORM pg_temp.rec('happy: row date + start', v_mon::text || ' 11:00:00', bk.date::text || ' ' || bk.start_time::text);
  PERFORM pg_temp.rec('happy: row end = start + service minutes', ('11:00'::time + v_dur * interval '1 minute')::text, bk.end_time::text);
  -- the amount charged is base/final (tier price for the chosen staff on a tiered service); trg_booking_snapshots always
  -- stamps service_price_snapshot with the service's list price on every path, so that is what is compared for the snapshot.
  PERFORM pg_temp.rec('happy: base amount = tier/effective price', v_expected_price::text, bk.base_amount::text);
  PERFORM pg_temp.rec('happy: final amount = base (no discount)', v_expected_price::text, bk.final_amount::text);
  PERFORM pg_temp.rec('happy: price snapshot = service list price (same as every path)', (SELECT price_npr::text FROM services_with_offer_pricing WHERE id = v_svc), bk.service_price_snapshot::text);
  PERFORM pg_temp.rec('happy: status Pending', 'Pending', bk.status::text);
  PERFORM pg_temp.rec('happy: is_walk_in false', 'false', bk.is_walk_in::text);
  PERFORM pg_temp.rec('happy: online booking (created_by NULL)', 'true', (bk.created_by IS NULL)::text);
  PERFORM pg_temp.rec('happy: customer linked', 'true', (bk.customer_id IS NOT NULL)::text);
  PERFORM pg_temp.rec('happy: customer is in this org with the typed phone', '1',
    (SELECT count(*)::text FROM customers c WHERE c.id = bk.customer_id AND c.org_id = v_org AND c.full_name = 'QC Marketplace One' AND c.phone LIKE '%9800332001'));
  IF v_rooms AND v_nrooms > 0 THEN
    PERFORM pg_temp.rec('happy: room assigned (rooms tenant)', 'true', (bk.room_id IS NOT NULL)::text);
  ELSE
    PERFORM pg_temp.rec('happy: no room (room-less tenant)', 'true', (bk.room_id IS NULL)::text);
  END IF;
  PERFORM pg_temp.rec('happy: booking_source = marketplace', 'marketplace', bk.booking_source);
  -- Booking Inbox: shown as an unacknowledged online booking, with a new_online_booking notification when the team has recipients
  PERFORM pg_temp.rec('inbox: unacknowledged online booking', 'true', (bk.acknowledged_at IS NULL AND bk.created_by IS NULL)::text);
  SELECT count(*) INTO n FROM users u WHERE u.org_id = v_org AND u.is_active IS NOT FALSE AND u.role IN ('admin', 'manager', 'staff');
  IF n = 0 THEN PERFORM pg_temp.skip('inbox: new_online_booking notification', 'org has no staff users to notify');
  ELSE PERFORM pg_temp.rec('inbox: new_online_booking notification created', 'true',
         (EXISTS (SELECT 1 FROM notifications WHERE booking_id = bk.id AND type = 'new_online_booking'))::text);
  END IF;

  -- ---------------------------------------------------------------- idempotency
  r2 := public_create_booking(v_slug, v_branch, v_svc, v_mon, '11:00', 'QC Marketplace One', 'qc.one@example.test', v_phone1, 'Female', 'qc note', 'no-preference',
                              CASE WHEN v_a IS NOT NULL THEN ARRAY[v_a] END, NULL, NULL, k);
  PERFORM pg_temp.rec('idempotent: retry returns ok', 'ok', pg_temp.code(r2));
  PERFORM pg_temp.rec('idempotent: same booking id back', r->'booking'->>'id', r2->'booking'->>'id');
  PERFORM pg_temp.rec('idempotent: still 1 row', '1', (SELECT count(*)::text FROM bookings WHERE client_request_id = k));

  -- replay is scoped to the org: the same key under another org's slug returns none of this booking's data
  SELECT o.slug INTO txt FROM organizations o WHERE o.id <> v_org AND o.is_active ORDER BY o.slug LIMIT 1;
  IF txt IS NULL THEN PERFORM pg_temp.skip('cross-org replay', 'only one org in this database');
  ELSE
    UPDATE organizations SET marketplace_booking_enabled = true WHERE slug = txt;
    r2 := public_create_booking(txt, v_branch, v_svc, v_mon, '11:00', 'QC Spy', 'qc.spy@example.test', '+9779800332555', NULL, NULL, 'no-preference', NULL, NULL, NULL, k);
    PERFORM pg_temp.rec('cross-org replay: refused, no booking data returned', 'IDEMPOTENCY_KEY_CONFLICT|INVALID_BRANCH', pg_temp.code(r2));
    PERFORM pg_temp.rec('cross-org replay: response carries no booking', 'false', (r2 ? 'booking')::text);
  END IF;
  -- replay still works after the org is switched off
  UPDATE organizations SET marketplace_booking_enabled = false WHERE id = v_org;
  r2 := public_create_booking(v_slug, v_branch, v_svc, v_mon, '11:00', 'QC Marketplace One', 'qc.one@example.test', v_phone1, 'Female', 'qc note', 'no-preference',
                              CASE WHEN v_a IS NOT NULL THEN ARRAY[v_a] END, NULL, NULL, k);
  PERFORM pg_temp.rec('replay works after the org was switched off', r->'booking'->>'id', r2->'booking'->>'id');
  UPDATE organizations SET marketplace_booking_enabled = true WHERE id = v_org;

  -- ---------------------------------------------------------------- returning phone / new phone
  SELECT c.id, c.full_name, c.email INTO v_cust, v_cname, v_cemail FROM customers c WHERE c.id = bk.customer_id;
  r := public_create_booking(v_slug, v_branch, v_svc, v_mon, ('11:00'::time + (v_dur + 30) * interval '1 minute')::time, 'Somebody Else', 'someone.else@example.test', '977-9800-332-001', 'Male', NULL, 'no-preference',
                             CASE WHEN v_a IS NOT NULL THEN ARRAY[v_a] END, NULL, NULL, gen_random_uuid());
  PERFORM pg_temp.rec('returning phone: booking accepted', 'ok', pg_temp.code(r));
  PERFORM pg_temp.rec('returning phone: same customer reused', v_cust::text, (SELECT customer_id::text FROM bookings WHERE id = (r->'booking'->>'id')::uuid));
  PERFORM pg_temp.rec('returning phone: no duplicate customer', '1', (SELECT count(*)::text FROM customers WHERE org_id = v_org AND phone LIKE '%9800332001'));
  PERFORM pg_temp.rec('returning phone: name not overwritten', v_cname, (SELECT full_name FROM customers WHERE id = v_cust));
  PERFORM pg_temp.rec('returning phone: email not overwritten', v_cemail, (SELECT email FROM customers WHERE id = v_cust));
  r := public_create_booking(v_slug, v_branch, v_svc, v_mon, ('11:00'::time + 2 * (v_dur + 30) * interval '1 minute')::time, 'QC Marketplace Two', 'qc.two@example.test', '+9779800332002', NULL, NULL, 'no-preference',
                             CASE WHEN v_a IS NOT NULL THEN ARRAY[v_a] END, NULL, NULL, gen_random_uuid());
  PERFORM pg_temp.rec('new phone: booking accepted', 'ok', pg_temp.code(r));
  PERFORM pg_temp.rec('new phone: a new customer, linked', 'true',
    (SELECT (customer_id IS NOT NULL AND customer_id <> v_cust)::text FROM bookings WHERE id = (r->'booking'->>'id')::uuid));

  -- a desk-style booking (no booking_source given) stays NULL
  IF v_a IS NOT NULL THEN
    INSERT INTO bookings (branch_id, service_id, therapist_id, customer_name, customer_phone, date, start_time, base_amount, discount_amount,
                          created_by, service_name_snapshot, service_duration_snapshot, service_price_snapshot)
    VALUES (v_branch, v_svc, v_a, 'QC Desk', '+9779800332100', v_mon2, '14:00', v_expected_price, 0,
            (SELECT id FROM users WHERE org_id = v_org LIMIT 1), 'QC', v_dur, v_expected_price)
    RETURNING * INTO bk;
    PERFORM pg_temp.rec('desk booking: booking_source stays NULL', 'NULL', COALESCE(bk.booking_source, 'NULL'));
  END IF;
  PERFORM pg_temp.rec('no marketplace tag on anything but marketplace bookings', '0', (SELECT count(*)::text FROM bookings WHERE booking_source IS NOT NULL AND booking_source <> 'marketplace'));
  -- a branch with NO weekly row for the day and NULL open/close (staging's Sami's Lazimpat) must refuse, not accept any time.
  -- Locally the columns are NOT NULL (migration 079); dropped here for this case only, inside the rolled-back transaction.
  ALTER TABLE branches ALTER COLUMN open_time DROP NOT NULL, ALTER COLUMN close_time DROP NOT NULL;
  UPDATE branches SET open_time = NULL, close_time = NULL WHERE id = v_branch;
  r := public_create_booking(v_slug, v_branch, v_svc, v_mon, '11:00', 'QC X', NULL, '+9779800332003', NULL, NULL, 'no-preference', NULL, NULL, NULL, NULL);
  PERFORM pg_temp.rec('no weekly row and NULL open/close hours: refused', 'BRANCH_CLOSED', pg_temp.code(r));
  UPDATE branches SET open_time = v_open, close_time = v_close WHERE id = v_branch;

  -- ---------------------------------------------------------------- closed / hours / date / past
  r := public_create_booking(v_slug, v_branch, v_svc, v_tue, '11:00', 'QC X', NULL, '+9779800332003', NULL, NULL, 'no-preference', NULL, NULL, NULL, NULL);
  PERFORM pg_temp.rec('closed weekday (Tue day off)', 'BRANCH_CLOSED', pg_temp.code(r));
  r := public_create_booking(v_slug, v_branch, v_svc, v_mon, '08:00', 'QC X', NULL, '+9779800332003', NULL, NULL, 'no-preference', NULL, NULL, NULL, NULL);
  PERFORM pg_temp.rec('outside hours: start before open (fallback 09:00)', 'OUTSIDE_OPENING_HOURS', pg_temp.code(r));
  r := public_create_booking(v_slug, v_branch, v_svc, v_mon, (v_close - (v_dur - 15) * interval '1 minute')::time, 'QC X', NULL, '+9779800332003', NULL, NULL, 'no-preference', NULL, NULL, NULL, NULL);
  PERFORM pg_temp.rec('outside hours: end 15 min after close', 'OUTSIDE_OPENING_HOURS', pg_temp.code(r));
  r := public_create_booking(v_slug, v_branch, v_svc, v_wed, '09:30', 'QC X', NULL, '+9779800332003', NULL, NULL, 'no-preference', NULL, NULL, NULL, NULL);
  PERFORM pg_temp.rec('outside hours: per-day row (Wed 10:00) beats the branch default (09:00)', 'OUTSIDE_OPENING_HOURS', pg_temp.code(r));
  r := public_create_booking(v_slug, v_branch, v_svc, v_thu, '11:00', 'QC X', NULL, '+9779800332003', NULL, NULL, 'no-preference', NULL, NULL, NULL, NULL);
  PERFORM pg_temp.rec('closed date (manual block)', 'CLOSED_DATE', pg_temp.code(r));
  v_nowt := (now() AT TIME ZONE 'Asia/Kathmandu')::time;
  IF v_nowt > '00:05' THEN
    r := public_create_booking(v_slug, v_branch, v_svc, v_today, (v_nowt - interval '2 minutes')::time(0), 'QC X', NULL, '+9779800332003', NULL, NULL, 'no-preference', NULL, NULL, NULL, NULL);
    PERFORM pg_temp.rec('past time today (Nepal time)', 'IN_THE_PAST', pg_temp.code(r));
  ELSE PERFORM pg_temp.skip('past time today', 'run too close to Nepal midnight');
  END IF;
  r := public_create_booking(v_slug, v_branch, v_svc, v_today - 3, '11:00', 'QC X', NULL, '+9779800332003', NULL, NULL, 'no-preference', NULL, NULL, NULL, NULL);
  PERFORM pg_temp.rec('past date', 'IN_THE_PAST', pg_temp.code(r));
  PERFORM pg_temp.rec('refused bookings created no customer', '0', (SELECT count(*)::text FROM customers WHERE org_id = v_org AND phone LIKE '%9800332003'));

  -- ---------------------------------------------------------------- org / branch / service / staff gates
  UPDATE organizations SET marketplace_booking_enabled = false WHERE id = v_org;
  r := public_create_booking(v_slug, v_branch, v_svc, v_sat, '11:00', 'QC X', NULL, '+9779800332003', NULL, NULL, 'no-preference', NULL, NULL, NULL, NULL);
  PERFORM pg_temp.rec('org not enabled', 'ORG_NOT_ENABLED', pg_temp.code(r));
  UPDATE organizations SET marketplace_booking_enabled = true WHERE id = v_org;

  -- lookup gate: a customer must always see bookings they made (booking on, lookup off -> found)
  UPDATE organizations SET marketplace_lookup_enabled = false, marketplace_booking_enabled = true WHERE id = v_org;
  r := public_create_booking(v_slug, v_branch, v_svc, v_sat, '11:00', 'QC Lookup', 'qc-lookup-332@example.com', '+9779800332099', NULL, NULL, 'no-preference', NULL, NULL, NULL, NULL);
  PERFORM pg_temp.rec('lookup gate: booking made', 'ok', pg_temp.code(r));
  r2 := public.marketplace_lookup_customer(v_slug, 'email', 'qc-lookup-332@example.com');
  PERFORM pg_temp.rec('lookup gate: booking on + lookup off -> found', 'true', r2->>'found');
  PERFORM pg_temp.rec('lookup gate: the booking is listed', '1', jsonb_array_length(r2->'bookings')::text);
  UPDATE organizations SET marketplace_lookup_enabled = false, marketplace_booking_enabled = false WHERE id = v_org;
  PERFORM pg_temp.rec('lookup gate: the booking carries source marketplace', 'marketplace', (SELECT booking_source FROM bookings WHERE branch_id = v_branch AND customer_id = (SELECT id FROM customers WHERE org_id = v_org AND lower(email) = 'qc-lookup-332@example.com' LIMIT 1) LIMIT 1));
  -- both off, but the customer booked through the marketplace: still sees it
  r2 := public.marketplace_lookup_customer(v_slug, 'email', 'qc-lookup-332@example.com');
  PERFORM pg_temp.rec('lookup gate: studio off, customer has a marketplace booking -> still found', 'true', r2->>'found');
  BEGIN
    PERFORM public.marketplace_lookup_customer(v_slug, 'email', 'nobody-qc-332@example.com');
    txt := 'no error';
  EXCEPTION WHEN OTHERS THEN txt := SQLSTATE;
  END;
  PERFORM pg_temp.rec('lookup gate: studio off, unknown customer -> refused (nothing leaks)', 'BSNF1', txt);
  UPDATE bookings SET booking_source = NULL WHERE branch_id IN (SELECT id FROM branches WHERE org_id = v_org) AND booking_source = 'marketplace' AND customer_id = (SELECT id FROM customers WHERE org_id = v_org AND lower(email) = 'qc-lookup-332@example.com' LIMIT 1);
  BEGIN
    PERFORM public.marketplace_lookup_customer(v_slug, 'email', 'qc-lookup-332@example.com');
    txt := 'no error';
  EXCEPTION WHEN OTHERS THEN txt := SQLSTATE;
  END;
  PERFORM pg_temp.rec('lookup gate: studio off, customer without marketplace source -> refused', 'BSNF1', txt);
  UPDATE organizations SET marketplace_lookup_enabled = true WHERE id = v_org;
  r2 := public.marketplace_lookup_customer(v_slug, 'email', 'qc-lookup-332@example.com');
  PERFORM pg_temp.rec('lookup gate: lookup-only studio (booking off) -> found', 'true', r2->>'found');
  UPDATE organizations SET marketplace_lookup_enabled = false, marketplace_booking_enabled = true WHERE id = v_org;

  UPDATE services SET is_active = false WHERE id = v_svc;
  r := public_create_booking(v_slug, v_branch, v_svc, v_sat, '11:00', 'QC X', NULL, '+9779800332003', NULL, NULL, 'no-preference', NULL, NULL, NULL, NULL);
  PERFORM pg_temp.rec('inactive service', 'INVALID_SERVICE', pg_temp.code(r));
  UPDATE services SET is_active = true WHERE id = v_svc;

  UPDATE branches SET is_active = false WHERE id = v_branch;
  r := public_create_booking(v_slug, v_branch, v_svc, v_sat, '11:00', 'QC X', NULL, '+9779800332003', NULL, NULL, 'no-preference', NULL, NULL, NULL, NULL);
  PERFORM pg_temp.rec('inactive branch', 'LOCATION_INACTIVE', pg_temp.code(r));
  UPDATE branches SET is_active = true WHERE id = v_branch;

  r := public_create_booking(v_slug, v_branch, gen_random_uuid(), v_sat, '11:00', 'QC X', NULL, '+9779800332003', NULL, NULL, 'no-preference', NULL, NULL, NULL, NULL);
  PERFORM pg_temp.rec('unknown service', 'INVALID_SERVICE', pg_temp.code(r));
  r := public_create_booking(v_slug, v_branch, v_svc, v_sat, '11:00', 'QC X', NULL, '', NULL, NULL, 'no-preference', NULL, NULL, NULL, NULL);
  PERFORM pg_temp.rec('phone required', 'NO_CONTACT_INFO', pg_temp.code(r));

  IF v_a IS NULL THEN
    PERFORM pg_temp.skip('staff cases (absent / inactive / taken / not eligible)', 'branch has no active staff');
  ELSE
    r := public_create_booking(v_slug, v_branch, v_svc, v_fri, '11:00', 'QC X', NULL, '+9779800332003', NULL, NULL, 'no-preference', ARRAY[v_a], NULL, NULL, NULL);
    PERFORM pg_temp.rec('staff absent that day', 'THERAPIST_ABSENT|ON_LEAVE', pg_temp.code(r));

    UPDATE therapists SET is_active = false WHERE id = v_a;
    r := public_create_booking(v_slug, v_branch, v_svc, v_sat, '11:00', 'QC X', NULL, '+9779800332003', NULL, NULL, 'no-preference', ARRAY[v_a], NULL, NULL, NULL);
    PERFORM pg_temp.rec('inactive staff', 'THERAPIST_INACTIVE', pg_temp.code(r));
    UPDATE therapists SET is_active = true WHERE id = v_a;

    -- taken slot: same staff, overlapping time (Sat), with the rooms still free
    r := public_create_booking(v_slug, v_branch, v_svc, v_sat, '11:00', 'QC Taken A', NULL, '+9779800332004', NULL, NULL, 'no-preference', ARRAY[v_a], NULL, NULL, gen_random_uuid());
    PERFORM pg_temp.rec('taken slot: first booking ok', 'ok', pg_temp.code(r));
    r := public_create_booking(v_slug, v_branch, v_svc, v_sat, '11:15', 'QC Taken B', NULL, '+9779800332005', NULL, NULL, 'no-preference', ARRAY[v_a], NULL, NULL, gen_random_uuid());
    PERFORM pg_temp.rec('taken slot: same staff overlapping', 'THERAPIST_CONFLICT|OVERLAP', pg_temp.code(r));

    IF v_rooms AND v_nrooms > 0 AND v_b IS NOT NULL THEN
      -- room full: leave one room of capacity 1, book it with staff A, then ask for a different staff at the same time
      UPDATE rooms SET is_active = false WHERE branch_id = v_branch AND id <> (SELECT id FROM rooms WHERE branch_id = v_branch AND is_active ORDER BY name LIMIT 1);
      UPDATE rooms SET capacity = 1 WHERE branch_id = v_branch AND is_active;
      r := public_create_booking(v_slug, v_branch, v_svc, v_sun, '11:00', 'QC Room A', NULL, '+9779800332006', NULL, NULL, 'no-preference', ARRAY[v_a], NULL, NULL, gen_random_uuid());
      PERFORM pg_temp.rec('room full: first booking ok', 'ok', pg_temp.code(r));
      r := public_create_booking(v_slug, v_branch, v_svc, v_sun, '11:15', 'QC Room B', NULL, '+9779800332007', NULL, NULL, 'no-preference', ARRAY[v_b], NULL, NULL, gen_random_uuid());
      PERFORM pg_temp.rec('room full: only room taken', 'ROOMS_FULL', pg_temp.code(r));
    ELSE
      PERFORM pg_temp.skip('room full', CASE WHEN NOT v_rooms THEN 'room-less tenant' WHEN v_b IS NULL THEN 'needs 2 staff' ELSE 'no rooms' END);
    END IF;

    IF v_b IS NOT NULL THEN
      DELETE FROM service_therapists WHERE service_id = v_svc AND therapist_id = v_b;
      r := public_create_booking(v_slug, v_branch, v_svc, v_mon2, '11:00', 'QC X', NULL, '+9779800332008', NULL, NULL, 'no-preference', ARRAY[v_b], NULL, NULL, NULL);
      PERFORM pg_temp.rec('staff not eligible for the service', 'THERAPIST_NOT_ELIGIBLE', pg_temp.code(r));
    ELSE PERFORM pg_temp.skip('staff not eligible', 'needs 2 staff');
    END IF;
  END IF;
END
$qc$;

SELECT n, result, name, expected, got FROM qc ORDER BY n;
SELECT count(*) FILTER (WHERE result = 'PASS') AS pass, count(*) FILTER (WHERE result = 'FAIL') AS fail,
       count(*) FILTER (WHERE result = 'SKIP') AS skip, count(*) AS total,
       (count(*) FILTER (WHERE result = 'FAIL')) > 0 AS failed FROM qc \gset
ROLLBACK;
\echo QC TOTAL :pass PASS, :fail FAIL, :skip SKIP of :total  (org :org_slug, rolled back)
\if :failed
  \echo QC FAILED
  \set ON_ERROR_STOP on
  SELECT 1/0;
\endif
