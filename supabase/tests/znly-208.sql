-- ZNLY-208: a tiered price follows the team member until paid (migration 382). Scratch database only (scripts/qc-4c.sh).
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO organizations (id, name, code, slug, settings) VALUES ('20800000-0000-0000-0000-00000000000a', 'ZZ208 Org', 'ZZ208A', 'zz208-org', '{}'::jsonb);
INSERT INTO branches (id, name, org_id) VALUES ('20800000-0000-0000-0000-0000000000a1', 'ZZ208 Branch', '20800000-0000-0000-0000-00000000000a');
INSERT INTO rooms (id, branch_id, name, capacity) VALUES ('20800000-0000-0000-0000-0000000e0001', '20800000-0000-0000-0000-0000000000a1', 'ZZ208 Room', 9);
INSERT INTO price_tiers (id, org_id, name) VALUES ('20800000-0000-0000-0000-0000000a0001', '20800000-0000-0000-0000-00000000000a', 'Senior'),
                                                  ('20800000-0000-0000-0000-0000000a0002', '20800000-0000-0000-0000-00000000000a', 'Junior');
INSERT INTO therapists (id, branch_id, name, gender, org_id, price_tier_id) VALUES
  ('20800000-0000-0000-0000-000000000001', '20800000-0000-0000-0000-0000000000a1', 'ZZ208 Senior', 'Female', '20800000-0000-0000-0000-00000000000a', '20800000-0000-0000-0000-0000000a0001'),
  ('20800000-0000-0000-0000-000000000002', '20800000-0000-0000-0000-0000000000a1', 'ZZ208 Junior', 'Female', '20800000-0000-0000-0000-00000000000a', '20800000-0000-0000-0000-0000000a0002'),
  ('20800000-0000-0000-0000-000000000003', '20800000-0000-0000-0000-0000000000a1', 'ZZ208 NoTier', 'Female', '20800000-0000-0000-0000-00000000000a', NULL);
-- S1 tiered (standard 1000; Senior 1500, Junior 800), S2 tiered (standard 600; Senior 900), S3 fixed 700
INSERT INTO services (id, name, duration_minutes, price_npr, price_type, org_id) VALUES
  ('20800000-0000-0000-0000-0000000f0001', 'ZZ208 Massage', 60, 1000, 'tiered', '20800000-0000-0000-0000-00000000000a'),
  ('20800000-0000-0000-0000-0000000f0002', 'ZZ208 Facial', 30, 600, 'tiered', '20800000-0000-0000-0000-00000000000a'),
  ('20800000-0000-0000-0000-0000000f0003', 'ZZ208 Fixed', 60, 700, 'fixed', '20800000-0000-0000-0000-00000000000a');
INSERT INTO service_tier_prices (service_id, price_tier_id, price_npr) VALUES
  ('20800000-0000-0000-0000-0000000f0001', '20800000-0000-0000-0000-0000000a0001', 1500),
  ('20800000-0000-0000-0000-0000000f0001', '20800000-0000-0000-0000-0000000a0002', 800),
  ('20800000-0000-0000-0000-0000000f0002', '20800000-0000-0000-0000-0000000a0001', 900);
INSERT INTO auth.users (id, email) VALUES ('20800000-0000-0000-0000-000000000101', 'zz208-admin@example.test');
INSERT INTO users (id, email, full_name, role, branch_id, org_id, login_access)
  VALUES ('20800000-0000-0000-0000-000000000101', 'zz208-admin@example.test', 'ZZ208 Admin', 'admin', '20800000-0000-0000-0000-0000000000a1', '20800000-0000-0000-0000-00000000000a', 'email');
-- bookings: 1 assign path (discount 100), 2 reschedule path (discount 100), 3 paid, 4 combo, 5 fixed service
INSERT INTO bookings (id, branch_id, room_id, service_id, customer_name, customer_phone, date, start_time, end_time, start_datetime, end_datetime, base_amount, final_amount, created_by, status)
SELECT ('20800000-0000-0000-0000-0000000b000' || n)::uuid, '20800000-0000-0000-0000-0000000000a1', '20800000-0000-0000-0000-0000000e0001',
       CASE n WHEN 4 THEN '20800000-0000-0000-0000-0000000f0001' WHEN 5 THEN '20800000-0000-0000-0000-0000000f0003' ELSE '20800000-0000-0000-0000-0000000f0001' END::uuid,
       'ZZ208 b' || n, '9800000208', current_date + 60 + n, '11:00', '12:00',
       ((current_date + 60 + n) + time '11:00') AT TIME ZONE 'Asia/Kathmandu', ((current_date + 60 + n) + time '12:00') AT TIME ZONE 'Asia/Kathmandu',
       CASE n WHEN 5 THEN 700 ELSE 1000 END, CASE n WHEN 5 THEN 700 ELSE 1000 END, '20800000-0000-0000-0000-000000000101', 'Confirmed'::booking_status
FROM generate_series(1, 5) n;
UPDATE bookings SET discount_amount = 100, discount_status = 'approved', discount_approved_by = '20800000-0000-0000-0000-000000000101'
 WHERE id IN ('20800000-0000-0000-0000-0000000b0001', '20800000-0000-0000-0000-0000000b0002');
COMMIT;

DO $$
DECLARE
  b1 constant uuid := '20800000-0000-0000-0000-0000000b0001'; b3 constant uuid := '20800000-0000-0000-0000-0000000b0003';
  b4 constant uuid := '20800000-0000-0000-0000-0000000b0004'; b5 constant uuid := '20800000-0000-0000-0000-0000000b0005';
  sen constant uuid := '20800000-0000-0000-0000-000000000001'; jun constant uuid := '20800000-0000-0000-0000-000000000002'; nt constant uuid := '20800000-0000-0000-0000-000000000003';
  r record;
BEGIN
  -- assign / reassign / calendar drag (all are an UPDATE of therapist_id): the price follows the member, the 100 discount stays on top
  UPDATE bookings SET therapist_id = sen WHERE id = b1;
  SELECT base_amount, discount_amount, final_amount INTO r FROM bookings WHERE id = b1;
  ASSERT r.base_amount = 1500 AND r.final_amount = 1400, 'A1 Senior: base 1500, final 1400 (discount stays), got ' || r.base_amount || '/' || r.final_amount;
  UPDATE bookings SET therapist_id = jun WHERE id = b1;
  SELECT base_amount, final_amount INTO r FROM bookings WHERE id = b1;
  ASSERT r.base_amount = 800 AND r.final_amount = 700, 'A2 Junior: 800/700, got ' || r.base_amount || '/' || r.final_amount;
  UPDATE bookings SET therapist_id = nt WHERE id = b1;
  SELECT base_amount, final_amount INTO r FROM bookings WHERE id = b1;
  ASSERT r.base_amount = 1000 AND r.final_amount = 900, 'A3 no tier: standard price, got ' || r.base_amount;
  UPDATE bookings SET therapist_id = sen WHERE id = b1;
  UPDATE bookings SET therapist_id = NULL WHERE id = b1;
  SELECT base_amount INTO r FROM bookings WHERE id = b1;
  ASSERT r.base_amount = 1000, 'A4 nobody assigned: standard price, got ' || r.base_amount;
  -- a fixed-price service never re-prices
  UPDATE bookings SET therapist_id = sen WHERE id = b5;
  ASSERT (SELECT base_amount FROM bookings WHERE id = b5) = 700, 'A5 fixed service keeps its price';

  -- a change to a tier / tier prices is NOT pushed into existing bookings; it applies at the next team member change
  UPDATE bookings SET therapist_id = sen WHERE id = b1;
  UPDATE service_tier_prices SET price_npr = 2000 WHERE service_id = '20800000-0000-0000-0000-0000000f0001' AND price_tier_id = '20800000-0000-0000-0000-0000000a0001';
  ASSERT (SELECT base_amount FROM bookings WHERE id = b1) = 1500, 'N1 existing booking not changed by a tier price change';
  UPDATE bookings SET therapist_id = jun WHERE id = b1; UPDATE bookings SET therapist_id = sen WHERE id = b1;
  ASSERT (SELECT base_amount FROM bookings WHERE id = b1) = 2000, 'N2 applies when the team member changes next';

  -- once ANY payment exists the price is locked, even when the caller sends a new base_amount with the new member
  UPDATE bookings SET therapist_id = jun WHERE id = b3;   -- unpaid: 800
  INSERT INTO payments (booking_id, amount, payment_mode, recorded_by) VALUES (b3, 300, 'Cash', '20800000-0000-0000-0000-000000000101');
  UPDATE bookings SET therapist_id = sen WHERE id = b3;
  ASSERT (SELECT base_amount FROM bookings WHERE id = b3) = 800, 'L1 part-paid: price locked on reassign';
  UPDATE bookings SET therapist_id = nt, base_amount = 1000 WHERE id = b3;
  ASSERT (SELECT base_amount FROM bookings WHERE id = b3) = 800, 'L2 part-paid: an explicit new base is refused too';

  -- combo parts: each part priced by its own member; the total is the sum
  INSERT INTO booking_combo_items (booking_id, service_id, therapist_id, display_order, base_share_amount) VALUES
    (b4, '20800000-0000-0000-0000-0000000f0001', nt, 1, 1000), (b4, '20800000-0000-0000-0000-0000000f0002', nt, 2, 600);
  UPDATE bookings SET base_amount = 1600 WHERE id = b4;
  UPDATE booking_combo_items SET therapist_id = sen WHERE booking_id = b4 AND display_order = 1;   -- 1000 -> 2000 (tier price now 2000)
  ASSERT (SELECT base_amount FROM bookings WHERE id = b4) = 2600, 'C1 part 1 re-priced: total 2600, got ' || (SELECT base_amount FROM bookings WHERE id = b4);
  UPDATE booking_combo_items SET therapist_id = sen WHERE booking_id = b4 AND display_order = 2;   -- 600 -> 900
  ASSERT (SELECT base_amount FROM bookings WHERE id = b4) = 2900 AND (SELECT final_amount FROM bookings WHERE id = b4) = 2900, 'C2 part 2 re-priced: total 2900';
  RAISE NOTICE 'assign / lock / combo passed';
END $$;

-- the lock must not depend on what the caller can see: a staff user whose RLS hides the booking's payments (a restrictive policy stands in
-- for any such rule) re-assigns a part-paid booking; the price must stay locked. Runs as a non-superuser.
BEGIN;
INSERT INTO auth.users (id, email) VALUES ('20800000-0000-0000-0000-000000000102', 'zz208-staff@example.test');
INSERT INTO users (id, email, full_name, role, branch_id, org_id, login_access)
  VALUES ('20800000-0000-0000-0000-000000000102', 'zz208-staff@example.test', 'ZZ208 Staff', 'staff', '20800000-0000-0000-0000-0000000000a1', '20800000-0000-0000-0000-00000000000a', 'email');
CREATE POLICY zz208_hide_payments ON payments AS RESTRICTIVE FOR SELECT TO authenticated USING (false);
SELECT set_config('request.jwt.claims', '{"sub":"20800000-0000-0000-0000-000000000102","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE b3 constant uuid := '20800000-0000-0000-0000-0000000b0003'; n int;
BEGIN
  SELECT count(*) INTO n FROM payments WHERE booking_id = b3;
  ASSERT n = 0, 'S0 the staff user must not see the payments (policy under test), saw ' || n;
  ASSERT (SELECT base_amount FROM bookings WHERE id = b3) = 800, 'S1 booking readable, price 800';
  UPDATE bookings SET therapist_id = '20800000-0000-0000-0000-000000000001' WHERE id = b3;   -- Senior would be 2000
  ASSERT (SELECT base_amount FROM bookings WHERE id = b3) = 800, 'S2 price stays locked although the caller cannot see the payments';
  ASSERT NOT has_function_privilege('authenticated', 'public._booking_price_locked(uuid)', 'EXECUTE'), 'S3 the lock helper is not callable by users';
  RAISE NOTICE 'lock-as-owner passed';
END $$;
ROLLBACK;

-- reschedule (the RPC copies the booking): the new row is priced from the NEW member, discount on top
BEGIN;
SELECT set_config('request.jwt.claims', '{"sub":"20800000-0000-0000-0000-000000000101","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE res jsonb; r record;
BEGIN
  res := reschedule_booking('20800000-0000-0000-0000-0000000b0002', current_date + 90, '14:00', '20800000-0000-0000-0000-000000000002', NULL, 'ZZ208 move', 'ZZ208 test override');
  SELECT base_amount, discount_amount, final_amount INTO r FROM bookings WHERE id = (res->>'id')::uuid;
  ASSERT r.base_amount = 800 AND r.discount_amount = 100 AND r.final_amount = 700, 'R1 reschedule onto Junior: 800 / discount 100 / 700, got ' || r.base_amount || '/' || r.discount_amount || '/' || r.final_amount;
  res := reschedule_booking((res->>'id')::uuid, current_date + 91, '14:00', NULL, NULL, 'ZZ208 move', 'ZZ208 test override');
  SELECT base_amount, final_amount INTO r FROM bookings WHERE id = (res->>'id')::uuid;
  ASSERT r.base_amount = 1000 AND r.final_amount = 900, 'R2 reschedule to nobody: standard price, got ' || r.base_amount;
  RAISE NOTICE 'reschedule passed';
END $$;
ROLLBACK;
\echo 208 PASSED
