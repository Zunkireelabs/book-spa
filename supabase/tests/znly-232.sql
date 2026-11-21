-- ZNLY-232: the dashboard Close card money rule (migration 391, get_dashboard). Runs in ONE transaction and ROLLS BACK: leaves nothing behind.
-- Same fixture + same expected numbers as src/lib/dayMoney.test.js, so the SQL rule and the JS rule (Close card, Daily Reconciliation) are pinned to agree.
--   booking payments today : Cash 100, Khalti 300, Membership 200 (wallet: not money in)
--   product sales today    : Cash 800 + Esewa 100 + Membership 50 (wallet); another sale, Cash 999, refunded the same day (left out whole)
--   product sale YESTERDAY, Cash 150, refunded today -> a refund today
--   a booking dated TOMORROW but paid today: Cash 70 (cash-day basis: counts today)
--   booking refund today   : 40
--   => by_method Cash 970, Khalti 300, Esewa 100 | refunds 190 | taken 1180 | cash_expected 780 (the Nuad Smoke case: cash was 100, drawer held 900)
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO organizations (id, name, code, slug) VALUES ('23200000-0000-0000-0000-00000000000a', 'ZZ232 Org', 'ZZ232A', 'zz232-org');
INSERT INTO branches (id, name, org_id) VALUES ('23200000-0000-0000-0000-0000000000a1', 'ZZ232 Branch', '23200000-0000-0000-0000-00000000000a');
INSERT INTO auth.users (id, email) VALUES ('23200000-0000-0000-0000-000000000101', 'zz232-admin@example.test');
INSERT INTO users (id, email, full_name, role, branch_id, org_id, login_access)
  VALUES ('23200000-0000-0000-0000-000000000101', 'zz232-admin@example.test', 'ZZ232 Admin', 'admin', '23200000-0000-0000-0000-0000000000a1', '23200000-0000-0000-0000-00000000000a', 'email');
INSERT INTO services (id, name, duration_minutes, price_npr, org_id) VALUES ('23200000-0000-0000-0000-0000000f0001', 'ZZ232 Massage', 60, 1000, '23200000-0000-0000-0000-00000000000a');
INSERT INTO bookings (id, branch_id, service_id, service_name_snapshot, customer_name, customer_phone, date, start_time, end_time, start_datetime, end_datetime, base_amount, final_amount, created_by, status)
VALUES ('23200000-0000-0000-0000-0000000b0001', '23200000-0000-0000-0000-0000000000a1', '23200000-0000-0000-0000-0000000f0001', 'ZZ232 Massage', 'ZZ232 c', '9800000232',
        (now() AT TIME ZONE 'Asia/Kathmandu')::date, '11:00', '12:00', now(), now() + interval '1 hour', 1000, 1000, '23200000-0000-0000-0000-000000000101', 'Pending');
INSERT INTO bookings (id, branch_id, service_id, service_name_snapshot, customer_name, customer_phone, date, start_time, end_time, start_datetime, end_datetime, base_amount, final_amount, created_by, status)
VALUES ('23200000-0000-0000-0000-0000000b0002', '23200000-0000-0000-0000-0000000000a1', '23200000-0000-0000-0000-0000000f0001', 'ZZ232 Massage', 'ZZ232 d', '9800000233',
        (now() AT TIME ZONE 'Asia/Kathmandu')::date + 1, '11:00', '12:00', now() + interval '1 day', now() + interval '1 day 1 hour', 1000, 1000, '23200000-0000-0000-0000-000000000101', 'Pending');
INSERT INTO payments (booking_id, amount, payment_mode, recorded_by) VALUES ('23200000-0000-0000-0000-0000000b0002', 70, 'Cash', '23200000-0000-0000-0000-000000000101');
INSERT INTO payments (booking_id, amount, payment_mode, recorded_by) VALUES
  ('23200000-0000-0000-0000-0000000b0001', 60, 'cash', '23200000-0000-0000-0000-000000000101'),
  ('23200000-0000-0000-0000-0000000b0001', 40, 'Cash', '23200000-0000-0000-0000-000000000101'),
  ('23200000-0000-0000-0000-0000000b0001', 300, 'Khalti', '23200000-0000-0000-0000-000000000101'),
  ('23200000-0000-0000-0000-0000000b0001', 200, 'Membership', '23200000-0000-0000-0000-000000000101');
INSERT INTO payment_refunds (booking_id, org_id, amount) VALUES ('23200000-0000-0000-0000-0000000b0001', '23200000-0000-0000-0000-00000000000a', 40);
INSERT INTO products (id, org_id, name, price_npr) VALUES ('23200000-0000-0000-0000-0000000d0001', '23200000-0000-0000-0000-00000000000a', 'ZZ232 Oil', 100);
INSERT INTO product_sales (id, org_id, branch_id, product_id, product_name, quantity, unit_price_npr, total_amount, payment_mode, sold_by, created_at, refunded_at) VALUES
  ('23200000-0000-0000-0000-0000000a0001', '23200000-0000-0000-0000-00000000000a', '23200000-0000-0000-0000-0000000000a1', '23200000-0000-0000-0000-0000000d0001', 'ZZ232 Oil', 1, 950, 950, 'Cash', '23200000-0000-0000-0000-000000000101', now(), NULL),
  ('23200000-0000-0000-0000-0000000a0002', '23200000-0000-0000-0000-00000000000a', '23200000-0000-0000-0000-0000000000a1', '23200000-0000-0000-0000-0000000d0001', 'ZZ232 Oil', 1, 999, 999, 'Cash', '23200000-0000-0000-0000-000000000101', now(), now()),
  ('23200000-0000-0000-0000-0000000a0003', '23200000-0000-0000-0000-00000000000a', '23200000-0000-0000-0000-0000000000a1', '23200000-0000-0000-0000-0000000d0001', 'ZZ232 Oil', 1, 150, 150, 'Cash', '23200000-0000-0000-0000-000000000101', now() - interval '2 days', now());
INSERT INTO product_sale_payments (sale_id, org_id, payment_mode, amount) VALUES
  ('23200000-0000-0000-0000-0000000a0001', '23200000-0000-0000-0000-00000000000a', 'Cash', 800),
  ('23200000-0000-0000-0000-0000000a0001', '23200000-0000-0000-0000-00000000000a', 'Esewa', 100),
  ('23200000-0000-0000-0000-0000000a0001', '23200000-0000-0000-0000-00000000000a', 'Membership', 50),
  ('23200000-0000-0000-0000-0000000a0002', '23200000-0000-0000-0000-00000000000a', 'Cash', 999),
  ('23200000-0000-0000-0000-0000000a0003', '23200000-0000-0000-0000-00000000000a', 'Cash', 150);

SELECT set_config('request.jwt.claims', '{"sub":"23200000-0000-0000-0000-000000000101","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE r jsonb; m jsonb; d jsonb; s numeric; k text;
BEGIN
  r := public.get_dashboard(ARRAY['23200000-0000-0000-0000-0000000000a1'::uuid]);
  m := r->'money';
  ASSERT (m->'by_method'->>'Cash')::numeric = 970, 'Cash in 970 (booking 100 + other-day booking 70 + product 800), got ' || (m->'by_method'->>'Cash');
  ASSERT (m->'by_method'->>'Khalti')::numeric = 300, 'Khalti 300';
  ASSERT (m->'by_method'->>'Esewa')::numeric = 100, 'Esewa 100';
  ASSERT NOT (m->'by_method' ? 'Membership'), 'wallet tender is not money in';
  ASSERT (SELECT count(*) FROM jsonb_object_keys(m->'by_method')) = 3, 'exactly the three real methods';
  ASSERT (m->>'refunds')::numeric = 190, 'refunds 190 = booking 40 + yesterday''s product sale 150, got ' || (m->>'refunds');
  ASSERT (m->>'cash_expected')::numeric = 780, 'cash expected = 970 - 190, got ' || (m->>'cash_expected');
  ASSERT (m->>'taken')::numeric = 1180, 'taken = 1370 - 190';
  SELECT sum(value::numeric) INTO s FROM jsonb_each_text(m->'by_method');
  ASSERT s - (m->>'refunds')::numeric = (m->>'taken')::numeric, 'the rows add up: methods - refunds = taken';
  ASSERT (r->'pulse'->>'revenue')::numeric = (m->>'taken')::numeric, 'Taken today tile = Close card';
  ASSERT (r->'branches'->0->>'revenue')::numeric = (m->>'taken')::numeric, 'branch revenue = Close card';
  -- The Daily Reconciliation reads the SAME figures through get_day_money (one source with the Close card)
  d := public.get_day_money('23200000-0000-0000-0000-0000000000a1'::uuid, (now() AT TIME ZONE 'Asia/Kathmandu')::date);
  ASSERT d->'by_method' = m->'by_method' AND d->'refunds' = m->'refunds' AND d->'taken' = m->'taken' AND d->'cash_expected' = m->'cash_expected', 'get_day_money = dashboard money';
  RAISE NOTICE '232 PASSED';
END $$;
ROLLBACK;
