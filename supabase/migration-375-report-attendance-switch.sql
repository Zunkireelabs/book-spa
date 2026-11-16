-- Migration 375: Therapist performance report follows the branch "Expect check-in" switch (ZNLY-183), replaces _rtp_period (mig 373).
--
-- Attendance % (att_present / att_days) now uses ONE rule everywhere: the report, the Overview bar and the inner page's Attendance tab.
--  * Day set = the therapist's rostered days (therapist_shifts_for_range, works and net minutes > 0, source <> 'none') that have HAPPENED:
--    up to yesterday (Nepal), plus today only when it is marked.
--  * A day with an attendance row is known: present when Present / 1st-Half Day / 2nd-Half Day, else (Absent, leave, day off) not present.
--  * A day with NO row: branches.expect_check_in = false (mig 364 default) -> counts as present ("no check-in"); = true -> unknown, left out.
--  * So att_days = known days, att_present = present days. The switch is read per branch asked for.
-- Everything else in _rtp_period is unchanged from mig 373. STABLE SECURITY DEFINER, read-only. Idempotent.
-- Applied: stage - / prod -.

BEGIN;

CREATE OR REPLACE FUNCTION public._rtp_period(p_org uuid, p_ids uuid[], p_from date, p_to date, p_weeks boolean)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
WITH
d AS (SELECT (p_to + 1)::timestamp AT TIME ZONE 'Asia/Kathmandu' AS d1),
-- the delivered bookings of the period and what each is worth (same value as Business health's services delivered)
bk AS (
  SELECT b.id, b.date, b.status::text AS st,
         COALESCE(b.customer_id::text, NULLIF(b.customer_phone, '')) AS ck,
         COALESCE(NULLIF(b.service_name_snapshot, ''), 'Other') AS svc,
         CASE WHEN b.status::text = 'Completed'
              THEN b.final_amount - COALESCE((SELECT sum(rf.amount) FROM public.payment_refunds rf WHERE rf.booking_id = b.id AND rf.created_at < d.d1), 0)
              ELSE COALESCE((SELECT sum(p.amount) FROM public.payments p WHERE p.booking_id = b.id AND p.created_at < d.d1), 0) END AS val
    FROM public.bookings b CROSS JOIN d
   WHERE b.branch_id = ANY (p_ids) AND b.date >= p_from AND b.date <= p_to AND b.status::text IN ('Completed', 'No Show')
),
-- every not Cancelled booking of the period with the therapists on it and each one's equal share
nb AS (
  SELECT b.id AS booking_id, b.status::text AS st, b.date AS dt, b.end_time AS et, w.therapist_id, 1.0 / count(*) OVER (PARTITION BY b.id) AS w8
    FROM public.bookings b
    CROSS JOIN LATERAL (
      SELECT t.therapist_id FROM public.booking_therapists t WHERE t.booking_id = b.id
      UNION
      SELECT b.therapist_id WHERE b.therapist_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.booking_therapists t2 WHERE t2.booking_id = b.id)
    ) w
   WHERE b.branch_id = ANY (p_ids) AND b.date >= p_from AND b.date <= p_to AND b.status::text <> 'Cancelled'
),
sv AS (  -- served = Completed
  SELECT nb.therapist_id, nb.booking_id, bk.date, bk.ck, bk.svc
    FROM nb JOIN bk ON bk.id = nb.booking_id WHERE bk.st = 'Completed'
),
sales AS (SELECT nb.therapist_id, sum(bk.val * nb.w8) AS s FROM nb JOIN bk ON bk.id = nb.booking_id GROUP BY 1),
weeks AS (SELECT g::date AS wstart FROM generate_series(date_trunc('week', p_from::timestamp), p_to::timestamp, interval '7 days') g),
wk AS (
  SELECT nb.therapist_id, date_trunc('week', bk.date::timestamp)::date AS wstart, sum(bk.val * nb.w8) AS s
    FROM nb JOIN bk ON bk.id = nb.booking_id WHERE p_weeks GROUP BY 1, 2
),
cnt AS (
  SELECT nb.therapist_id, count(*) AS bookings, count(*) FILTER (WHERE nb.st = 'No Show') AS no_show, count(*) FILTER (WHERE nb.st = 'Completed') AS completed,
         count(*) FILTER (WHERE nb.st <> 'No Show' AND (nb.dt::timestamp + COALESCE(nb.et, time '23:59:59')) <= (now() AT TIME ZONE 'Asia/Kathmandu')) AS due
    FROM nb GROUP BY 1
),
cu AS (
  SELECT sv.therapist_id, sv.ck,
         bool_or(EXISTS (SELECT 1 FROM public.bookings h JOIN public.branches hb ON hb.id = h.branch_id
                          WHERE hb.org_id = p_org AND h.status::text <> 'Cancelled' AND h.id <> sv.booking_id
                            AND h.date > sv.date AND h.date <= sv.date + 60
                            AND COALESCE(h.customer_id::text, NULLIF(h.customer_phone, '')) = sv.ck)) AS re
    FROM sv WHERE sv.ck IS NOT NULL GROUP BY 1, 2
),
cust AS (SELECT therapist_id, count(*) AS n, count(*) FILTER (WHERE re) AS r FROM cu GROUP BY 1),
tcu AS (SELECT ck, bool_or(re) AS re FROM cu GROUP BY 1),
ts AS (
  SELECT q.therapist_id, jsonb_agg(jsonb_build_object('name', q.svc, 'n', q.n) ORDER BY q.n DESC, q.svc) FILTER (WHERE q.rk <= 3) AS top
    FROM (SELECT sv.therapist_id, sv.svc, count(*) AS n,
                 row_number() OVER (PARTITION BY sv.therapist_id ORDER BY count(*) DESC, sv.svc) AS rk
            FROM sv GROUP BY sv.therapist_id, sv.svc) q
   GROUP BY q.therapist_id
),
bkd AS (
  SELECT t.therapist_id, COALESCE(sum((EXTRACT(EPOCH FROM COALESCE(t.end_time, b.end_time) - COALESCE(t.start_time, b.start_time)) / 60)::int), 0)::int AS m
    FROM public.booking_therapists t JOIN public.bookings b ON b.id = t.booking_id
   WHERE b.branch_id = ANY (p_ids) AND b.date >= p_from AND b.date <= p_to AND b.status NOT IN ('Cancelled', 'No Show')
   GROUP BY 1
),
-- ONE roster read for the period (therapist_shifts_for_range is the expensive part), shared by wrk (working minutes) and att (attendance).
-- net = end - start - breaks - off; only real shifts (works, times, source <> 'none') with net > 0 are kept.
sh AS MATERIALIZED (
  SELECT s.therapist_id, s.shift_date, br.expect_check_in AS expect, st.is_service_staff IS NOT FALSE AS service,
         GREATEST(0, (EXTRACT(EPOCH FROM s.end_time - s.start_time) / 60)::int
           - COALESCE((SELECT sum((y->>'end_min')::int - (y->>'start_min')::int) FROM jsonb_array_elements(s.breaks) y), 0)
           - COALESCE((SELECT sum((y->>'end_min')::int - (y->>'start_min')::int) FROM jsonb_array_elements(s.off) y), 0)) AS net
    FROM unnest(p_ids) bid
         JOIN public.branches br ON br.id = bid
         CROSS JOIN LATERAL public.therapist_shifts_for_range(bid, p_from, p_to) s
         JOIN public.therapists st ON st.id = s.therapist_id
   WHERE s.works AND s.start_time IS NOT NULL AND s.source IS DISTINCT FROM 'none'
),
wrk AS (
  SELECT therapist_id, COALESCE(sum(net), 0)::int AS m FROM sh WHERE service GROUP BY 1
),
att AS (  -- attendance, the SAME rule as the inner page's Attendance tab (ZNLY-183): known days over the rostered days that have happened
  SELECT x.therapist_id,
         count(*) FILTER (WHERE x.has_row OR NOT x.expect)::int AS days,
         count(*) FILTER (WHERE (x.has_row AND x.st IN ('Present', '1st-Half Day', '2nd-Half Day')) OR (NOT x.has_row AND NOT x.expect))::int AS present
    FROM (
      SELECT sh.therapist_id, sh.expect, a.status::text AS st, (a.date IS NOT NULL) AS has_row
        FROM sh
             LEFT JOIN LATERAL (SELECT a2.date, a2.status FROM public.therapist_attendance a2 WHERE a2.therapist_id = sh.therapist_id AND a2.date = sh.shift_date LIMIT 1) a ON true
       WHERE sh.net > 0
         AND (sh.shift_date < (now() AT TIME ZONE 'Asia/Kathmandu')::date OR (sh.shift_date = (now() AT TIME ZONE 'Asia/Kathmandu')::date AND a.date IS NOT NULL))
    ) x GROUP BY 1
),
who AS (SELECT therapist_id FROM cnt UNION SELECT therapist_id FROM wrk WHERE m > 0),
rws AS (
  SELECT t.id AS tid, t.name, t.branch_id, br.name AS branch_name,
         COALESCE(sales.s, 0) AS service_sales, COALESCE(cnt.completed, 0) AS completed, COALESCE(cnt.bookings, 0) AS bookings, COALESCE(cnt.no_show, 0) AS no_show, COALESCE(cnt.due, 0) AS due,
         COALESCE(cust.n, 0) AS customers, COALESCE(cust.r, 0) AS rebooked,
         COALESCE(bkd.m, 0) AS booked_min, COALESCE(wrk.m, 0) AS working_min,
         COALESCE(att.days, 0) AS att_days, COALESCE(att.present, 0) AS att_present, COALESCE(ts.top, '[]'::jsonb) AS top
    FROM who
    JOIN public.therapists t ON t.id = who.therapist_id AND t.org_id = p_org
    JOIN public.branches br ON br.id = t.branch_id
    LEFT JOIN sales ON sales.therapist_id = t.id LEFT JOIN cnt ON cnt.therapist_id = t.id LEFT JOIN cust ON cust.therapist_id = t.id
    LEFT JOIN bkd ON bkd.therapist_id = t.id LEFT JOIN wrk ON wrk.therapist_id = t.id LEFT JOIN att ON att.therapist_id = t.id LEFT JOIN ts ON ts.therapist_id = t.id
),
bc AS (
  SELECT count(*) FILTER (WHERE b.status::text <> 'Cancelled') AS active, count(*) FILTER (WHERE b.status::text = 'No Show') AS ns,
         count(*) FILTER (WHERE b.status::text = 'Completed') AS comp
    FROM public.bookings b WHERE b.branch_id = ANY (p_ids) AND b.date >= p_from AND b.date <= p_to
)
SELECT jsonb_build_object(
  'therapists', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'therapist_id', r.tid, 'name', r.name, 'branch_id', r.branch_id, 'branch_name', r.branch_name,
      'service_sales', r.service_sales, 'completed', r.completed, 'bookings', r.bookings, 'no_show', r.no_show, 'due', r.due,
      'avg_ticket', CASE WHEN r.completed > 0 THEN round(r.service_sales / r.completed, 2) END,
      'customers', r.customers, 'rebooked', r.rebooked,
      'rebook_rate', CASE WHEN r.customers >= 5 THEN round(r.rebooked::numeric / r.customers, 3) END,
      'booked_min', r.booked_min, 'working_min', r.working_min,
      'busy', CASE WHEN r.working_min > 0 THEN round(r.booked_min::numeric / r.working_min, 3) END,
      'att_days', r.att_days, 'att_present', r.att_present, 'top_services', r.top,
      'sales_by_week', CASE WHEN p_weeks THEN (SELECT COALESCE(jsonb_agg(COALESCE(wk.s, 0) ORDER BY w.wstart), '[]'::jsonb)
                                                  FROM weeks w LEFT JOIN wk ON wk.wstart = w.wstart AND wk.therapist_id = r.tid) END
    ) ORDER BY r.name, r.tid) FROM rws r), '[]'::jsonb),
  'team', jsonb_build_object(
    'active', (SELECT count(*) FROM rws),
    'service_sales', (SELECT COALESCE(sum(val), 0) FROM bk),
    'completed', (SELECT comp FROM bc), 'bookings', (SELECT active FROM bc), 'no_show', (SELECT ns FROM bc),
    'avg_ticket', (SELECT CASE WHEN comp > 0 THEN round((SELECT COALESCE(sum(val), 0) FROM bk) / comp, 2) END FROM bc),
    'booked_min', (SELECT COALESCE(sum(m), 0) FROM bkd), 'working_min', (SELECT COALESCE(sum(m), 0) FROM wrk),
    'busy', (SELECT CASE WHEN sum(m) > 0 THEN round((SELECT COALESCE(sum(m), 0) FROM bkd)::numeric / sum(m), 3) END FROM wrk),
    'customers', (SELECT count(*) FROM tcu), 'rebooked', (SELECT count(*) FILTER (WHERE re) FROM tcu),
    'rebook_rate', (SELECT CASE WHEN count(*) >= 5 THEN round(count(*) FILTER (WHERE re)::numeric / count(*), 3) END FROM tcu),
    'att_days', (SELECT COALESCE(sum(att_days), 0) FROM rws), 'att_present', (SELECT COALESCE(sum(att_present), 0) FROM rws)));
$fn$;

REVOKE ALL ON FUNCTION public._rtp_period(uuid, uuid[], date, date, boolean) FROM PUBLIC, anon, authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('375', 'report-attendance-switch')
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
