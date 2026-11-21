-- ZNLY-235: restricted staff data access (migration 393). Scratch database only (scripts/qc-4c.sh); the whole file ROLLS BACK.
-- Logins: 01 restricted (own, no details, no prices, linked to therapist A), 02 restricted but UNLINKED, 03 normal staff,
--         04 manager, 05 admin (06 is spare).
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO organizations (id, name, code, slug, settings) VALUES ('23500000-0000-0000-0000-00000000000a', 'ZZ235 Org', 'ZZ235A', 'zz235-org', '{}'::jsonb);
INSERT INTO branches (id, name, org_id) VALUES ('23500000-0000-0000-0000-0000000000a1', 'ZZ235 Branch', '23500000-0000-0000-0000-00000000000a');
INSERT INTO rooms (id, branch_id, name, capacity) VALUES ('23500000-0000-0000-0000-0000000e0001', '23500000-0000-0000-0000-0000000000a1', 'ZZ235 Room', 5);
INSERT INTO services (id, name, duration_minutes, price_npr, org_id) VALUES ('23500000-0000-0000-0000-0000000f0001', 'ZZ235 Massage', 60, 1000, '23500000-0000-0000-0000-00000000000a');
INSERT INTO auth.users (id, email) SELECT ('23500000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid, 'zz235-u' || n || '@example.test' FROM generate_series(1, 6) n;
INSERT INTO users (id, email, full_name, role, branch_id, org_id, login_access, calendar_visibility, can_view_customer_details, can_view_prices)
SELECT ('23500000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid, 'zz235-u' || n || '@example.test', 'ZZ235 U' || n,
       (CASE n WHEN 4 THEN 'manager' WHEN 5 THEN 'admin' ELSE 'staff' END)::user_role, '23500000-0000-0000-0000-0000000000a1', '23500000-0000-0000-0000-00000000000a', 'email',
       CASE WHEN n IN (1, 2, 6) THEN 'own' ELSE 'all' END, n NOT IN (1, 2), n NOT IN (1, 2)
FROM generate_series(1, 6) n;
INSERT INTO therapists (id, branch_id, name, gender, org_id, user_id) VALUES
  ('23500000-0000-0000-0000-0000000a0001', '23500000-0000-0000-0000-0000000000a1', 'ZZ235 Therapist A', 'Female', '23500000-0000-0000-0000-00000000000a', '23500000-0000-0000-0000-000000000101'),
  ('23500000-0000-0000-0000-0000000a0002', '23500000-0000-0000-0000-0000000000a1', 'ZZ235 Therapist B', 'Female', '23500000-0000-0000-0000-00000000000a', NULL);
-- customers: c1 and c3 book with A, c2 books with B
INSERT INTO customers (id, branch_id, full_name, phone, org_id) VALUES
  ('23500000-0000-0000-0000-0000000c0001', '23500000-0000-0000-0000-0000000000a1', 'Anisha Thakuri', '+9779801000001', '23500000-0000-0000-0000-00000000000a'),
  ('23500000-0000-0000-0000-0000000c0002', '23500000-0000-0000-0000-0000000000a1', 'Bikash Gurung',  '+9779801000002', '23500000-0000-0000-0000-00000000000a'),
  ('23500000-0000-0000-0000-0000000c0003', '23500000-0000-0000-0000-0000000000a1', 'Chandra Lama',   '+9779801000003', '23500000-0000-0000-0000-00000000000a');
INSERT INTO bookings (id, branch_id, room_id, service_id, service_name_snapshot, customer_id, customer_name, customer_phone, therapist_id, date, start_time, end_time, start_datetime, end_datetime, base_amount, final_amount, created_by, status)
SELECT ('23500000-0000-0000-0000-0000000b000' || n)::uuid, '23500000-0000-0000-0000-0000000000a1', '23500000-0000-0000-0000-0000000e0001', '23500000-0000-0000-0000-0000000f0001', 'ZZ235 Massage',
       ('23500000-0000-0000-0000-0000000c000' || n)::uuid, (ARRAY['Anisha Thakuri','Bikash Gurung','Chandra Lama'])[n], '+977980100000' || n,
       (CASE WHEN n = 2 THEN '23500000-0000-0000-0000-0000000a0002' ELSE '23500000-0000-0000-0000-0000000a0001' END)::uuid,
       current_date + n, '11:00', '12:00', ((current_date + n) + time '11:00') AT TIME ZONE 'Asia/Kathmandu', ((current_date + n) + time '12:00') AT TIME ZONE 'Asia/Kathmandu',
       1000, 1000, '23500000-0000-0000-0000-000000000105', 'Confirmed'::booking_status
FROM generate_series(1, 3) n;
INSERT INTO payments (booking_id, amount, payment_mode, recorded_by) SELECT id, 500, 'Cash', '23500000-0000-0000-0000-000000000105' FROM bookings WHERE branch_id = '23500000-0000-0000-0000-0000000000a1';
INSERT INTO booking_tips (booking_id, amount, recorded_by) SELECT id, 50, '23500000-0000-0000-0000-000000000105' FROM bookings WHERE branch_id = '23500000-0000-0000-0000-0000000000a1';
INSERT INTO notifications (user_id, type, title, body, booking_id, category) VALUES
  ('23500000-0000-0000-0000-000000000101', 'new_online_booking', 'New online booking: Anisha Thakuri', 'Anisha Thakuri · Massage · NPR 1,000 deposit', '23500000-0000-0000-0000-0000000b0001', 'bookings');
-- SQL masks must equal the JS ones (src/services/dataMasking.test.js asserts the same literals)
DO $$ BEGIN
  ASSERT mask_person_name('Anisha Thakuri') = 'Anisha T.', 'P1 name mask ' || mask_person_name('Anisha Thakuri');
  ASSERT mask_person_name('Kokwah') = 'Kokwah', 'P2 single word stays';
  ASSERT mask_person_name('Ashmi Thing Tamang') = 'Ashmi T.', 'P2b last initial, first name';
  ASSERT mask_phone_digits('+9779800000012') = '98•••••012', 'P3 phone mask ' || mask_phone_digits('+9779800000012');
  ASSERT mask_phone_digits('9800000012') = '98•••••012', 'P3b same without the country code';
  ASSERT mask_phone_digits('123') = '••••••••••', 'P4 short phone is fixed width';
END $$;
-- Each block: switch to the login, count through the BASE table and the SAFE view, assert no leak.
CREATE OR REPLACE FUNCTION pg_temp.as_login(n int) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', json_build_object('sub', ('23500000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0')), 'role', 'authenticated')::text, true); END $$;

SELECT pg_temp.as_login(1);
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int; s text;
BEGIN
  -- restricted + linked: A's two bookings only, masked, no money, nothing from the base tables
  SELECT count(*) INTO n FROM bookings_safe;            ASSERT n = 2, 'R1 own bookings only via bookings_safe, got ' || n;
  SELECT count(*) INTO n FROM bookings;                 ASSERT n = 0, 'R2 base bookings hidden, got ' || n;
  SELECT count(*) INTO n FROM bookings_safe WHERE customer_name !~ '^[A-Za-z]+ [A-Z]\.$' OR customer_phone !~ '^\d\d•••••\d{3}$' OR customer_email IS NOT NULL; ASSERT n = 0, 'R3 name is First L., phone is 98•••••094, no email';
  SELECT count(*) INTO n FROM bookings_safe WHERE final_amount IS NOT NULL OR base_amount IS NOT NULL OR service_price_snapshot IS NOT NULL; ASSERT n = 0, 'R4 no amounts on bookings';
  SELECT count(*) INTO n FROM bookings_safe WHERE customer_name ~ '(Thakuri|Gurung|Lama)' OR customer_phone ~ '9801000'; ASSERT n = 0, 'R5 no full surname or full phone';
  SELECT count(*) INTO n FROM customers;                ASSERT n = 0, 'R6 base customers hidden, got ' || n;
  SELECT count(*) INTO n FROM customers_safe;           ASSERT n = 2, 'R7 only customers with an own booking, got ' || n;
  SELECT count(*) INTO n FROM customers_safe WHERE full_name ~ '(Thakuri|Gurung|Lama)' OR phone !~ '^\d\d•••••\d{3}$' OR email IS NOT NULL; ASSERT n = 0, 'R8 customers masked';
  SELECT count(*) INTO n FROM payments;                 ASSERT n = 0, 'R9 base payments hidden';
  SELECT count(*) INTO n FROM payments_safe;            ASSERT n = 2, 'R10 payments of own bookings only, got ' || n;
  SELECT count(*) INTO n FROM payments_safe WHERE amount IS NOT NULL; ASSERT n = 0, 'R11 no payment amounts';
  SELECT count(*) INTO n FROM booking_tips;             ASSERT n = 0, 'R12 base tips hidden';
  SELECT count(*) INTO n FROM booking_tips_safe;        ASSERT n = 2, 'R13 tips of own bookings only, got ' || n;
  SELECT count(*) INTO n FROM bookings_safe WHERE id = '23500000-0000-0000-0000-0000000b0002'; ASSERT n = 0, 'R14 the other therapist booking is not visible';
  -- write: status change through the RPC; refused for someone else's booking
  PERFORM restricted_set_booking_status('23500000-0000-0000-0000-0000000b0001', 'In-Progress');
  SELECT status::text INTO s FROM bookings_safe WHERE id = '23500000-0000-0000-0000-0000000b0001'; ASSERT s = 'In-Progress', 'R15 status written, got ' || coalesce(s, 'null');
  BEGIN PERFORM restricted_set_booking_status('23500000-0000-0000-0000-0000000b0002', 'In-Progress'); ASSERT false, 'R16 other booking write must be refused';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  BEGIN PERFORM restricted_set_booking_status('23500000-0000-0000-0000-0000000b0001', 'Cancelled'); ASSERT false, 'R17 cancel needs a reason';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM restricted_set_booking_notes('23500000-0000-0000-0000-0000000b0003', 'allergic to nuts');
  SELECT special_requests INTO s FROM bookings_safe WHERE id = '23500000-0000-0000-0000-0000000b0003'; ASSERT s = 'allergic to nuts', 'R18 notes written, got ' || coalesce(s, 'null');
  BEGIN PERFORM restricted_set_booking_notes('23500000-0000-0000-0000-0000000b0002', 'x'); ASSERT false, 'R19 other booking notes must be refused';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  -- get_dashboard is wrapped by restrict_dashboard_json: no real name survives for this login (own + no details), own row included
  ASSERT restrict_dashboard_json('{"floor":[{"therapists":[{"therapist_id":"23500000-0000-0000-0000-0000000a0002","blocks":[{"label":"Bikash Gurung · Massage","booking_id":"23500000-0000-0000-0000-0000000b0002"}]},{"therapist_id":"23500000-0000-0000-0000-0000000a0001","blocks":[{"label":"Anisha Thakuri · Massage"}]}]}],"my_day":{"bookings":[{"customer":"Anisha Thakuri"}]}}'::jsonb)::text !~ '(Thakuri|Gurung)', 'R20 no surname in the dashboard';
  ASSERT restrict_dashboard_json('{"floor":[{"therapists":[{"therapist_id":"23500000-0000-0000-0000-0000000a0002","blocks":[{"label":"Bikash Gurung · Massage","booking_id":"23500000-0000-0000-0000-0000000b0002"}]},{"therapist_id":"23500000-0000-0000-0000-0000000a0001","blocks":[{"label":"Anisha Thakuri · Massage"}]}]}],"my_day":{"bookings":[{"customer":"Anisha Thakuri"}]}}'::jsonb)::text ~ 'Anisha T\. . Massage', 'R21 label masked in place, service kept';
  SELECT count(*) INTO n FROM notifications; ASSERT n = 0, 'R22 base notifications hidden';
  SELECT count(*) INTO n FROM notifications_safe WHERE title !~ 'Thakuri' AND body !~ 'Thakuri' AND body !~ 'NPR' AND body ~ 'Anisha T\.'; ASSERT n = 1, 'R23 notification masked (name, no amount), got ' || n;
  PERFORM restricted_mark_notifications_read(NULL);
  SELECT count(*) INTO n FROM notifications_safe WHERE read; ASSERT n = 1, 'R24 mark read via RPC';
  SELECT count(*) INTO n FROM restrict_dashboard_json('{"my_day":{"bookings":[{"id":"23500000-0000-0000-0000-0000000b0001","customer":"Anisha Thakuri"}]}}'::jsonb) j WHERE j::text ~ '"customer_tail": "001"'; ASSERT n = 1, 'R25 dashboard tail';
  RAISE NOTICE 'restricted + linked ok';
END $$;
RESET ROLE;

SELECT pg_temp.as_login(2);
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int;
BEGIN  -- restricted and NOT linked to a therapist: sees nothing anywhere (fail closed)
  SELECT count(*) INTO n FROM bookings_safe;  ASSERT n = 0, 'U1 unlinked: bookings_safe ' || n;
  SELECT count(*) INTO n FROM customers_safe; ASSERT n = 0, 'U2 unlinked: customers_safe ' || n;
  SELECT count(*) INTO n FROM payments_safe;  ASSERT n = 0, 'U3 unlinked: payments_safe ' || n;
  SELECT count(*) INTO n FROM bookings;       ASSERT n = 0, 'U4 unlinked: bookings ' || n;
  RAISE NOTICE 'restricted + unlinked ok';
END $$;
RESET ROLE;

-- Normal roles: unchanged. Base tables full, views identical to base (no masking), nothing hidden.
SELECT pg_temp.as_login(3);   -- unrestricted staff
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM bookings;        ASSERT n = 3, 'N1 staff sees all 3 bookings, got ' || n;
  SELECT count(*) INTO n FROM customers WHERE full_name IN ('Anisha Thakuri','Bikash Gurung','Chandra Lama'); ASSERT n = 3, 'N2 staff customers full, got ' || n;
  SELECT count(*) INTO n FROM payments;        ASSERT n = 3, 'N3 staff payments, got ' || n;
  SELECT count(*) INTO n FROM bookings WHERE final_amount = 1000 AND customer_name !~ '\*'; ASSERT n = 3, 'N4 staff real values';
  SELECT count(*) INTO n FROM bookings_safe WHERE customer_name !~ '\*' AND final_amount = 1000; ASSERT n = 3, 'N5 staff view not masked, got ' || n;
  ASSERT restrict_dashboard_json('{"floor":[{"therapists":[{"therapist_id":"23500000-0000-0000-0000-0000000a0002","blocks":[{"label":"Bikash Gurung · Massage","booking_id":"23500000-0000-0000-0000-0000000b0002"}]},{"therapist_id":"23500000-0000-0000-0000-0000000a0001","blocks":[{"label":"Anisha Thakuri · Massage"}]}]}],"my_day":{"bookings":[{"customer":"Anisha Thakuri"}]}}'::jsonb) = '{"floor":[{"therapists":[{"therapist_id":"23500000-0000-0000-0000-0000000a0002","blocks":[{"label":"Bikash Gurung · Massage","booking_id":"23500000-0000-0000-0000-0000000b0002"}]},{"therapist_id":"23500000-0000-0000-0000-0000000a0001","blocks":[{"label":"Anisha Thakuri · Massage"}]}]}],"my_day":{"bookings":[{"customer":"Anisha Thakuri"}]}}'::jsonb, 'N6 normal staff dashboard untouched';
  RAISE NOTICE 'normal staff ok';
END $$;
RESET ROLE;
SELECT pg_temp.as_login(4);   -- manager
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM bookings;   ASSERT n = 3, 'M1 manager bookings ' || n;
  SELECT count(*) INTO n FROM customers WHERE full_name !~ '\*'; ASSERT n = 3, 'M2 manager customers ' || n;
  SELECT count(*) INTO n FROM payments;   ASSERT n = 3, 'M3 manager payments ' || n;
  SELECT count(*) INTO n FROM bookings_safe WHERE customer_name !~ '\*' AND final_amount = 1000; ASSERT n = 3, 'M4 manager view unmasked ' || n;
  RAISE NOTICE 'manager ok';
END $$;
RESET ROLE;
SELECT pg_temp.as_login(5);   -- admin
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM bookings;   ASSERT n = 3, 'A1 admin bookings ' || n;
  SELECT count(*) INTO n FROM customers WHERE full_name !~ '\*'; ASSERT n = 3, 'A2 admin customers ' || n;
  SELECT count(*) INTO n FROM payments;   ASSERT n = 3, 'A3 admin payments ' || n;
  SELECT count(*) INTO n FROM booking_tips; ASSERT n = 3, 'A4 admin tips ' || n;
  RAISE NOTICE 'admin ok';
END $$;
RESET ROLE;
ROLLBACK;
\echo 235 PASSED
