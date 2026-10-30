-- Migration 339: get_report_therapist_performance(p_branch_ids, p_from, p_to), the numbers behind Reports > Therapist performance (ZNLY-159, V37c)
--
-- Returns one jsonb: from/to/prev_from/prev_to, weeks[] (Monday of each week in the range), current {therapists[], team}, previous {therapists[], team},
-- branches[] {branch_id, name, current {therapists[], team}} (one ranking per branch).
--  * Access = get_report_business_health (mig 337, same as get_dashboard mig 334): org-scoped; manager only their own branches; admin and
--    admin_viewer read; staff gets an error. Branches outside the caller's scope are silently dropped; none left -> {}. No session -> {}.
--  * Dates are Nepal days (d1 = start of p_to + 1, Asia/Kathmandu). "Lent" therapists count where they worked: every figure is taken from
--    bookings / shifts at the branches asked for, whatever the therapist's home branch.
--  * service_sales = the Business health rule, per booking: Completed bookings dated in the period at their final price, minus refunds on them,
--    plus payments kept on No Show bookings dated in the period. A combo booking (several booking_therapists rows) is split equally between the
--    therapists on it. No booking_therapists row -> bookings.therapist_id. Products are not included.
--  * completed / bookings / no_show per therapist = the bookings they are on (a combo counts once for each therapist). bookings = not Cancelled.
--    No-show rate = no_show / bookings. due = the bookings they are on whose end time has passed (Nepal), not Cancelled and not
--    No Show: the score's completion rate is completed / due (a booking is due once its end time has passed, Nepal: today's later bookings are not failures yet; past never-closed ones stay in).
--  * Busy = booked minutes (booking_therapists times, not Cancelled / No Show) / working minutes (therapist_shifts_for_range with the
--    _dashboard_working filters: real shift, source <> 'none', service staff, breaks and time off out). null when no working minutes.
--  * rebook = of the distinct customers served (Completed in the period, customer_id else phone), the share who have another booking (any
--    therapist, any branch of the org, not Cancelled) dated 1..60 days after one of those visits. rate is null under 5 customers.
--  * attendance = therapist_attendance rows in the period (the old panel's source): att_present = Present + half days, over att_days.
--  * team = computed on its own from the bookings, not summed from the therapist rows, so it equals Business health for the same period and
--    branches: service_sales (= services delivered), completed, bookings, no_show, booked_min, working_min. Rows can add up to more completed
--    than the team when combos exist (one booking, several therapists).
-- STABLE SECURITY DEFINER, read-only. Idempotent.
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
wrk AS (
  SELECT s.therapist_id,
         COALESCE(sum(GREATEST(0, (EXTRACT(EPOCH FROM s.end_time - s.start_time) / 60)::int
           - COALESCE((SELECT sum((y->>'end_min')::int - (y->>'start_min')::int) FROM jsonb_array_elements(s.breaks) y), 0)
           - COALESCE((SELECT sum((y->>'end_min')::int - (y->>'start_min')::int) FROM jsonb_array_elements(s.off) y), 0))), 0)::int AS m
    FROM unnest(p_ids) bid
         CROSS JOIN LATERAL public.therapist_shifts_for_range(bid, p_from, p_to) s
         JOIN public.therapists st ON st.id = s.therapist_id
   WHERE s.works AND s.start_time IS NOT NULL AND s.source IS DISTINCT FROM 'none' AND st.is_service_staff IS NOT FALSE
   GROUP BY 1
),
att AS (
  SELECT a.therapist_id, count(*) AS days, count(*) FILTER (WHERE a.status::text IN ('Present', '1st-Half Day', '2nd-Half Day')) AS present
    FROM public.therapist_attendance a WHERE a.date >= p_from AND a.date <= p_to GROUP BY 1
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

CREATE OR REPLACE FUNCTION public.get_report_therapist_performance(p_branch_ids uuid[], p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid  uuid := auth.uid();
  v_role text;
  v_org  uuid;
  v_ids  uuid[];
  v_len  int;
  v_pf   date; v_pt date;
  v_branches jsonb; v_weeks jsonb;
BEGIN
  SELECT u.role::text, u.org_id INTO v_role, v_org FROM public.users u WHERE u.id = v_uid;
  IF v_role IS NULL THEN RETURN '{}'::jsonb; END IF;
  IF v_role NOT IN ('manager', 'admin', 'admin_viewer') THEN
    RAISE EXCEPTION 'Reports are not available for your role' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 400 THEN
    RAISE EXCEPTION 'Invalid date range' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(br.id), '{}') INTO v_ids
    FROM public.branches br
   WHERE br.org_id = v_org
     AND br.id = ANY (COALESCE(p_branch_ids, '{}'))
     AND (v_role IN ('admin', 'admin_viewer') OR br.id = ANY (public.get_user_branch_ids()));
  IF cardinality(v_ids) = 0 THEN RETURN '{}'::jsonb; END IF;

  v_len := p_to - p_from + 1;
  v_pt := p_from - 1;
  v_pf := v_pt - (v_len - 1);

  SELECT COALESCE(jsonb_agg(g::date ORDER BY g), '[]'::jsonb) INTO v_weeks
    FROM generate_series(date_trunc('week', p_from::timestamp), p_to::timestamp, interval '7 days') g;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('branch_id', br.id, 'name', br.name,
           'current', public._rtp_period(v_org, ARRAY[br.id], p_from, p_to, false)) ORDER BY br.name), '[]'::jsonb)
    INTO v_branches
    FROM public.branches br WHERE br.id = ANY (v_ids);

  RETURN jsonb_build_object(
    'from', p_from, 'to', p_to, 'prev_from', v_pf, 'prev_to', v_pt, 'weeks', v_weeks,
    'current', public._rtp_period(v_org, v_ids, p_from, p_to, true),
    'previous', public._rtp_period(v_org, v_ids, v_pf, v_pt, false),
    'branches', v_branches,
    'computed_at', now());
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_report_therapist_performance(uuid[], date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_report_therapist_performance(uuid[], date, date) TO authenticated;
REVOKE ALL ON FUNCTION public._rtp_period(uuid, uuid[], date, date, boolean) FROM PUBLIC, anon, authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('339', 'report-therapist-performance')
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
