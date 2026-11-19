-- Migration 371: get_report_business_health(p_branch_ids, p_from, p_to), the numbers behind Reports > Business health (ZNLY-159, V37a)
--
-- Returns one jsonb: current, previous (the equal-length period right before), by_day {current, previous}, by_method, branches[].
--  * Access = get_dashboard (mig 368): org-scoped; manager only their own branches; admin and admin_viewer read; staff gets an error.
--    Branches outside the caller's scope are silently dropped; none left -> {}. No session -> {}.
--  * Dates are Nepal days (d0 = start of p_from, d1 = start of p_to + 1, Asia/Kathmandu).
--  * Services delivered = Completed bookings dated in the period at their final price, minus refunds on them, plus payments kept on No Show
--    bookings dated in the period. Sales (earned) = services delivered + product sales (not refunded). Money taken for a booking that is not
--    delivered yet (an advance) is not Sales.
--  * Cash in is computed on its own from money movements: real-mode payments created in the period + real-mode product payments + prepaid sold
--    - refunds paid in the period. Real = not Membership / SessionPackage / VoucherWallet / ReferralWallet / ReferralVoucher.
--  * Prepaid sold = membership deposits (rows with voucher_payment_id set are skipped: the voucher payment is the money) + voucher_payments
--    + packages.paid_amount (issued_date in the period). Wallet-mode rows are skipped (a wallet buying a voucher is not new money).
--  * bridge (each line from per-booking rows, so Sales - not_paid + overpaid + refunded_delivered - paid_from_prepaid - paid_before + earlier + advance
--    + other + prepaid_sold - refunds = Cash in EXACTLY):
--      not_paid  Completed in period: max(0, final - payments), the dashboard owed rule (a refund lowers the price and the amount paid equally)
--      overpaid  max(0, payments - final)      refunded_delivered  refunds on those Completed bookings (Sales is net of them, so the bridge adds them back)
--      paid_from_prepaid  prepaid-mode payments on the period's Completed / No Show bookings + wallet-mode product payments
--      paid_before  real payments taken before the period on the period's Completed / No Show bookings (cash of an earlier period)
--      earlier  real payments in the period on Completed / No Show bookings dated before it     advance  real payments in the period on bookings not
--      yet delivered (Pending / Confirmed / In-Progress, or dated after the period)     other  real payments in the period on Cancelled bookings, net of refunds
--      refunds  refunds paid in the period, except those on Cancelled bookings (already netted in other)
--    by_method splits the real money by mode (cash / card / qr / other); refunds carry no mode: sum(by_method) - refunds = cash in.
--  * top_service = {name, share}: the service with the biggest share of services delivered (null with none).
--  * Bookings = booking date in the period, not Cancelled; `made` = all of them. Average ticket = services delivered / Completed.
--  * Busy = booked minutes (not Cancelled / No Show) / working minutes. Working = therapist_shifts_for_range with the _dashboard_working
--    filters (real shift, source <> 'none', service staff), breaks and time off taken out. NULL share when no working minutes.
--  * Return rate = of distinct customers with a Completed booking in the period, the share with another Completed booking in the 60 days
--    before one of those bookings (org-wide history). Customer = customer_id, else phone.
--  * Every branch row and the All figure come from the same _rbh_period(), so additive fields sum to All.
-- STABLE SECURITY DEFINER, read-only. Idempotent.
-- Applied: stage - / prod -.

BEGIN;

-- One period for one set of branches.
CREATE OR REPLACE FUNCTION public._rbh_period(p_org uuid, p_ids uuid[], p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  d0 timestamptz := p_from::timestamp AT TIME ZONE 'Asia/Kathmandu';
  d1 timestamptz := (p_to + 1)::timestamp AT TIME ZONE 'Asia/Kathmandu';
  v_prepaid text[] := ARRAY['Membership', 'SessionPackage', 'VoucherWallet', 'ReferralWallet', 'ReferralVoucher'];
  v_refunds numeric; v_prod numeric; v_delivered numeric; v_sales numeric;
  v_use_mem numeric; v_use_pkg numeric; v_use_vch numeric; v_use_oth numeric; v_use numeric; v_prod_wallet numeric;
  v_sold_mem numeric; v_sold_vch numeric; v_sold_pkg numeric; v_sold numeric;
  v_cash numeric; v_card numeric; v_qr numeric; v_other numeric; v_cash_in numeric;
  v_notpaid numeric; v_overpaid numeric; v_refunded_delivered numeric; v_before numeric; v_earlier numeric; v_advance numeric; v_other_net numeric; v_refunds_line numeric;
  v_made int; v_active int; v_completed int; v_open int; v_cancelled int; v_noshow int;
  v_rows jsonb; v_booked int; v_working int; v_custs int; v_ret int; v_top_name text; v_top_share numeric;
BEGIN
  SELECT COALESCE(sum(rf.amount), 0) INTO v_refunds
    FROM public.payment_refunds rf JOIN public.bookings b ON b.id = rf.booking_id
   WHERE b.branch_id = ANY (p_ids) AND rf.created_at >= d0 AND rf.created_at < d1;
  SELECT COALESCE(sum(ps.total_amount), 0) INTO v_prod
    FROM public.product_sales ps
   WHERE ps.branch_id = ANY (p_ids) AND ps.refunded_at IS NULL AND ps.created_at >= d0 AND ps.created_at < d1;

  -- Services delivered: Completed bookings dated in the period at their final price less refunds on them, plus the payments kept on No Show
  -- bookings dated in the period. The same per-booking rows feed the bridge lines below, so Sales and the bridge cannot drift apart.
  SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb) INTO v_rows FROM (
    SELECT b.id, b.status::text AS st, b.date AS dt, b.final_amount AS final,
           COALESCE(pp.pay, 0) AS pay, COALESCE(pp.bef, 0) AS bef, COALESCE(pp.inp, 0) AS inp,
           COALESCE(pp.pm, 0) AS pm, COALESCE(pp.pk, 0) AS pk, COALESCE(pp.pv, 0) AS pv, COALESCE(pp.po, 0) AS po,
           COALESCE(rr.thru, 0) AS ref_thru, COALESCE(rr.inn, 0) AS ref_in, COALESCE(NULLIF(b.service_name_snapshot, ''), 'Other') AS svc
      FROM public.bookings b
      LEFT JOIN LATERAL (
        SELECT sum(p.amount) AS pay,
               sum(p.amount) FILTER (WHERE NOT (p.payment_mode = ANY (v_prepaid)) AND p.created_at < d0) AS bef,
               sum(p.amount) FILTER (WHERE NOT (p.payment_mode = ANY (v_prepaid)) AND p.created_at >= d0) AS inp,
               sum(p.amount) FILTER (WHERE p.payment_mode = 'Membership') AS pm,
               sum(p.amount) FILTER (WHERE p.payment_mode = 'SessionPackage') AS pk,
               sum(p.amount) FILTER (WHERE p.payment_mode = 'VoucherWallet') AS pv,
               sum(p.amount) FILTER (WHERE p.payment_mode = ANY (v_prepaid) AND p.payment_mode NOT IN ('Membership', 'SessionPackage', 'VoucherWallet')) AS po
          FROM public.payments p WHERE p.booking_id = b.id AND p.created_at < d1) pp ON true
      LEFT JOIN LATERAL (
        SELECT sum(rf.amount) AS thru, sum(rf.amount) FILTER (WHERE rf.created_at >= d0) AS inn
          FROM public.payment_refunds rf WHERE rf.booking_id = b.id AND rf.created_at < d1) rr ON true
     WHERE b.branch_id = ANY (p_ids)
       AND ((b.date >= p_from AND b.date <= p_to AND b.status::text IN ('Completed', 'No Show'))
            OR EXISTS (SELECT 1 FROM public.payments p WHERE p.booking_id = b.id AND p.created_at >= d0 AND p.created_at < d1)
            OR EXISTS (SELECT 1 FROM public.payment_refunds rf WHERE rf.booking_id = b.id AND rf.created_at >= d0 AND rf.created_at < d1))
  ) r;

  WITH k AS (
    SELECT t.*, (t.st = 'Completed' AND t.dt >= p_from AND t.dt <= p_to) AS is_c, (t.st = 'No Show' AND t.dt >= p_from AND t.dt <= p_to) AS is_n,
           t.final - t.pay AS s
      FROM jsonb_to_recordset(v_rows) AS t(id uuid, st text, dt date, final numeric, pay numeric, bef numeric, inp numeric, pm numeric, pk numeric, pv numeric, po numeric, ref_thru numeric, ref_in numeric, svc text)
  )
  SELECT
    COALESCE(sum(final - ref_thru) FILTER (WHERE is_c), 0) + COALESCE(sum(pay) FILTER (WHERE is_n), 0),
    COALESCE(sum(GREATEST(s, 0)) FILTER (WHERE is_c), 0),
    COALESCE(sum(GREATEST(-s, 0)) FILTER (WHERE is_c), 0),
    COALESCE(sum(bef) FILTER (WHERE is_c OR is_n), 0),
    COALESCE(sum(inp) FILTER (WHERE st IN ('Completed', 'No Show') AND NOT is_c AND NOT is_n AND dt < p_from), 0),
    COALESCE(sum(inp) FILTER (WHERE st <> 'Cancelled' AND NOT is_c AND NOT is_n AND NOT (st IN ('Completed', 'No Show') AND dt < p_from)), 0),
    COALESCE(sum(inp - ref_in) FILTER (WHERE st = 'Cancelled'), 0),
    COALESCE(sum(ref_in) FILTER (WHERE st <> 'Cancelled'), 0),
    COALESCE(sum(pm) FILTER (WHERE is_c OR is_n), 0), COALESCE(sum(pk) FILTER (WHERE is_c OR is_n), 0),
    COALESCE(sum(pv) FILTER (WHERE is_c OR is_n), 0), COALESCE(sum(po) FILTER (WHERE is_c OR is_n), 0),
    COALESCE(sum(ref_thru) FILTER (WHERE is_c), 0)
    INTO v_delivered, v_notpaid, v_overpaid, v_before, v_earlier, v_advance, v_other_net, v_refunds_line, v_use_mem, v_use_pkg, v_use_vch, v_use_oth, v_refunded_delivered
    FROM k;
  v_sales := v_delivered + v_prod;

  -- Paid from prepaid: the prepaid-mode payments above (on the period's delivered bookings) + wallet-mode product payments in the period.
  SELECT v_use_mem + COALESCE(sum(amount) FILTER (WHERE mode = 'Membership'), 0), v_use_pkg + COALESCE(sum(amount) FILTER (WHERE mode = 'SessionPackage'), 0),
         v_use_vch + COALESCE(sum(amount) FILTER (WHERE mode = 'VoucherWallet'), 0),
         v_use_oth + COALESCE(sum(amount) FILTER (WHERE mode NOT IN ('Membership', 'SessionPackage', 'VoucherWallet')), 0)
    INTO v_use_mem, v_use_pkg, v_use_vch, v_use_oth
    FROM (SELECT COALESCE(pp.payment_mode, ps.payment_mode) AS mode, COALESCE(pp.amount, ps.total_amount) AS amount
            FROM public.product_sales ps LEFT JOIN public.product_sale_payments pp ON pp.sale_id = ps.id
           WHERE ps.branch_id = ANY (p_ids) AND ps.refunded_at IS NULL AND ps.created_at >= d0 AND ps.created_at < d1
             AND COALESCE(pp.payment_mode, ps.payment_mode) = ANY (v_prepaid)) w;
  v_use := v_use_mem + v_use_pkg + v_use_vch + v_use_oth;

  -- Cash in, on its own: every real-mode money movement of the period (service payments, product payments, prepaid sold) less refunds paid out.
  WITH flows AS (
    SELECT 'svc'::text AS src, p.payment_mode AS mode, p.amount
      FROM public.payments p JOIN public.bookings b ON b.id = p.booking_id
     WHERE b.branch_id = ANY (p_ids) AND p.created_at >= d0 AND p.created_at < d1
    UNION ALL
    SELECT 'prod', COALESCE(pp.payment_mode, ps.payment_mode), COALESCE(pp.amount, ps.total_amount)
      FROM public.product_sales ps LEFT JOIN public.product_sale_payments pp ON pp.sale_id = ps.id
     WHERE ps.branch_id = ANY (p_ids) AND ps.refunded_at IS NULL AND ps.created_at >= d0 AND ps.created_at < d1
    UNION ALL
    SELECT 'mem', COALESCE(mt.payment_mode, 'Cash'), mt.amount
      FROM public.membership_transactions mt
     WHERE mt.kind = 'deposit' AND mt.voucher_payment_id IS NULL AND mt.branch_id = ANY (p_ids) AND mt.created_at >= d0 AND mt.created_at < d1
    UNION ALL
    SELECT 'vch', COALESCE(vp.payment_mode, 'Cash'), vp.amount
      FROM public.voucher_payments vp
     WHERE vp.branch_id = ANY (p_ids) AND vp.created_at >= d0 AND vp.created_at < d1
    UNION ALL
    SELECT 'pkg', COALESCE(pk.payment_method, 'Cash'), pk.paid_amount
      FROM public.packages pk
     WHERE pk.branch_id = ANY (p_ids) AND pk.issued_date >= p_from AND pk.issued_date <= p_to
  ), kind AS (
    SELECT f.*, (f.mode = ANY (v_prepaid)) AS is_prepaid,
           CASE WHEN f.mode = 'Cash' THEN 'cash'
                WHEN f.mode ILIKE '%card%' OR f.mode ILIKE 'visa%' OR f.mode ILIKE 'master%' THEN 'card'
                WHEN f.mode ILIKE 'fonepay%' OR f.mode ILIKE 'esewa%' OR f.mode ILIKE 'khalti%' OR f.mode ILIKE '%qr%' OR f.mode ILIKE 'mobilebanking%' THEN 'qr'
                ELSE 'other' END AS method
      FROM flows f
  )
  SELECT
    COALESCE(sum(amount) FILTER (WHERE src = 'mem' AND NOT is_prepaid), 0),
    COALESCE(sum(amount) FILTER (WHERE src = 'vch' AND NOT is_prepaid), 0),
    COALESCE(sum(amount) FILTER (WHERE src = 'pkg' AND NOT is_prepaid), 0),
    COALESCE(sum(amount) FILTER (WHERE NOT is_prepaid AND method = 'cash'), 0),
    COALESCE(sum(amount) FILTER (WHERE NOT is_prepaid AND method = 'card'), 0),
    COALESCE(sum(amount) FILTER (WHERE NOT is_prepaid AND method = 'qr'), 0),
    COALESCE(sum(amount) FILTER (WHERE NOT is_prepaid AND method = 'other'), 0)
    INTO v_sold_mem, v_sold_vch, v_sold_pkg, v_cash, v_card, v_qr, v_other
    FROM kind;
  v_sold := v_sold_mem + v_sold_vch + v_sold_pkg;
  v_cash_in := v_cash + v_card + v_qr + v_other - v_refunds;

  SELECT count(*), count(*) FILTER (WHERE b.status <> 'Cancelled'), count(*) FILTER (WHERE b.status = 'Completed'),
         count(*) FILTER (WHERE b.status IN ('Pending', 'Confirmed', 'In-Progress')),
         count(*) FILTER (WHERE b.status = 'Cancelled'), count(*) FILTER (WHERE b.status = 'No Show')
    INTO v_made, v_active, v_completed, v_open, v_cancelled, v_noshow
    FROM public.bookings b
   WHERE b.branch_id = ANY (p_ids) AND b.date >= p_from AND b.date <= p_to;

  -- the service with the biggest share of services delivered
  SELECT t.svc, round(t.amt / NULLIF(v_delivered, 0), 3) INTO v_top_name, v_top_share
    FROM (SELECT k2.svc, sum(CASE WHEN k2.st = 'Completed' THEN k2.final - k2.ref_thru ELSE k2.pay END) AS amt
            FROM jsonb_to_recordset(v_rows) AS k2(id uuid, st text, dt date, final numeric, pay numeric, ref_thru numeric, svc text)
           WHERE k2.dt >= p_from AND k2.dt <= p_to AND k2.st IN ('Completed', 'No Show')
           GROUP BY k2.svc ORDER BY 2 DESC, 1 LIMIT 1) t;

  SELECT COALESCE(sum((EXTRACT(EPOCH FROM COALESCE(bt.end_time, b.end_time) - COALESCE(bt.start_time, b.start_time)) / 60)::int), 0)::int INTO v_booked
    FROM public.booking_therapists bt JOIN public.bookings b ON b.id = bt.booking_id
   WHERE b.branch_id = ANY (p_ids) AND b.date >= p_from AND b.date <= p_to AND b.status NOT IN ('Cancelled', 'No Show');

  SELECT COALESCE(sum(GREATEST(0, (EXTRACT(EPOCH FROM s.end_time - s.start_time) / 60)::int
           - COALESCE((SELECT sum((y->>'end_min')::int - (y->>'start_min')::int) FROM jsonb_array_elements(s.breaks) y), 0)
           - COALESCE((SELECT sum((y->>'end_min')::int - (y->>'start_min')::int) FROM jsonb_array_elements(s.off) y), 0))), 0)::int
    INTO v_working
    FROM unnest(p_ids) bid
         CROSS JOIN LATERAL public.therapist_shifts_for_range(bid, p_from, p_to) s
         JOIN public.therapists st ON st.id = s.therapist_id
   WHERE s.works AND s.start_time IS NOT NULL AND s.source IS DISTINCT FROM 'none' AND st.is_service_staff IS NOT FALSE;

  WITH per AS (
    SELECT b.id, b.date, COALESCE(b.customer_id::text, NULLIF(b.customer_phone, '')) AS ck
      FROM public.bookings b
     WHERE b.branch_id = ANY (p_ids) AND b.status = 'Completed' AND b.date >= p_from AND b.date <= p_to
  ), cust AS (
    SELECT per.ck,
           bool_or(EXISTS (SELECT 1 FROM public.bookings h JOIN public.branches hb ON hb.id = h.branch_id
                            WHERE hb.org_id = p_org AND h.status = 'Completed' AND h.id <> per.id
                              AND h.date < per.date AND h.date >= per.date - 60
                              AND COALESCE(h.customer_id::text, NULLIF(h.customer_phone, '')) = per.ck)) AS ret
      FROM per WHERE per.ck IS NOT NULL GROUP BY per.ck
  )
  SELECT count(*), count(*) FILTER (WHERE ret) INTO v_custs, v_ret FROM cust;

  RETURN jsonb_build_object(
    'sales', v_sales, 'service_sales', v_delivered, 'product_sales', v_prod, 'refunds', v_refunds,
    'paid_from_prepaid', v_use,
    'paid_from_prepaid_by', jsonb_build_object('membership', v_use_mem, 'package', v_use_pkg, 'voucher', v_use_vch, 'other', v_use_oth),
    'prepaid_sold', v_sold,
    'prepaid_sold_by', jsonb_build_object('membership', v_sold_mem, 'voucher', v_sold_vch, 'package', v_sold_pkg),
    'cash_in', v_cash_in,
    'bridge', jsonb_build_object('not_paid', v_notpaid, 'overpaid', v_overpaid, 'paid_before', v_before, 'earlier', v_earlier, 'advance', v_advance,
                                 'other', v_other_net, 'refunds', v_refunds_line, 'refunded_delivered', v_refunded_delivered),
    'by_method', jsonb_build_object('cash', v_cash, 'card', v_card, 'qr', v_qr, 'other', v_other),
    'top_service', CASE WHEN v_top_name IS NOT NULL THEN jsonb_build_object('name', v_top_name, 'share', v_top_share) END,
    'bookings', v_active, 'made', v_made, 'completed', v_completed, 'open', v_open, 'cancelled', v_cancelled, 'no_show', v_noshow,
    'avg_ticket', CASE WHEN v_completed > 0 THEN round(v_delivered / v_completed, 2) END,
    'busy', jsonb_build_object('booked_min', v_booked, 'working_min', v_working,
                               'share', CASE WHEN v_working > 0 THEN round(v_booked::numeric / v_working, 3) END),
    'return_rate', jsonb_build_object('customers', v_custs, 'returning', v_ret,
                                      'rate', CASE WHEN v_custs > 0 THEN round(v_ret::numeric / v_custs, 3) END));
END;
$fn$;

-- Sales per Nepal day, one entry per day of the range (zero days included): services delivered on their booking date + products on their sale day.
CREATE OR REPLACE FUNCTION public._rbh_by_day(p_ids uuid[], p_from date, p_to date)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH d1 AS (SELECT (p_to + 1)::timestamp AT TIME ZONE 'Asia/Kathmandu' AS t),
  mv AS (
    SELECT b.date AS d,
           CASE WHEN b.status::text = 'Completed' THEN b.final_amount - COALESCE((SELECT sum(rf.amount) FROM public.payment_refunds rf WHERE rf.booking_id = b.id AND rf.created_at < (SELECT t FROM d1)), 0)
                ELSE COALESCE((SELECT sum(p.amount) FROM public.payments p WHERE p.booking_id = b.id AND p.created_at < (SELECT t FROM d1)), 0) END AS v
      FROM public.bookings b
     WHERE b.branch_id = ANY (p_ids) AND b.date >= p_from AND b.date <= p_to AND b.status::text IN ('Completed', 'No Show')
    UNION ALL
    SELECT (ps.created_at AT TIME ZONE 'Asia/Kathmandu')::date, ps.total_amount
      FROM public.product_sales ps
     WHERE ps.branch_id = ANY (p_ids) AND ps.refunded_at IS NULL
       AND ps.created_at >= p_from::timestamp AT TIME ZONE 'Asia/Kathmandu' AND ps.created_at < (p_to + 1)::timestamp AT TIME ZONE 'Asia/Kathmandu'
  ), per_day AS (SELECT d, sum(v) AS v FROM mv GROUP BY d)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('d', g.d::date, 'sales', COALESCE(x.v, 0)) ORDER BY g.d), '[]'::jsonb)
    FROM generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g(d)
    LEFT JOIN per_day x ON x.d = g.d::date;
$$;

-- Completed, not fully paid: what customers still owe right now (not period-bound, like the dashboard's "owed" need).
CREATE OR REPLACE FUNCTION public._rbh_owed(p_ids uuid[])
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object('amount', COALESCE(sum(x.bal), 0), 'count', count(*))
    FROM (SELECT b.final_amount - COALESCE((SELECT sum(p.amount) FROM public.payments p WHERE p.booking_id = b.id), 0) AS bal
            FROM public.bookings b
           WHERE b.branch_id = ANY (p_ids) AND b.status = 'Completed' AND b.payment_status <> 'paid') x
   WHERE x.bal > 0;
$$;

CREATE OR REPLACE FUNCTION public.get_report_business_health(p_branch_ids uuid[], p_from date, p_to date)
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
  v_cur  jsonb; v_prev jsonb; v_branches jsonb;
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

  v_cur  := public._rbh_period(v_org, v_ids, p_from, p_to) || jsonb_build_object('owed', public._rbh_owed(v_ids));
  v_prev := public._rbh_period(v_org, v_ids, v_pf, v_pt);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'branch_id', br.id, 'name', br.name,
           'current',  public._rbh_period(v_org, ARRAY[br.id], p_from, p_to) || jsonb_build_object('owed', public._rbh_owed(ARRAY[br.id])),
           'previous', public._rbh_period(v_org, ARRAY[br.id], v_pf, v_pt)) ORDER BY br.name), '[]'::jsonb)
    INTO v_branches
    FROM public.branches br WHERE br.id = ANY (v_ids);

  RETURN jsonb_build_object(
    'from', p_from, 'to', p_to, 'prev_from', v_pf, 'prev_to', v_pt,
    'current', v_cur, 'previous', v_prev,
    'by_day', jsonb_build_object('current', public._rbh_by_day(v_ids, p_from, p_to), 'previous', public._rbh_by_day(v_ids, v_pf, v_pt)),
    'by_method', (v_cur->'by_method') || jsonb_build_object('refunds', v_cur->'refunds'),
    'branches', v_branches,
    'computed_at', now());
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_report_business_health(uuid[], date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_report_business_health(uuid[], date, date) TO authenticated;
REVOKE ALL ON FUNCTION public._rbh_period(uuid, uuid[], date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._rbh_by_day(uuid[], date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._rbh_owed(uuid[]) FROM PUBLIC, anon, authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('371', 'report-business-health')
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
