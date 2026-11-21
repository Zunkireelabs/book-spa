-- ZNLY-206: a checkout pays once (record_booking_payment, migration 380). Scratch database only (scripts/qc-4c.sh).
-- Nuad-Thai-shaped: one org, one branch, one staff login, a 1000-rupee booking, split and part-paid ("due") cases.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO organizations (id, name, code, slug, settings) VALUES ('20600000-0000-0000-0000-00000000000a', 'ZZ206 Org', 'ZZ206A', 'zz206-org', '{}'::jsonb);
INSERT INTO branches (id, name, org_id) VALUES ('20600000-0000-0000-0000-0000000000a1', 'ZZ206 Branch', '20600000-0000-0000-0000-00000000000a');
INSERT INTO rooms (id, branch_id, name, capacity) VALUES ('20600000-0000-0000-0000-0000000e0001', '20600000-0000-0000-0000-0000000000a1', 'ZZ206 Room', 3);
INSERT INTO services (id, name, duration_minutes, price_npr, org_id) VALUES ('20600000-0000-0000-0000-0000000f0001', 'ZZ206 Service', 60, 1000, '20600000-0000-0000-0000-00000000000a');
INSERT INTO auth.users (id, email) VALUES ('20600000-0000-0000-0000-000000000101', 'zz206-staff@example.test');
INSERT INTO users (id, email, full_name, role, branch_id, org_id, login_access)
  VALUES ('20600000-0000-0000-0000-000000000101', 'zz206-staff@example.test', 'ZZ206 Staff', 'staff', '20600000-0000-0000-0000-0000000000a1', '20600000-0000-0000-0000-00000000000a', 'email');
-- bookings: 1 parallel, 2 retry/over/split, 3 part-paid, 4 free (100% discount), 5 pending
INSERT INTO bookings (id, branch_id, room_id, service_id, customer_name, customer_phone, date, start_time, end_time, start_datetime, end_datetime, base_amount, final_amount, created_by, status)
SELECT ('20600000-0000-0000-0000-0000000b000' || n)::uuid, '20600000-0000-0000-0000-0000000000a1', '20600000-0000-0000-0000-0000000e0001', '20600000-0000-0000-0000-0000000f0001',
       CASE n WHEN 1 THEN 'ZZ206 parallel' ELSE 'ZZ206 b' || n END, '9800000206', current_date + 40 + n, '11:00', '12:00',
       ((current_date + 40 + n) + time '11:00') AT TIME ZONE 'Asia/Kathmandu', ((current_date + 40 + n) + time '12:00') AT TIME ZONE 'Asia/Kathmandu',
       1000, CASE n WHEN 4 THEN 0 ELSE 1000 END, '20600000-0000-0000-0000-000000000101', CASE n WHEN 5 THEN 'Pending' ELSE 'Confirmed' END::booking_status
FROM generate_series(1, 5) n;
UPDATE bookings SET discount_amount = 1000, discount_status = 'approved', discount_approved_by = '20600000-0000-0000-0000-000000000101' WHERE id = '20600000-0000-0000-0000-0000000b0004';   -- 100% discount: the trigger leaves final_amount 0
COMMIT;

BEGIN;
SELECT set_config('request.jwt.claims', '{"sub":"20600000-0000-0000-0000-000000000101","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  b2 constant uuid := '20600000-0000-0000-0000-0000000b0002'; b3 constant uuid := '20600000-0000-0000-0000-0000000b0003';
  b4 constant uuid := '20600000-0000-0000-0000-0000000b0004'; b5 constant uuid := '20600000-0000-0000-0000-0000000b0005';
  k1 constant uuid := '20600000-0000-0000-0000-0000000000c1'; k2 constant uuid := '20600000-0000-0000-0000-0000000000c2';
  r1 jsonb; r2 jsonb; n int; msg text;
BEGIN
  -- same key twice -> same payment ids, one row, second marked as replay
  r1 := record_booking_payment(b2, '[{"amount":300,"payment_mode":"Cash"}]', k1, 'first');
  r2 := record_booking_payment(b2, '[{"amount":300,"payment_mode":"Cash"}]', k1, 'first');
  ASSERT r1->'payment_ids' = r2->'payment_ids', 'T1 same key returns the same payment ids';
  ASSERT (r2->>'replayed')::boolean AND NOT (r1->>'replayed')::boolean, 'T1 retry is flagged as a replay';
  SELECT count(*) INTO n FROM payments WHERE booking_id = b2; ASSERT n = 1, 'T1 one payment row, got ' || n;

  -- a tender above what is still owed (700 left) is refused and writes nothing
  BEGIN
    PERFORM record_booking_payment(b2, '[{"amount":1500,"payment_mode":"Cash"}]', k2, NULL);
    ASSERT false, 'T2 over-tender must be refused';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    ASSERT msg LIKE 'OVERPAYMENT:%', 'T2 wrong error: ' || msg;
    ASSERT msg !~ '[0-9]', 'T2 the refusal must not carry amounts (price-restricted staff): ' || msg;
  END;
  SELECT count(*) INTO n FROM payments WHERE booking_id = b2; ASSERT n = 1, 'T2 nothing written by the refusal';

  -- split payment finishes the booking
  r1 := record_booking_payment(b2, '[{"amount":400,"payment_mode":"Cash"},{"amount":300,"payment_mode":"eSewa"}]', k2, NULL);   -- k2 was the refused attempt's key: still free
  ASSERT NOT (r1->>'replayed')::boolean, 'T2 the key of a refused attempt stays free';
  ASSERT jsonb_array_length(r1->'payment_ids') = 2, 'T3 split writes two rows';
  ASSERT (SELECT payment_status FROM bookings WHERE id = b2) = 'paid', 'T3 split settles the booking';
  BEGIN
    PERFORM record_booking_payment(b2, '[{"amount":1,"payment_mode":"Cash"}]', gen_random_uuid(), NULL);
    ASSERT false, 'T3b a paid booking takes no more';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT; ASSERT msg LIKE 'ALREADY_PAID:%', 'T3b wrong error: ' || msg;
  END;

  -- part payment ("due") then the rest
  PERFORM record_booking_payment(b3, '[{"amount":400,"payment_mode":"Cash"}]', gen_random_uuid(), NULL);
  ASSERT (SELECT payment_status FROM bookings WHERE id = b3) <> 'paid', 'T4 part payment leaves it open';
  PERFORM record_booking_payment(b3, '[{"amount":600,"payment_mode":"Card"}]', gen_random_uuid(), NULL);
  ASSERT (SELECT payment_status FROM bookings WHERE id = b3) = 'paid', 'T4 the rest settles it';

  -- a 100% discount: a zero row settles it; a zero row on an unpaid booking is refused
  PERFORM record_booking_payment(b4, '[{"amount":0,"payment_mode":"No Charge"}]', gen_random_uuid(), 'free');
  ASSERT (SELECT payment_status FROM bookings WHERE id = b4) = 'paid', 'T5 zero settle on a free booking';
  BEGIN
    PERFORM record_booking_payment('20600000-0000-0000-0000-0000000b0001', '[{"amount":0,"payment_mode":"Cash"}]', gen_random_uuid(), NULL);
    ASSERT false, 'T5b zero row on an owing booking must be refused';
  EXCEPTION WHEN raise_exception THEN NULL; END;

  -- wallet modes only through their own function; pending booking cannot be paid; no direct INSERT any more
  BEGIN PERFORM record_booking_payment(b5, '[{"amount":10,"payment_mode":"Membership"}]', gen_random_uuid(), NULL); ASSERT false, 'T6 wallet mode refused';
  EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT; ASSERT msg LIKE 'INVALID_PAYMENT_MODE:%', 'T6 ' || msg; END;
  BEGIN PERFORM record_booking_payment(b5, '[{"amount":10,"payment_mode":"Cash"}]', gen_random_uuid(), NULL); ASSERT false, 'T7 pending refused';
  EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT; ASSERT msg LIKE 'INVALID_PAYMENT_STATE:%', 'T7 ' || msg; END;
  BEGIN
    INSERT INTO payments (booking_id, amount, payment_mode, recorded_by) VALUES ('20600000-0000-0000-0000-0000000b0001', 1000, 'Cash', '20600000-0000-0000-0000-000000000101');
    ASSERT false, 'T8 direct INSERT on payments must be refused for staff';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT NOT has_table_privilege('authenticated', 'public.payments', 'INSERT'), 'T8 no INSERT privilege';
  RAISE NOTICE 'T1-T8 passed';
END $$;
ROLLBACK;
\echo 206 PASSED
