-- Migration 439 (ZNLY-444): the customer tiles disagreed. "Upcoming" money counted every Pending/Confirmed booking dated today or
-- later, but "next booking" also needed its start time to still be ahead, so a booking today whose time had passed (not yet
-- Completed) showed NPR 448 with "Nothing booked".
-- One rule: a Pending/Confirmed booking dated today or later is upcoming (amount, deposit and next booking agree);
-- a Completed/In-Progress booking dated today or earlier is a visit; Pending/Confirmed before today is "unclosed".
-- Only change vs migration 419: the nextv CTE (date >= today). Mirrors src/utils/customerDirectory.js.
-- Reversible: re-run customer_directory_rows from migration 419.
BEGIN;

CREATE OR REPLACE FUNCTION public.customer_directory_rows(p_today date DEFAULT NULL, p_now_hm text DEFAULT NULL, p_with_members boolean DEFAULT true)
RETURNS TABLE (
  id uuid, full_name text, phone text, email text, gender text, created_at timestamp,
  completed_visits integer, last_date date, last_service text, last_therapist text,
  next_date date, next_time text, next_service text, next_therapist text,
  in_spa boolean, spent numeric, balance numeric, unpaid_visits integer, locked_due numeric,
  upcoming numeric, deposit numeric, credit numeric, stale jsonb, unclosed jsonb, legacy_balance numeric,
  usual_therapist text, usual_therapist_visits integer, favourite_service text,
  vip boolean, member boolean, segment text, therapist_ids uuid[], services text[]
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' SET work_mem TO '64MB' AS $$
WITH p AS (
  SELECT coalesce(p_today, (now() AT TIME ZONE 'Asia/Kathmandu')::date) AS today,
         coalesce(p_now_hm, to_char(now() AT TIME ZONE 'Asia/Kathmandu', 'HH24:MI')) AS hm
), org_branches AS (
  SELECT b.id FROM branches b WHERE b.org_id = get_user_org_id()
), bk AS (
  -- one row per booking, money in integer paisa (Math.round(x*100) in the JS); paid = payments - refunds, never below 0
  SELECT b.id, b.customer_id, b.status::text AS status, b.payment_status, b.date, coalesce(to_char(b.start_time, 'HH24:MI'), '') AS t,
         coalesce(b.service_name_snapshot, '') AS service, b.therapist_id, coalesce(b.therapist_name_snapshot, '') AS therapist,
         coalesce(b.is_locked, false) AS is_locked,
         round(coalesce(b.final_amount, 0) * 100)::bigint AS price,
         greatest(coalesce(pay.g, 0) - coalesce(ref.r, 0), 0) AS paid,
         coalesce(pay.g, 0) AS gross
  FROM bookings b
  LEFT JOIN (SELECT pm.booking_id, sum(round(pm.amount * 100))::bigint AS g FROM payments pm GROUP BY pm.booking_id) pay ON pay.booking_id = b.id
  LEFT JOIN (SELECT rf.booking_id, sum(round(rf.amount * 100))::bigint AS r FROM payment_refunds rf GROUP BY rf.booking_id) ref ON ref.booking_id = b.id
  WHERE b.customer_id IS NOT NULL AND b.branch_id IN (SELECT ob.id FROM org_branches ob)
), cl AS (
  -- classifyBooking(): void / rendered / scheduled / unclosed
  SELECT bk.*, p.today, p.hm,
    (bk.status IN ('Completed', 'In-Progress')) AS is_rendered,
    CASE WHEN bk.status IN ('Completed', 'In-Progress') THEN greatest(bk.price - bk.paid, 0) ELSE 0 END AS due,
    CASE WHEN bk.status IN ('Cancelled', 'No Show') THEN bk.paid
         WHEN bk.status IN ('Completed', 'In-Progress') THEN greatest(bk.paid - bk.price, 0)
         WHEN bk.status IN ('Pending', 'Confirmed') AND bk.date >= p.today THEN greatest(bk.paid - bk.price, 0)
         ELSE 0 END AS credit,
    CASE WHEN bk.status IN ('Pending', 'Confirmed') AND bk.date >= p.today THEN greatest(bk.price - bk.paid, 0) ELSE 0 END AS upcoming,
    CASE WHEN bk.status IN ('Pending', 'Confirmed') AND bk.date >= p.today THEN least(bk.paid, bk.price) ELSE 0 END AS deposit,
    (bk.status IN ('Pending', 'Confirmed') AND bk.date < p.today) AS unclosed,
    CASE WHEN bk.status IN ('Pending', 'Confirmed') AND bk.date < p.today THEN greatest(bk.price - bk.paid, 0) ELSE 0 END AS at_stake,
    (bk.status = 'In-Progress' AND bk.date < p.today) AS stale,
    -- legacyDue(): the pre-V12 rule, kept only for the Spotlight "Before" figure (gross payments, no refunds)
    CASE WHEN bk.payment_status IN ('unpaid', 'partial') AND bk.status NOT IN ('Cancelled', 'No Show')
         THEN greatest(bk.price - bk.gross, 0) ELSE 0 END AS legacy_due,
    (bk.status IN ('Completed', 'In-Progress') AND bk.date <= p.today) AS visit,
    (bk.status IN ('Pending', 'Confirmed') AND (bk.date > p.today OR (bk.date = p.today AND bk.t > p.hm))) AS upcoming_slot
  FROM bk CROSS JOIN p
), agg AS (
  SELECT cl.customer_id,
    count(*) FILTER (WHERE cl.visit)::int AS completed_visits,
    min(cl.date) FILTER (WHERE cl.visit) AS first_date,
    bool_or(cl.status = 'In-Progress' AND cl.date = cl.today AND cl.visit) AS in_spa,
    sum(cl.paid) AS spent,
    sum(cl.due) AS due,
    count(*) FILTER (WHERE cl.due > 0)::int AS unpaid_visits,
    sum(cl.due) FILTER (WHERE cl.is_locked AND cl.due > 0) AS locked_due,
    sum(cl.upcoming) AS upcoming, sum(cl.deposit) AS deposit, sum(cl.credit) AS credit,
    sum(cl.legacy_due) AS legacy_due
  FROM cl GROUP BY cl.customer_id
), flags AS (
  -- the few In-Progress-from-an-earlier-day / never-closed bookings, listed per customer (kept out of the big aggregate: cheap)
  SELECT cl.customer_id,
    coalesce(jsonb_agg(jsonb_build_object('id', cl.id, 'date', cl.date, 'service', cl.service, 'status', cl.status, 'isLocked', cl.is_locked) ORDER BY cl.id) FILTER (WHERE cl.stale), '[]'::jsonb) AS stale,
    coalesce(jsonb_agg(jsonb_build_object('id', cl.id, 'date', cl.date, 'service', cl.service, 'status', cl.status, 'atStake', cl.at_stake / 100.0, 'isLocked', cl.is_locked) ORDER BY cl.id) FILTER (WHERE cl.unclosed), '[]'::jsonb) AS unclosed
  FROM cl WHERE cl.stale OR cl.unclosed GROUP BY cl.customer_id
), ths AS (
  SELECT x.customer_id, array_agg(x.therapist_id) AS therapist_ids
  FROM (SELECT DISTINCT cl.customer_id, cl.therapist_id FROM cl WHERE cl.therapist_id IS NOT NULL AND cl.therapist <> '') x GROUP BY x.customer_id
), svs AS (
  SELECT x.customer_id, array_agg(x.service) AS services
  FROM (SELECT DISTINCT cl.customer_id, cl.service FROM cl WHERE cl.service <> '') x GROUP BY x.customer_id
), lastv AS (
  -- latest rendered visit: date, then time; an exact tie goes to the lowest booking id (the JS walks bookings in id order)
  SELECT DISTINCT ON (cl.customer_id) cl.customer_id, cl.date AS d, cl.service, cl.therapist
  FROM cl WHERE cl.visit ORDER BY cl.customer_id, cl.date DESC, cl.t DESC, cl.id
), nextv AS (
  SELECT DISTINCT ON (cl.customer_id) cl.customer_id, cl.date AS d, cl.t, cl.service, cl.therapist
  FROM cl WHERE cl.status IN ('Pending', 'Confirmed') AND cl.date >= cl.today ORDER BY cl.customer_id, cl.date, cl.t, cl.id
), tcount AS (
  -- topOf(): the most frequent value among rendered visits; a tie goes to the one seen first (lowest booking id)
  SELECT DISTINCT ON (customer_id) customer_id, name, n FROM (
    SELECT cl.customer_id, cl.therapist AS name, count(*)::int AS n, min(cl.id::text) AS first_id
    FROM cl WHERE cl.visit AND cl.therapist <> '' GROUP BY cl.customer_id, cl.therapist) x
  ORDER BY customer_id, n DESC, first_id
), scount AS (
  SELECT DISTINCT ON (customer_id) customer_id, name, n FROM (
    SELECT cl.customer_id, cl.service AS name, count(*)::int AS n, min(cl.id::text) AS first_id
    FROM cl WHERE cl.visit AND cl.service <> '' GROUP BY cl.customer_id, cl.service) x
  ORDER BY customer_id, n DESC, first_id
), mem AS (
  SELECT m.customer_id FROM list_membership_status_for_org() m WHERE p_with_members AND m.status = 'active'
), one AS (
  SELECT c.id, c.full_name, c.phone, c.email, c.gender, c.created_at,
    coalesce(a.completed_visits, 0) AS completed_visits, a.first_date,
    lv.d AS last_date, lv.service AS last_service, lv.therapist AS last_therapist,
    nv.d AS next_date, nv.t AS next_time, nv.service AS next_service, nv.therapist AS next_therapist,
    coalesce(a.in_spa, false) AS in_spa,
    coalesce(a.spent, 0) / 100.0 AS spent, coalesce(a.due, 0) / 100.0 AS balance, coalesce(a.unpaid_visits, 0) AS unpaid_visits,
    coalesce(a.locked_due, 0) / 100.0 AS locked_due, coalesce(a.upcoming, 0) / 100.0 AS upcoming,
    coalesce(a.deposit, 0) / 100.0 AS deposit, coalesce(a.credit, 0) / 100.0 AS credit,
    coalesce(fl.stale, '[]'::jsonb) AS stale, coalesce(fl.unclosed, '[]'::jsonb) AS unclosed,
    coalesce(a.legacy_due, 0) / 100.0 AS legacy_balance,
    CASE WHEN tc.n >= 2 AND tc.n::numeric / a.completed_visits >= 0.5 THEN tc.name END AS usual_therapist,
    CASE WHEN tc.n >= 2 AND tc.n::numeric / a.completed_visits >= 0.5 THEN tc.n ELSE 0 END AS usual_therapist_visits,
    CASE WHEN sc.n >= 2 AND sc.n::numeric / a.completed_visits >= 0.5 THEN sc.name END AS favourite_service,
    (c.id IN (SELECT mem.customer_id FROM mem)) AS member,
    coalesce(th.therapist_ids, '{}') AS therapist_ids, coalesce(sv.services, '{}') AS services,
    (SELECT today FROM p) AS today
  FROM customers c
  LEFT JOIN agg a ON a.customer_id = c.id
  LEFT JOIN flags fl ON fl.customer_id = c.id
  LEFT JOIN ths th ON th.customer_id = c.id
  LEFT JOIN svs sv ON sv.customer_id = c.id
  LEFT JOIN lastv lv ON lv.customer_id = c.id
  LEFT JOIN nextv nv ON nv.customer_id = c.id
  LEFT JOIN tcount tc ON tc.customer_id = c.id
  LEFT JOIN scount sc ON sc.customer_id = c.id
  WHERE c.org_id = get_user_org_id()
)
SELECT o.id, o.full_name, o.phone, o.email, o.gender, o.created_at,
  o.completed_visits, o.last_date, o.last_service, o.last_therapist,
  o.next_date, o.next_time, o.next_service, o.next_therapist,
  o.in_spa, o.spent, o.balance, o.unpaid_visits, o.locked_due, o.upcoming, o.deposit, o.credit, o.stale, o.unclosed, o.legacy_balance,
  o.usual_therapist, o.usual_therapist_visits, o.favourite_service,
  (o.completed_visits >= 8 AND o.spent >= 25000) AS vip,
  o.member,
  -- lifecycleSegment(): new -> lapsed -> at-risk -> regular -> occasional
  CASE
    WHEN o.completed_visits = 0 OR (o.first_date IS NOT NULL AND o.today - o.first_date <= 30) THEN 'new'
    WHEN o.last_date IS NOT NULL AND o.today - o.last_date > 180 AND o.next_date IS NULL THEN 'lapsed'
    WHEN o.completed_visits >= 2 AND o.last_date IS NOT NULL AND o.today - o.last_date > 60 AND o.next_date IS NULL THEN 'at-risk'
    WHEN o.completed_visits >= 4 THEN 'regular'
    ELSE 'occasional'
  END AS segment,
  o.therapist_ids, o.services
FROM one o;
$$;

GRANT EXECUTE ON FUNCTION public.customer_directory_rows(date, text, boolean) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('439', 'customer-tiles-one-upcoming-rule')
ON CONFLICT (version) DO NOTHING;

COMMIT;
