-- LOCAL ONLY (never run against staging/production): seeds a large, varied Customers dataset into the local "smoke" org so the
-- customer_directory_* RPCs can be timed and parity-checked (scripts/customer-directory-parity.mjs).
-- Rows are tagged (customers.tags = '{perf-seed}', bookings.notes-free: identified through those customers) and removed by
--   DELETE FROM payment_refunds WHERE booking_id IN (SELECT b.id FROM bookings b JOIN customers c ON c.id=b.customer_id WHERE 'perf-seed'=ANY(c.tags));
--   DELETE FROM payments        WHERE booking_id IN (SELECT b.id FROM bookings b JOIN customers c ON c.id=b.customer_id WHERE 'perf-seed'=ANY(c.tags));
--   DELETE FROM bookings WHERE customer_id IN (SELECT id FROM customers WHERE 'perf-seed'=ANY(tags));
--   DELETE FROM customers WHERE 'perf-seed'=ANY(tags);
-- Usage: psql ... -v customers=6000 -v bookings=60000 -f scripts/seed-customer-directory-perf.sql
\set ON_ERROR_STOP on
\if :{?customers} \else \set customers 6000 \endif
\if :{?bookings} \else \set bookings 60000 \endif

BEGIN;
SET LOCAL session_replication_role = replica;   -- skip the booking triggers (we set the computed columns ourselves)
SELECT setseed(0.42);

-- customers: ~5% "walk in N" placeholders, the rest named; phones unique
INSERT INTO customers (id, branch_id, full_name, phone, org_id, tags, created_at)
SELECT gen_random_uuid(), 'b0000000-0000-0000-0000-000000000001',
       CASE WHEN g % 20 = 0 THEN 'walk in ' || g ELSE 'Perf Customer ' || g END,
       '98' || lpad((10000000 + g)::text, 8, '0'),
       '00000000-0000-0000-0000-000000000001', '{perf-seed}', now() - (random() * 500 || ' days')::interval
FROM generate_series(1, :customers) g;

CREATE TEMP TABLE _c AS SELECT row_number() OVER (ORDER BY id) AS n, id, full_name, phone FROM customers WHERE 'perf-seed' = ANY(tags);
CREATE TEMP TABLE _t AS SELECT row_number() OVER (ORDER BY id) - 1 AS n, id, name FROM therapists WHERE branch_id = 'b0000000-0000-0000-0000-000000000001';
CREATE TEMP TABLE _s AS SELECT row_number() OVER (ORDER BY id) - 1 AS n, id, name, duration_minutes, price_npr FROM services WHERE org_id = '00000000-0000-0000-0000-000000000001';

-- ~1 in 7 bookings go to the org's second branch, so staff (own branch only) and admin see different totals through RLS
-- bookings: skewed towards a minority of busy customers; 30% have a therapist (unique slot so the overlap guard holds)
CREATE TEMP TABLE _b AS
WITH raw AS (
  SELECT g,
         1 + floor(:customers * power(random(), 2.2))::int AS cn,
         random() AS r_status, random() AS r_pay, random() AS r_lock, random() AS r_disc, random() AS r_t,
         (SELECT count(*) FROM _t) AS tn, (SELECT count(*) FROM _s) AS sn
  FROM generate_series(1, :bookings) g
), slot AS (
  SELECT raw.*, (r_t < 0.3) AS has_t, row_number() OVER (PARTITION BY (r_t < 0.3) ORDER BY g) - 1 AS k FROM raw
)
SELECT g, cn, r_status, r_pay, r_lock, r_disc, tn, sn, has_t, k,
  CASE WHEN has_t THEN (current_date - 400 + (((k / (tn * 8)) % 430))::int)
       ELSE (current_date - 400 + floor(random() * 435)::int) END AS d,
  CASE WHEN has_t THEN make_time(9 + ((k / tn) % 8)::int, 0, 0) ELSE make_time(8 + floor(random() * 10)::int, (floor(random() * 4) * 15)::int, 0) END AS st
FROM slot;

INSERT INTO bookings (id, branch_id, service_id, therapist_id, room_id, customer_id, customer_name, customer_phone, date, start_time, end_time,
                      start_datetime, end_datetime, status, payment_status, base_amount, discount_amount, final_amount,
                      service_name_snapshot, service_duration_snapshot, service_price_snapshot, therapist_name_snapshot, is_locked, is_walk_in)
SELECT gen_random_uuid(), CASE WHEN b.g % 7 = 0 THEN 'f495ef5b-b8a7-470c-b81a-e022c7b27ead'::uuid ELSE 'b0000000-0000-0000-0000-000000000001'::uuid END, s.id,
       CASE WHEN b.has_t THEN t.id END, 'c0000000-0000-0000-0000-000000000001', c.id, c.full_name, c.phone,
       b.d, b.st, (b.st + interval '1 hour')::time,
       ((b.d + b.st) AT TIME ZONE 'Asia/Kathmandu'), ((b.d + b.st + interval '1 hour') AT TIME ZONE 'Asia/Kathmandu'),
       st.status::booking_status, 'unpaid',
       s.price_npr, round(s.price_npr * CASE WHEN b.r_disc < 0.15 THEN 0.10 ELSE 0 END, 2),
       s.price_npr - round(s.price_npr * CASE WHEN b.r_disc < 0.15 THEN 0.10 ELSE 0 END, 2),
       s.name, s.duration_minutes, s.price_npr, CASE WHEN b.has_t THEN t.name END,
       (b.d < current_date AND b.r_lock < 0.25), (c.full_name LIKE 'walk in %')
FROM _b b
JOIN _c c ON c.n = b.cn
JOIN _s s ON s.n = (b.g % b.sn)
LEFT JOIN _t t ON t.n = (b.k % b.tn)
CROSS JOIN LATERAL (SELECT CASE
    WHEN b.d > current_date THEN CASE WHEN b.r_status < 0.45 THEN 'Pending' WHEN b.r_status < 0.9 THEN 'Confirmed' ELSE 'Cancelled' END
    WHEN b.d = current_date THEN CASE WHEN b.r_status < 0.3 THEN 'In-Progress' WHEN b.r_status < 0.6 THEN 'Confirmed' WHEN b.r_status < 0.8 THEN 'Completed' ELSE 'Pending' END
    ELSE CASE WHEN b.r_status < 0.68 THEN 'Completed' WHEN b.r_status < 0.78 THEN 'Cancelled' WHEN b.r_status < 0.83 THEN 'No Show'
              WHEN b.r_status < 0.86 THEN 'In-Progress' WHEN b.r_status < 0.93 THEN 'Confirmed' ELSE 'Pending' END END AS status) st;

-- payments: most completed visits paid in full (some in two parts), some partial, some none; deposits on some scheduled/void ones
WITH pay AS (
  SELECT bk.id, bk.final_amount AS f, bk.status::text AS status, random() AS r, random() AS r2
  FROM bookings bk JOIN customers c ON c.id = bk.customer_id AND 'perf-seed' = ANY(c.tags)
)
INSERT INTO payments (booking_id, amount, payment_mode, recorded_by)
SELECT id, amt, 'cash', 'a0000000-0000-0000-0000-0000000000a1' FROM (
  SELECT id, f AS amt FROM pay WHERE status IN ('Completed', 'In-Progress') AND r < 0.62 AND r2 >= 0.2        -- paid in full
  UNION ALL SELECT id, round(f / 2, 2) FROM pay WHERE status IN ('Completed', 'In-Progress') AND r < 0.62 AND r2 < 0.2     -- two halves
  UNION ALL SELECT id, f - round(f / 2, 2) FROM pay WHERE status IN ('Completed', 'In-Progress') AND r < 0.62 AND r2 < 0.2
  UNION ALL SELECT id, round(f * 0.4, 2) FROM pay WHERE status IN ('Completed', 'In-Progress') AND r >= 0.62 AND r < 0.8  -- partial
  UNION ALL SELECT id, round(f * 0.3, 2) FROM pay WHERE status IN ('Pending', 'Confirmed') AND r < 0.25                    -- deposit
  UNION ALL SELECT id, f + 50 FROM pay WHERE status = 'Completed' AND r > 0.985                                            -- overpaid
  UNION ALL SELECT id, round(f * 0.5, 2) FROM pay WHERE status IN ('Cancelled', 'No Show') AND r < 0.3                      -- void, money held
) u;

UPDATE bookings bk SET payment_status = CASE
    WHEN p.s >= bk.final_amount THEN 'paid' WHEN p.s > 0 THEN 'partial' ELSE 'unpaid' END
FROM (SELECT booking_id, sum(amount) AS s FROM payments GROUP BY 1) p
WHERE p.booking_id = bk.id AND bk.customer_id IN (SELECT id FROM customers WHERE 'perf-seed' = ANY(tags));

-- refunds on ~4% of paid bookings (some exceed what was paid to exercise the never-below-zero rule)
INSERT INTO payment_refunds (booking_id, org_id, amount, reason)
SELECT p.booking_id, '00000000-0000-0000-0000-000000000001',
       CASE WHEN random() < 0.1 THEN p.s + 100 ELSE round(p.s * 0.5, 2) END, 'perf-seed'
FROM (SELECT booking_id, sum(amount) AS s FROM payments GROUP BY 1) p
JOIN bookings bk ON bk.id = p.booking_id
WHERE bk.customer_id IN (SELECT id FROM customers WHERE 'perf-seed' = ANY(tags)) AND random() < 0.04;

COMMIT;
ANALYZE customers; ANALYZE bookings; ANALYZE payments; ANALYZE payment_refunds;
SELECT (SELECT count(*) FROM customers) AS customers, (SELECT count(*) FROM bookings) AS bookings,
       (SELECT count(*) FROM payments) AS payments, (SELECT count(*) FROM payment_refunds) AS refunds;
