-- ZNLY-234 (migration 392). One transaction, ROLLS BACK: leaves nothing behind.
--  1. a balance on a closed-day booking can be collected (record_booking_payment AND record_group_payment); it lands today (payments.created_at),
--     the booking turns 'paid', the closed daily_reports row is byte-identical afterwards
--  2. everything else on a locked booking stays blocked (price, status, even payment_status by hand)
--  3. Close Day (daily_reports insert) is refused while a booking is Pending/Confirmed/In-Progress, naming it; day_unfinished_bookings lists it;
--     a Completed booking with a balance does NOT block the close
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO organizations (id, name, code, slug) VALUES ('23400000-0000-0000-0000-00000000000a', 'ZZ234 Org', 'ZZ234A', 'zz234-org');
INSERT INTO branches (id, name, org_id) VALUES ('23400000-0000-0000-0000-0000000000a1', 'ZZ234 Branch', '23400000-0000-0000-0000-00000000000a');
INSERT INTO auth.users (id, email) VALUES ('23400000-0000-0000-0000-000000000101', 'zz234-admin@example.test');
INSERT INTO users (id, email, full_name, role, branch_id, org_id, login_access)
  VALUES ('23400000-0000-0000-0000-000000000101', 'zz234-admin@example.test', 'ZZ234 Admin', 'admin', '23400000-0000-0000-0000-0000000000a1', '23400000-0000-0000-0000-00000000000a', 'email');
INSERT INTO services (id, name, duration_minutes, price_npr, org_id) VALUES ('23400000-0000-0000-0000-0000000f0001', 'ZZ234 Massage', 60, 1000, '23400000-0000-0000-0000-00000000000a');
-- the closed day: yesterday (report written first, while it has no unfinished bookings), then two locked bookings on it
INSERT INTO daily_reports (id, branch_id, report_date, total_bookings, net_revenue, cash_total, card_total, fonepay_total, closed_by)
  VALUES ('23400000-0000-0000-0000-0000000c0001', '23400000-0000-0000-0000-0000000000a1', (now() AT TIME ZONE 'Asia/Kathmandu')::date - 1, 2, 400, 400, 0, 0, '23400000-0000-0000-0000-000000000101');
INSERT INTO bookings (id, branch_id, service_id, service_name_snapshot, customer_name, customer_phone, date, start_time, end_time, start_datetime, end_datetime, base_amount, final_amount, created_by, status, is_locked)
SELECT ('23400000-0000-0000-0000-0000000b000' || n)::uuid, '23400000-0000-0000-0000-0000000000a1', '23400000-0000-0000-0000-0000000f0001', 'ZZ234 Massage', 'ZZ234 c' || n, '980000023' || n,
       (now() AT TIME ZONE 'Asia/Kathmandu')::date - 1, '11:00', '12:00', now() - interval '1 day', now() - interval '23 hours', 1000, 1000, '23400000-0000-0000-0000-000000000101', 'Confirmed', true
  FROM generate_series(1, 2) n;
INSERT INTO payments (booking_id, amount, payment_mode, recorded_by) VALUES ('23400000-0000-0000-0000-0000000b0001', 400, 'Cash', '23400000-0000-0000-0000-000000000101');
-- (that insert ran the payment trigger on a LOCKED booking: part-paid is the starting state)

DO $$
DECLARE refused boolean; msg text;
BEGIN
  ASSERT (SELECT payment_status FROM bookings WHERE id = '23400000-0000-0000-0000-0000000b0001') = 'partial', 'locked booking went part-paid through the payment trigger';
  -- 2. everything else stays blocked
  refused := false; BEGIN UPDATE bookings SET final_amount = 1 WHERE id = '23400000-0000-0000-0000-0000000b0001'; EXCEPTION WHEN OTHERS THEN refused := SQLERRM LIKE 'DAY_LOCKED%'; END;
  ASSERT refused, 'price change on a locked booking must stay blocked';
  refused := false; BEGIN UPDATE bookings SET status = 'Cancelled' WHERE id = '23400000-0000-0000-0000-0000000b0001'; EXCEPTION WHEN OTHERS THEN refused := SQLERRM LIKE 'DAY_LOCKED%'; END;
  ASSERT refused, 'status change on a locked booking must stay blocked';
  refused := false; BEGIN UPDATE bookings SET payment_status = 'paid' WHERE id = '23400000-0000-0000-0000-0000000b0001'; EXCEPTION WHEN OTHERS THEN refused := SQLERRM LIKE 'DAY_LOCKED%'; END;
  ASSERT refused, 'payment_status cannot be set by hand on a locked booking (only the payment trigger may)';
END $$;

CREATE TEMP TABLE z234_before AS SELECT md5(r::text) AS h FROM daily_reports r WHERE id = '23400000-0000-0000-0000-0000000c0001';
SELECT set_config('request.jwt.claims', '{"sub":"23400000-0000-0000-0000-000000000101","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE r jsonb; n int;
BEGIN
  -- 1a. single payment path (record_booking_payment): the remaining 600
  r := public.record_booking_payment('23400000-0000-0000-0000-0000000b0001', '[{"amount":600,"payment_mode":"Cash"}]'::jsonb, gen_random_uuid(), NULL);
  ASSERT (SELECT payment_status FROM bookings WHERE id = '23400000-0000-0000-0000-0000000b0001') = 'paid', 'balance collected on a closed-day booking (single path)';
  ASSERT (SELECT created_at::date FROM payments WHERE booking_id = '23400000-0000-0000-0000-0000000b0001' AND amount = 600) = now()::date, 'the payment lands today';
  -- 1b. group payment path (record_group_payment), booking 2 from scratch
  r := public.record_group_payment('[{"booking_id":"23400000-0000-0000-0000-0000000b0002","tenders":[{"amount":1000,"payment_mode":"Khalti"}]}]'::jsonb);
  ASSERT (SELECT payment_status FROM bookings WHERE id = '23400000-0000-0000-0000-0000000b0002') = 'paid', 'balance collected on a closed-day booking (group path)';
  -- the closed day's report did not move, and the day is still locked
  ASSERT (SELECT is_locked FROM bookings WHERE id = '23400000-0000-0000-0000-0000000b0002'), 'booking stays locked';
END $$;
RESET ROLE;
-- after-close money: today's day was closed an hour ago, everything paid above (400 + 600 cash, 1000 khalti) happened after that
INSERT INTO daily_reports (branch_id, report_date, closed_by, closed_at) VALUES ('23400000-0000-0000-0000-0000000000a1', (now() AT TIME ZONE 'Asia/Kathmandu')::date, '23400000-0000-0000-0000-000000000101', now() - interval '1 hour');
SELECT set_config('request.jwt.claims', '{"sub":"23400000-0000-0000-0000-000000000101","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE d jsonb; g jsonb;
BEGIN
  d := public.get_day_money('23400000-0000-0000-0000-0000000000a1'::uuid, (now() AT TIME ZONE 'Asia/Kathmandu')::date);
  ASSERT (d->'after_close'->>'amount')::numeric = 2000 AND (d->'after_close'->>'cash')::numeric = 1000, 'collected after close 2000 (cash 1000), got ' || (d->'after_close')::text;
  -- At close / after close / now never mix: today's day was closed an hour ago, so AT CLOSE holds nothing, everything is AFTER close, and NOW = both
  ASSERT (d->'at_close'->>'taken')::numeric = 0 AND (d->'at_close'->>'refunds')::numeric = 0 AND d->'at_close'->'by_method' = '{}'::jsonb, 'nothing was taken at close, got ' || (d->'at_close')::text;
  ASSERT (d->>'taken')::numeric = (d->'at_close'->>'taken')::numeric + (d->'after_close'->>'amount')::numeric, 'now = at close + after close';
  ASSERT (d->>'cash_expected')::numeric = (d->'at_close'->>'cash_expected')::numeric + (d->'after_close'->>'cash')::numeric, 'cash now = cash at close + cash after close';
  g := public.get_dashboard(ARRAY['23400000-0000-0000-0000-0000000000a1'::uuid]);
  ASSERT g->'money'->'after_close' = d->'after_close', 'the dashboard says the same after-close money';
END $$;
RESET ROLE;
-- the other way round: closed an hour from now => all of it is AT close, none after, and now = at close
UPDATE daily_reports SET closed_at = now() + interval '1 hour' WHERE branch_id = '23400000-0000-0000-0000-0000000000a1' AND report_date = (now() AT TIME ZONE 'Asia/Kathmandu')::date;
SELECT set_config('request.jwt.claims', '{"sub":"23400000-0000-0000-0000-000000000101","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE d jsonb;
BEGIN
  d := public.get_day_money('23400000-0000-0000-0000-0000000000a1'::uuid, (now() AT TIME ZONE 'Asia/Kathmandu')::date);
  ASSERT (d->'after_close'->>'amount')::numeric = 0, 'nothing after close';
  ASSERT (d->'at_close'->>'taken')::numeric = 2000 AND (d->'at_close'->>'cash_expected')::numeric = 1000, 'all 2000 (cash 1000) is at close, got ' || (d->'at_close')::text;
  ASSERT (d->'at_close'->'by_method'->>'Khalti')::numeric = 1000, 'at-close rows carry the real method names';
  ASSERT d->'at_close'->>'taken' = d->>'taken', 'now = at close when nothing came after';
END $$;
RESET ROLE;
-- wallet / voucher / referral payment functions no longer refuse a locked booking
DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
     AND proname IN ('record_referral_wallet_payment', 'record_voucher_wallet_payment', 'record_voucher_wallet_payment_pooled', 'redeem_referral_voucher')
     AND prosrc LIKE '%this day has been closed%'), 'wallet tenders must not be refused on a closed-day booking';
END $$;
DO $$
BEGIN
  ASSERT (SELECT md5(r::text) FROM daily_reports r WHERE id = '23400000-0000-0000-0000-0000000c0001') = (SELECT h FROM z234_before), 'the closed daily_reports row is byte-identical after later payments';
  -- the flag does not leak: a later hand edit on the same booking is blocked again in the same transaction
  PERFORM 1;
END $$;
DO $$
DECLARE refused boolean;
BEGIN
  refused := false; BEGIN UPDATE bookings SET payment_status = 'unpaid' WHERE id = '23400000-0000-0000-0000-0000000b0002'; EXCEPTION WHEN OTHERS THEN refused := SQLERRM LIKE 'DAY_LOCKED%'; END;
  ASSERT refused, 'app.closed_day_payment must be off again after the payment (no leak)';
END $$;

-- 3. Close Day vs unfinished bookings (a different day: today - 3)
INSERT INTO bookings (id, branch_id, service_id, service_name_snapshot, customer_name, customer_phone, date, start_time, end_time, start_datetime, end_datetime, base_amount, final_amount, created_by, status)
VALUES ('23400000-0000-0000-0000-0000000b0003', '23400000-0000-0000-0000-0000000000a1', '23400000-0000-0000-0000-0000000f0001', 'ZZ234 Massage', 'ZZ234 c3', '9800000233',
        (now() AT TIME ZONE 'Asia/Kathmandu')::date - 3, '11:00', '12:00', now() - interval '3 days', now() - interval '71 hours', 1000, 1000, '23400000-0000-0000-0000-000000000101', 'Confirmed');
SELECT set_config('request.jwt.claims', '{"sub":"23400000-0000-0000-0000-000000000101","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE refused boolean := false; msg text; n int;
BEGIN
  SELECT count(*) INTO n FROM public.day_unfinished_bookings('23400000-0000-0000-0000-0000000000a1', (now() AT TIME ZONE 'Asia/Kathmandu')::date - 3);
  ASSERT n = 1, 'day_unfinished_bookings lists the Confirmed booking, got ' || n;
  BEGIN
    INSERT INTO daily_reports (branch_id, report_date, closed_by) VALUES ('23400000-0000-0000-0000-0000000000a1', (now() AT TIME ZONE 'Asia/Kathmandu')::date - 3, '23400000-0000-0000-0000-000000000101');
  EXCEPTION WHEN OTHERS THEN msg := SQLERRM; refused := msg LIKE 'DAY_HAS_UNFINISHED%'; END;
  ASSERT refused, 'Close Day must be refused with an unfinished booking, got: ' || COALESCE(msg, 'no error');
  ASSERT msg LIKE '%1 booking(s)%', 'the refusal says how many: ' || msg;
END $$;
RESET ROLE;
-- once it is no longer unfinished the close goes through (a Completed booking with a balance never blocked it)
UPDATE bookings SET status = 'Cancelled' WHERE id = '23400000-0000-0000-0000-0000000b0003';
DO $$
BEGIN
  INSERT INTO daily_reports (branch_id, report_date, closed_by) VALUES ('23400000-0000-0000-0000-0000000000a1', (now() AT TIME ZONE 'Asia/Kathmandu')::date - 3, '23400000-0000-0000-0000-000000000101');
  RAISE NOTICE '234 PASSED';
END $$;
ROLLBACK;
