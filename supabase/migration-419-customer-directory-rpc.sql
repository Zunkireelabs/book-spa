-- Migration 419: server-side Customers directory (perf: the page used to download every customer and every booking of the org).
--
-- No new index: the aggregation reads every visible booking once (hash joins), so it does not use a (customer_id, date) index;
-- prod already has idx_bookings_customer_id for per-customer lookups.
--
-- customer_directory_rows(p_today, p_now_hm)  one row per customer of the caller's org with every figure the Customers list shows
-- customer_directory_page(...)                filter + search + sort + ONE page of those rows, plus the filtered total
-- customer_directory_summary(...)             tab counts, lifecycle mix, Spotlight inputs, filter options (org-wide, no paging)
--
-- KEEP IN SYNC WITH src/utils/bookingMoney.js (classifyBooking / summarizeMoney) and src/utils/customerDirectory.js
-- (buildCustomerDirectory, lifecycleSegment, matchesSearch, phoneSearchDigits). The JS stays the reference for the booking
-- panel / profile; scripts/customer-directory-parity.mjs compares the two on the same data and must pass after any change here.
--
-- SECURITY INVOKER: every table read goes through the caller's RLS exactly like the old browser fetch did (staff see their
-- branch's bookings, admin/viewer the whole org, restricted staff no money rows). The org comes from get_user_org_id().
-- Membership status uses the existing staff-safe DEFINER RPC (migration 087), as before.
--
-- Time: "today" and "now" are the spa's Nepal wall clock, taken on the server. The two params are optional overrides for tests.
--
-- Reversible:
--   DROP FUNCTION IF EXISTS public.customer_directory_summary(date, text, boolean);
--   DROP FUNCTION IF EXISTS public.customer_directory_page(date, text, text, text, text, boolean, uuid, text, text, text, text, integer, integer, uuid, boolean);
--   DROP FUNCTION IF EXISTS public.customer_directory_rows(date, text, boolean);
--   DROP FUNCTION IF EXISTS public._cd_phone_digits(text);
--   DROP COLLATION IF EXISTS public.cd_name_order;
BEGIN;

-- Name order = JS localeCompare(a, b, undefined, { sensitivity: 'base' }): case- and accent-insensitive.
CREATE COLLATION IF NOT EXISTS public.cd_name_order (provider = icu, locale = 'en-US-u-ks-level1', deterministic = false);

-- "+977 984-12" and "98412" both match: digits only, minus a leading 977 (when longer than 3) and leading zeros.
CREATE OR REPLACE FUNCTION public._cd_phone_digits(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(
    CASE WHEN d LIKE '977%' AND length(d) > 3 THEN substr(d, 4) ELSE d END,
    '^0+', '')
  FROM (SELECT regexp_replace(coalesce(p, ''), '\D', '', 'g') AS d) s;
$$;

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
  FROM cl WHERE cl.upcoming_slot ORDER BY cl.customer_id, cl.date, cl.t, cl.id
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

CREATE OR REPLACE FUNCTION public.customer_directory_page(
  p_today date DEFAULT NULL, p_now_hm text DEFAULT NULL,
  p_search text DEFAULT NULL, p_tab text DEFAULT 'all', p_segment text DEFAULT NULL, p_no_member boolean DEFAULT false,
  p_therapist uuid DEFAULT NULL, p_service text DEFAULT NULL, p_last text DEFAULT NULL,
  p_sort text DEFAULT 'next', p_dir text DEFAULT NULL, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0,
  p_only_id uuid DEFAULT NULL, p_with_members boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' SET work_mem TO '64MB' AS $$
WITH p AS (
  SELECT coalesce(p_today, (now() AT TIME ZONE 'Asia/Kathmandu')::date) AS today,
         coalesce(p_now_hm, to_char(now() AT TIME ZONE 'Asia/Kathmandu', 'HH24:MI')) AS hm,
         lower(btrim(coalesce(p_search, ''))) AS q
), r AS (
  SELECT r.*, p.today, p.q FROM customer_directory_rows((SELECT today FROM p), (SELECT hm FROM p), p_with_members) r CROSS JOIN p
), f AS (
  SELECT r.*,
    -- direction: the caller's, else the column's default (SORTS in utils/customerDirectory.js)
    coalesce(p_dir, CASE WHEN p_sort IN ('next', 'name') THEN 'asc' ELSE 'desc' END) AS dir
  FROM r
  WHERE (p_only_id IS NOT NULL AND r.id = p_only_id)
     OR (p_only_id IS NULL
      AND CASE coalesce(p_tab, 'all')
            WHEN 'in-spa' THEN r.in_spa WHEN 'upcoming' THEN r.next_date IS NOT NULL WHEN 'owes' THEN r.balance > 0
            WHEN 'members' THEN r.member WHEN 'vip' THEN (r.completed_visits >= 8 AND r.spent >= 25000) ELSE true END
      AND (p_segment IS NULL OR r.segment = p_segment)
      AND (NOT coalesce(p_no_member, false) OR NOT r.member)
      AND (p_therapist IS NULL OR p_therapist = ANY (r.therapist_ids))
      AND (p_service IS NULL OR p_service = ANY (r.services))
      AND (p_last IS NULL OR p_last = '' OR CASE p_last
            WHEN '30' THEN r.last_date IS NOT NULL AND r.today - r.last_date <= 30
            WHEN '90' THEN r.last_date IS NOT NULL AND r.today - r.last_date <= 90
            WHEN '180' THEN r.last_date IS NOT NULL AND r.today - r.last_date <= 180
            WHEN 'old' THEN r.last_date IS NOT NULL AND r.today - r.last_date > 180
            WHEN 'never' THEN r.last_date IS NULL ELSE true END)
      -- matchesSearch(): name or email contains the text; or, for a phone-looking query, the phone digits contain its digits
      AND (r.q = '' OR strpos(lower(coalesce(r.full_name, '')), r.q) > 0 OR strpos(lower(coalesce(r.email, '')), r.q) > 0
           OR (r.q ~ '^[0-9[:space:]+()-]+$' AND public._cd_phone_digits(r.q) <> ''
               AND strpos(public._cd_phone_digits(r.phone), public._cd_phone_digits(r.q)) > 0)))
), total AS (SELECT count(*)::int AS n FROM f), ranked AS (
  -- missing dates always sort last (either direction); ties fall back to name, then id so offset paging is stable
  SELECT f.*, row_number() OVER (ORDER BY
    CASE WHEN f.dir = 'asc' AND p_sort = 'next' THEN f.next_date::text || ' ' || f.next_time
         WHEN f.dir = 'asc' AND p_sort = 'last' THEN f.last_date::text END ASC NULLS LAST,
    CASE WHEN f.dir = 'desc' AND p_sort = 'next' THEN f.next_date::text || ' ' || f.next_time
         WHEN f.dir = 'desc' AND p_sort = 'last' THEN f.last_date::text END DESC NULLS LAST,
    CASE WHEN f.dir = 'asc' AND p_sort = 'spent' THEN f.spent WHEN f.dir = 'asc' AND p_sort = 'balance' THEN f.balance
         WHEN f.dir = 'asc' AND p_sort = 'visits' THEN f.completed_visits END ASC,
    CASE WHEN f.dir = 'desc' AND p_sort = 'spent' THEN f.spent WHEN f.dir = 'desc' AND p_sort = 'balance' THEN f.balance
         WHEN f.dir = 'desc' AND p_sort = 'visits' THEN f.completed_visits END DESC,
    CASE WHEN f.dir = 'desc' AND p_sort = 'name' THEN coalesce(f.full_name, '') END COLLATE public.cd_name_order DESC,
    coalesce(f.full_name, '') COLLATE public.cd_name_order ASC, f.id) AS rn
  FROM f
), pg AS (
  SELECT * FROM ranked ORDER BY rn
  LIMIT greatest(least(coalesce(p_limit, 25), 500), 1) OFFSET greatest(coalesce(p_offset, 0), 0)
)
SELECT jsonb_build_object(
  'today', (SELECT today FROM p), 'nowHM', (SELECT hm FROM p), 'total', (SELECT n FROM total),
  'rows', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', pg.id, 'fullName', coalesce(pg.full_name, ''), 'phone', coalesce(pg.phone, ''), 'email', coalesce(pg.email, ''),
      'gender', coalesce(pg.gender, ''), 'createdAt', pg.created_at, 'completedVisits', pg.completed_visits,
      'lastVisit', CASE WHEN pg.last_date IS NULL THEN NULL ELSE jsonb_build_object('date', pg.last_date, 'service', pg.last_service, 'therapist', pg.last_therapist) END,
      'nextBooking', CASE WHEN pg.next_date IS NULL THEN NULL ELSE jsonb_build_object('date', pg.next_date, 'time', pg.next_time, 'service', pg.next_service, 'therapist', pg.next_therapist) END,
      'inSpa', pg.in_spa, 'spent', pg.spent, 'balance', pg.balance, 'unpaidVisits', pg.unpaid_visits, 'lockedDue', pg.locked_due,
      'upcoming', pg.upcoming, 'deposit', pg.deposit, 'credit', pg.credit, 'stale', pg.stale, 'unclosed', pg.unclosed,
      'legacyBalance', pg.legacy_balance, 'usualTherapist', pg.usual_therapist, 'usualTherapistVisits', pg.usual_therapist_visits,
      'favouriteService', pg.favourite_service, 'vip', (pg.completed_visits >= 8 AND pg.spent >= 25000), 'member', pg.member,
      'segment', pg.segment, 'therapistIds', to_jsonb(pg.therapist_ids), 'services', to_jsonb(pg.services)) ORDER BY pg.rn) FROM pg), '[]'::jsonb)
);
$$;

CREATE OR REPLACE FUNCTION public.customer_directory_summary(p_today date DEFAULT NULL, p_now_hm text DEFAULT NULL, p_with_members boolean DEFAULT true)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' SET work_mem TO '64MB' AS $$
WITH p AS (
  SELECT coalesce(p_today, (now() AT TIME ZONE 'Asia/Kathmandu')::date) AS today,
         coalesce(p_now_hm, to_char(now() AT TIME ZONE 'Asia/Kathmandu', 'HH24:MI')) AS hm
), r AS (SELECT * FROM customer_directory_rows((SELECT today FROM p), (SELECT hm FROM p), p_with_members)),
top_risk AS (
  SELECT * FROM r WHERE segment = 'at-risk' ORDER BY spent DESC, id LIMIT 1
), th AS (
  -- therapist options: one name per id (the first by booking id), sorted by name
  SELECT DISTINCT ON (b.therapist_id) b.therapist_id AS id, b.therapist_name_snapshot AS name
  FROM bookings b
  WHERE b.customer_id IS NOT NULL AND b.therapist_id IS NOT NULL AND coalesce(b.therapist_name_snapshot, '') <> ''
    AND b.branch_id IN (SELECT br.id FROM branches br WHERE br.org_id = get_user_org_id())
  ORDER BY b.therapist_id, b.id
)
SELECT jsonb_build_object(
  'today', (SELECT today FROM p),
  'tabs', jsonb_build_object(
    'all', (SELECT count(*) FROM r), 'in-spa', (SELECT count(*) FROM r WHERE in_spa), 'upcoming', (SELECT count(*) FROM r WHERE next_date IS NOT NULL),
    'owes', (SELECT count(*) FROM r WHERE balance > 0), 'members', (SELECT count(*) FROM r WHERE member),
    'vip', (SELECT count(*) FROM r WHERE completed_visits >= 8 AND spent >= 25000)),
  'mix', jsonb_build_object(
    'new', (SELECT count(*) FROM r WHERE segment = 'new'), 'regular', (SELECT count(*) FROM r WHERE segment = 'regular'),
    'occasional', (SELECT count(*) FROM r WHERE segment = 'occasional'), 'at-risk', (SELECT count(*) FROM r WHERE segment = 'at-risk'),
    'lapsed', (SELECT count(*) FROM r WHERE segment = 'lapsed')),
  'spotlight', jsonb_build_object(
    'atRiskCount', (SELECT count(*) FROM r WHERE segment = 'at-risk'),
    'atRiskTop', (SELECT jsonb_build_object('fullName', coalesce(full_name, ''), 'usualTherapist', usual_therapist, 'favouriteService', favourite_service, 'spent', spent) FROM top_risk),
    'regularsNoMember', (SELECT count(*) FROM r WHERE segment = 'regular' AND NOT member),
    'before', (SELECT coalesce(sum(legacy_balance), 0) FROM r), 'now', (SELECT coalesce(sum(balance), 0) FROM r)),
  'therapists', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name) ORDER BY name COLLATE "en-US-x-icu", id) FROM th), '[]'::jsonb),
  'services', coalesce((SELECT jsonb_agg(s ORDER BY s COLLATE "C") FROM (SELECT DISTINCT unnest(services) AS s FROM r) x), '[]'::jsonb)
);
$$;

REVOKE ALL ON FUNCTION public._cd_phone_digits(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.customer_directory_rows(date, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.customer_directory_page(date, text, text, text, text, boolean, uuid, text, text, text, text, integer, integer, uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.customer_directory_summary(date, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._cd_phone_digits(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_directory_rows(date, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_directory_page(date, text, text, text, text, boolean, uuid, text, text, text, text, integer, integer, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_directory_summary(date, text, boolean) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('419', 'customer-directory-rpc')
ON CONFLICT (version) DO NOTHING;

COMMIT;
