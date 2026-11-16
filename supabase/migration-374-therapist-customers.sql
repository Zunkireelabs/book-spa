-- Migration 374: get_therapist_customers(p_therapist_id, p_branch_ids, p_from, p_to), the rows behind the therapist inner page's Customers tab (ZNLY-172, V37e)
--
-- Returns jsonb { customers: [...] }: one row per customer with at least one booking with this therapist (any status) at the asked branches in the period.
--  * Access = get_report_therapist_performance (mig 373): org-scoped; manager only their own branches; admin and admin_viewer read; staff gets an error.
--    Branches outside the caller's scope are dropped; none left (or the therapist is not in the caller's org) -> {}. No session -> {}.
--  * SECURITY DEFINER because the history (first visit, next booking, booked again) crosses therapists and branches of the org.
--  * Customer key = customer_id, else phone (as 373); a booking with neither falls back to the lower-cased name so the row still shows (no history is then looked up).
--  * bookings[] = this therapist's bookings in the period: date, start, end, service, minutes, price (final price; a combo is split equally between its
--    therapists, as 373), status group, payment_status, paid_amount.
--    group: completed | cancelled | no_show (status 'No Show', or Cancelled with cancellation_reason 'No Show') | not_closed (Pending / Confirmed / In-Progress
--    whose end time has passed, Nepal) | upcoming (not ended yet).
--  * sales = Completed price (split); owed = Completed price minus payments on it, only while payment_status <> 'paid' (the Money owed rule, split);
--    last_served = latest Completed date in the period.
--  * booked_again = 373's rule: the customer's first booking (any therapist, any branch of the org, not Cancelled) dated 1..60 days after one of the
--    visits Completed with this therapist in the period: date, service, therapist (null = no therapist yet), with_this_therapist.
--  * first_visit = the customer's first Completed booking at the spa, ever; next_booking = first not Cancelled booking after today (Nepal).
--  * type = new (first_visit dated in the period) | returning (before it) | not_served (no Completed visit up to the end of the period).
-- STABLE SECURITY DEFINER, read-only. Idempotent.
-- Applied: local only (feat/ui-port-from-clinicmd).

BEGIN;

CREATE OR REPLACE FUNCTION public.get_therapist_customers(p_therapist_id uuid, p_branch_ids uuid[], p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid  uuid := auth.uid();
  v_role text;
  v_org  uuid;
  v_ids  uuid[];
  v_out  jsonb;
BEGIN
  SELECT u.role::text, u.org_id INTO v_role, v_org FROM public.users u WHERE u.id = v_uid;
  IF v_role IS NULL THEN RETURN '{}'::jsonb; END IF;
  IF v_role NOT IN ('manager', 'admin', 'admin_viewer') THEN
    RAISE EXCEPTION 'Reports are not available for your role' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 400 THEN
    RAISE EXCEPTION 'Invalid date range' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.therapists t WHERE t.id = p_therapist_id AND t.org_id = v_org) THEN RETURN '{}'::jsonb; END IF;

  SELECT COALESCE(array_agg(br.id), '{}') INTO v_ids
    FROM public.branches br
   WHERE br.org_id = v_org
     AND br.id = ANY (COALESCE(p_branch_ids, '{}'))
     AND (v_role IN ('admin', 'admin_viewer') OR br.id = ANY (public.get_user_branch_ids()));
  IF cardinality(v_ids) = 0 THEN RETURN '{}'::jsonb; END IF;

  WITH
  nowk AS (SELECT (now() AT TIME ZONE 'Asia/Kathmandu') AS n),
  -- this therapist's bookings in the period, with their equal share of a combo
  mine AS (
    SELECT b.id, b.date, b.start_time, b.end_time, b.status::text AS st, b.payment_status::text AS ps, b.cancellation_reason AS cr,
           b.final_amount, COALESCE(NULLIF(b.service_name_snapshot, ''), 'Service') AS svc, b.service_duration_snapshot AS mins,
           b.customer_id, b.customer_name, b.customer_phone,
           COALESCE(b.customer_id::text, NULLIF(b.customer_phone, ''), 'name:' || lower(btrim(COALESCE(b.customer_name, '')))) AS ck,
           1.0 / GREATEST(1, (SELECT count(*) FROM public.booking_therapists t WHERE t.booking_id = b.id)) AS w8,
           COALESCE((SELECT sum(p.amount) FROM public.payments p WHERE p.booking_id = b.id), 0) AS paid
      FROM public.bookings b
     WHERE b.branch_id = ANY (v_ids) AND b.date >= p_from AND b.date <= p_to
       AND (EXISTS (SELECT 1 FROM public.booking_therapists t WHERE t.booking_id = b.id AND t.therapist_id = p_therapist_id)
            OR (b.therapist_id = p_therapist_id AND NOT EXISTS (SELECT 1 FROM public.booking_therapists t2 WHERE t2.booking_id = b.id)))
  ),
  mg AS (
    SELECT m.*, CASE
        WHEN m.st = 'Completed' THEN 'completed'
        WHEN m.st = 'No Show' OR (m.st = 'Cancelled' AND m.cr = 'No Show') THEN 'no_show'
        WHEN m.st = 'Cancelled' THEN 'cancelled'
        WHEN (m.date::timestamp + COALESCE(m.end_time, time '23:59:59')) <= (SELECT n FROM nowk) THEN 'not_closed'
        ELSE 'upcoming' END AS grp
      FROM mine m
  ),
  cust AS (
    SELECT ck, max(customer_id::text) AS cid, max(customer_name) AS name, max(NULLIF(customer_phone, '')) AS phone,
           sum(final_amount * w8) FILTER (WHERE grp = 'completed') AS sales,
           sum(GREATEST(0, final_amount - paid) * w8) FILTER (WHERE grp = 'completed' AND ps <> 'paid' AND final_amount - paid > 0) AS owed,
           max(date) FILTER (WHERE grp = 'completed') AS last_served
      FROM mg GROUP BY ck
  ),
  -- every other booking of the same customers, anywhere in the org (history)
  hist AS (
    SELECT h.id, h.date, h.start_time, h.status::text AS st, COALESCE(NULLIF(h.service_name_snapshot, ''), 'Service') AS svc,
           COALESCE(h.customer_id::text, NULLIF(h.customer_phone, '')) AS ck,
           (SELECT t.therapist_id FROM public.booking_therapists t WHERE t.booking_id = h.id ORDER BY (t.therapist_id = p_therapist_id) DESC, t.assigned_at NULLS LAST LIMIT 1) AS bt,
           h.therapist_id AS legacy_t
      FROM public.bookings h JOIN public.branches hb ON hb.id = h.branch_id
     WHERE hb.org_id = v_org AND COALESCE(h.customer_id::text, NULLIF(h.customer_phone, '')) IN (SELECT ck FROM cust)
  ),
  histw AS (
    SELECT hi.*, COALESCE(hi.bt, hi.legacy_t) AS tid,
           (EXISTS (SELECT 1 FROM public.booking_therapists t WHERE t.booking_id = hi.id AND t.therapist_id = p_therapist_id)
            OR (hi.legacy_t = p_therapist_id AND NOT EXISTS (SELECT 1 FROM public.booking_therapists t2 WHERE t2.booking_id = hi.id))) AS with_me
      FROM hist hi
  ),
  ba AS (
    SELECT DISTINCT ON (x.ck) x.ck, x.date, x.svc, x.tname, x.with_me
      FROM (
        SELECT hw.ck, hw.date, hw.start_time, hw.svc, hw.with_me, th.name AS tname
          FROM histw hw
          LEFT JOIN public.therapists th ON th.id = hw.tid
         WHERE hw.st <> 'Cancelled'
           AND EXISTS (SELECT 1 FROM mg v WHERE v.ck = hw.ck AND v.grp = 'completed' AND v.id <> hw.id AND hw.date > v.date AND hw.date <= v.date + 60)
      ) x ORDER BY x.ck, x.date, x.start_time
  ),
  fv AS (
    SELECT DISTINCT ON (hw.ck) hw.ck, hw.date, hw.svc, th.name AS tname
      FROM histw hw LEFT JOIN public.therapists th ON th.id = hw.tid
     WHERE hw.st = 'Completed' AND hw.date <= p_to ORDER BY hw.ck, hw.date, hw.start_time
  ),
  nx AS (
    SELECT DISTINCT ON (hw.ck) hw.ck, hw.date, hw.svc, th.name AS tname
      FROM histw hw LEFT JOIN public.therapists th ON th.id = hw.tid
     WHERE hw.st <> 'Cancelled' AND hw.date > (SELECT n::date FROM nowk) ORDER BY hw.ck, hw.date, hw.start_time
  )
  SELECT jsonb_build_object('customers', COALESCE(jsonb_agg(jsonb_build_object(
      'key', c.ck, 'customer_id', c.cid, 'name', c.name, 'phone', c.phone,
      'sales', COALESCE(c.sales, 0), 'owed', COALESCE(c.owed, 0), 'last_served', c.last_served,
      'bookings', (SELECT jsonb_agg(jsonb_build_object('id', g.id, 'date', g.date, 'start', to_char(g.start_time, 'HH24:MI'), 'service', g.svc, 'minutes', g.mins,
                     'price', round(g.final_amount * g.w8, 2), 'group', g.grp, 'status', g.st, 'payment_status', g.ps, 'paid_amount', g.paid) ORDER BY g.date, g.start_time)
                     FROM mg g WHERE g.ck = c.ck),
      'booked_again', CASE WHEN ba.ck IS NULL THEN NULL ELSE jsonb_build_object('date', ba.date, 'service', ba.svc, 'therapist', ba.tname, 'with_this_therapist', ba.with_me) END,
      'first_visit', CASE WHEN fv.ck IS NULL THEN NULL ELSE jsonb_build_object('date', fv.date, 'service', fv.svc, 'therapist', fv.tname) END,
      'next_booking', CASE WHEN nx.ck IS NULL THEN NULL ELSE jsonb_build_object('date', nx.date, 'service', nx.svc, 'therapist', nx.tname) END,
      'type', CASE WHEN fv.ck IS NULL THEN 'not_served' WHEN fv.date >= p_from THEN 'new' ELSE 'returning' END
    ) ORDER BY c.sales DESC NULLS LAST, c.name), '[]'::jsonb))
    INTO v_out
    FROM cust c LEFT JOIN ba ON ba.ck = c.ck LEFT JOIN fv ON fv.ck = c.ck LEFT JOIN nx ON nx.ck = c.ck;
  RETURN v_out;
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_therapist_customers(uuid, uuid[], date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_therapist_customers(uuid, uuid[], date, date) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('374', 'therapist-customers')
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
