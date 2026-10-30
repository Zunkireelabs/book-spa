-- Migration 338: get_report_money_owed(p_branch_ids, p_as_of), the numbers behind Reports > Money owed (ZNLY-159, V37b)
--
-- Returns one jsonb: as_of, rows[], totals, buckets, prev (the total 30 days earlier), by_customer[], by_branch[], by_staff[] (who served), by_responsible[] (due_holder_name; unassigned: true when empty).
--  * Access = get_report_business_health (mig 337, same as get_dashboard mig 334): org-scoped; manager only their own branches; admin and
--    admin_viewer read; staff gets an error. Branches outside the caller's scope are silently dropped; none left -> {}. No session -> {}.
--  * Owed = the one owed rule: Completed bookings with payment_status <> 'paid' and balance = final_amount - payments > 0, ANY date
--    (JS: src/lib/dashboardMoney.js, SQL twin: mig 334). A refund lowers the price and the amount paid equally, so it does not change the balance. Plus packages with
--    final_amount - paid_amount > 0 (kind 'package'; a package has no payment history, so its past balance is today's).
--  * As of a date D (p_as_of; null = today, Nepal): bookings dated <= D, counting only payments created before the end of D, and
--    the payment_status flag is not used (it describes now). As of today it is exactly "owed now".
--  * Age = as_of - booking date, in days. Buckets: 0-7, 8-30, 31-60, over 60. `prev` = the same rule as of (as_of - 30).
--  * kind: unpaid (nothing paid), partial, package.
-- STABLE SECURITY DEFINER, read-only. Idempotent.
-- Applied: stage - / prod -.

BEGIN;

-- Owed rows for one set of branches as of one date.
CREATE OR REPLACE FUNCTION public._rmo_rows(p_ids uuid[], p_as_of date, p_today date)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.age_days DESC, r.balance DESC, r.id), '[]'::jsonb)
    FROM (
      SELECT x.* FROM (
        SELECT b.id::text AS id, 'booking'::text AS src, b.booking_number AS ref, b.branch_id, br.name AS branch_name,
               b.customer_name, b.customer_phone, NULLIF(btrim(b.due_holder_name), '') AS responsible,
               COALESCE(b.customer_id::text, NULLIF(b.customer_phone, ''), b.customer_name) AS ckey,
               b.date, (p_as_of - b.date) AS age_days,
               COALESCE(NULLIF(b.service_name_snapshot, ''), '—') AS service, b.therapist_name_snapshot AS staff,
               b.final_amount AS total, COALESCE(pp.paid, 0) AS paid,
               b.final_amount - COALESCE(pp.paid, 0) AS balance,
               CASE WHEN COALESCE(pp.paid, 0) > 0 THEN 'partial' ELSE 'unpaid' END AS kind
          FROM public.bookings b
          JOIN public.branches br ON br.id = b.branch_id
          LEFT JOIN LATERAL (SELECT sum(p.amount) AS paid FROM public.payments p
                              WHERE p.booking_id = b.id AND p.created_at < (p_as_of + 1)::timestamp AT TIME ZONE 'Asia/Kathmandu') pp ON true
         WHERE b.branch_id = ANY (p_ids) AND b.status = 'Completed' AND b.date <= p_as_of
           AND (p_as_of < p_today OR b.payment_status <> 'paid')
        UNION ALL
        SELECT k.id::text, 'package', k.package_code, k.branch_id, br.name,
               COALESCE(c.full_name, k.guest_name, 'Guest'), c.phone, NULLIF(btrim(k.due_holder_name), ''),
               COALESCE(k.customer_id::text, NULLIF(c.phone, ''), COALESCE(k.guest_name, 'Guest')),
               k.issued_date, (p_as_of - k.issued_date),
               COALESCE(pt.name, 'Package'), NULL::text,
               k.final_amount, k.paid_amount, k.final_amount - k.paid_amount, 'package'
          FROM public.packages k
          JOIN public.branches br ON br.id = k.branch_id
          LEFT JOIN public.customers c ON c.id = k.customer_id
          LEFT JOIN public.package_types pt ON pt.id = k.package_type_id
         WHERE k.branch_id = ANY (p_ids) AND k.issued_date <= p_as_of
      ) x WHERE x.balance > 0
    ) r;
$$;

CREATE OR REPLACE FUNCTION public.get_report_money_owed(p_branch_ids uuid[], p_as_of date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid   uuid := auth.uid();
  v_role  text;
  v_org   uuid;
  v_ids   uuid[];
  v_today date := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  v_asof  date;
  v_rows  jsonb;
  v_prev  jsonb;
  v_resp jsonb; v_tot   jsonb; v_buckets jsonb; v_cust jsonb; v_branch jsonb; v_staff jsonb; v_prevt jsonb;
BEGIN
  SELECT u.role::text, u.org_id INTO v_role, v_org FROM public.users u WHERE u.id = v_uid;
  IF v_role IS NULL THEN RETURN '{}'::jsonb; END IF;
  IF v_role NOT IN ('manager', 'admin', 'admin_viewer') THEN
    RAISE EXCEPTION 'Reports are not available for your role' USING ERRCODE = '42501';
  END IF;
  v_asof := COALESCE(p_as_of, v_today);
  IF v_asof > v_today THEN RAISE EXCEPTION 'Invalid date' USING ERRCODE = '22023'; END IF;

  SELECT COALESCE(array_agg(br.id), '{}') INTO v_ids
    FROM public.branches br
   WHERE br.org_id = v_org
     AND br.id = ANY (COALESCE(p_branch_ids, '{}'))
     AND (v_role IN ('admin', 'admin_viewer') OR br.id = ANY (public.get_user_branch_ids()));
  IF cardinality(v_ids) = 0 THEN RETURN '{}'::jsonb; END IF;

  v_rows := public._rmo_rows(v_ids, v_asof, v_today);
  v_prev := public._rmo_rows(v_ids, v_asof - 30, v_today);

  WITH r AS (
    SELECT * FROM jsonb_to_recordset(v_rows) AS x(id text, src text, ref text, branch_id uuid, branch_name text, customer_name text, customer_phone text, responsible text, ckey text,
                                                  date date, age_days int, service text, staff text, total numeric, paid numeric, balance numeric, kind text)
  ), by_c AS (
    SELECT ckey, max(customer_name) AS name, max(customer_phone) AS phone, count(*) AS n, sum(balance) AS amount, max(date) AS last_date, max(age_days) AS oldest_days
      FROM r GROUP BY ckey
  )
  SELECT
    jsonb_build_object(
      'amount', COALESCE((SELECT sum(balance) FROM r), 0), 'count', (SELECT count(*) FROM r),
      'total', COALESCE((SELECT sum(total) FROM r), 0), 'paid', COALESCE((SELECT sum(paid) FROM r), 0),
      'unpaid_count', (SELECT count(*) FROM r WHERE kind = 'unpaid'), 'partial_count', (SELECT count(*) FROM r WHERE kind = 'partial'),
      'package_count', (SELECT count(*) FROM r WHERE kind = 'package'),
      'customers', (SELECT count(*) FROM by_c), 'largest_customer', COALESCE((SELECT max(amount) FROM by_c), 0),
      'oldest_days', (SELECT max(age_days) FROM r),
      'oldest_date', (SELECT date FROM r ORDER BY age_days DESC, balance DESC LIMIT 1),
      'oldest_count', (SELECT count(*) FROM r WHERE age_days = (SELECT max(age_days) FROM r))),
    jsonb_build_object(
      'd0_7',   jsonb_build_object('count', count(*) FILTER (WHERE age_days <= 7), 'amount', COALESCE(sum(balance) FILTER (WHERE age_days <= 7), 0)),
      'd8_30',  jsonb_build_object('count', count(*) FILTER (WHERE age_days BETWEEN 8 AND 30), 'amount', COALESCE(sum(balance) FILTER (WHERE age_days BETWEEN 8 AND 30), 0)),
      'd31_60', jsonb_build_object('count', count(*) FILTER (WHERE age_days BETWEEN 31 AND 60), 'amount', COALESCE(sum(balance) FILTER (WHERE age_days BETWEEN 31 AND 60), 0)),
      'd61',    jsonb_build_object('count', count(*) FILTER (WHERE age_days > 60), 'amount', COALESCE(sum(balance) FILTER (WHERE age_days > 60), 0))),
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('key', ckey, 'name', name, 'phone', phone, 'count', n, 'amount', amount, 'last_date', last_date, 'oldest_days', oldest_days)
                               ORDER BY amount DESC, name), '[]'::jsonb) FROM by_c),
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('branch_id', branch_id, 'name', bn, 'count', n, 'amount', amount, 'oldest_days', od) ORDER BY amount DESC, bn), '[]'::jsonb)
       FROM (SELECT branch_id, max(branch_name) AS bn, count(*) AS n, sum(balance) AS amount, max(age_days) AS od FROM r GROUP BY branch_id) q),
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', sn, 'count', n, 'amount', amount) ORDER BY amount DESC, sn), '[]'::jsonb)
       FROM (SELECT COALESCE(staff, 'Not recorded') AS sn, count(*) AS n, sum(balance) AS amount FROM r WHERE kind <> 'package' GROUP BY 1) q),
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', rn, 'unassigned', rn IS NULL, 'count', n, 'amount', amount, 'oldest_days', od) ORDER BY rn IS NULL, amount DESC, rn), '[]'::jsonb)
       FROM (SELECT responsible AS rn, count(*) AS n, sum(balance) AS amount, max(age_days) AS od FROM r GROUP BY 1) q)
    INTO v_tot, v_buckets, v_cust, v_branch, v_staff, v_resp
    FROM r;

  SELECT jsonb_build_object('as_of', v_asof - 30, 'amount', COALESCE(sum((x->>'balance')::numeric), 0), 'count', count(*))
    INTO v_prevt FROM jsonb_array_elements(v_prev) x;

  RETURN jsonb_build_object(
    'as_of', v_asof, 'rows', v_rows, 'totals', v_tot, 'buckets', v_buckets, 'prev', v_prevt,
    'by_customer', v_cust, 'by_branch', v_branch, 'by_staff', v_staff, 'by_responsible', v_resp, 'computed_at', now());
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_report_money_owed(uuid[], date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_report_money_owed(uuid[], date) TO authenticated;
REVOKE ALL ON FUNCTION public._rmo_rows(uuid[], date, date) FROM PUBLIC, anon, authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('338', 'report-money-owed')
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
