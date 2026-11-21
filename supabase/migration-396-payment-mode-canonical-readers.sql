-- migration-396-payment-mode-canonical-readers.sql  (ZNLY-248)
--
-- WHY: payments are immutable and payment_mode is free text, so prod holds 'eSewa' (19) next to 'Esewa' (8), and 'membership' (1) next to
--      'Membership' (807). Reports that compared the raw text ('Cash', 'Membership', ANY(prepaid), NOT IN (wallet list)) misclassified the
--      odd spellings: Business Health counted a lowercase 'membership' payment as cash/other, and the platform revenue rollups counted it as revenue.
-- WHAT: _rbh_period (Business Health) and platform_org_branch_breakdown / platform_org_category_breakdown / platform_org_sales_base now read the
--       mode through _dashboard_canon_mode() (mig 391), the one canonical rule (JS twin: canonicalMode() in src/lib/dayMoney.js). Bodies are the
--       live ones with only the mode reads wrapped. Grants are preserved by CREATE OR REPLACE. No data is changed.
-- ROLLBACK: re-apply migration-371 (_rbh_period) and the platform_org_* definitions from migration-116 / their latest migration.

BEGIN;

CREATE OR REPLACE FUNCTION public._rbh_period(p_org uuid, p_ids uuid[], p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
               sum(p.amount) FILTER (WHERE NOT (public._dashboard_canon_mode(p.payment_mode) = ANY (v_prepaid)) AND p.created_at < d0) AS bef,
               sum(p.amount) FILTER (WHERE NOT (public._dashboard_canon_mode(p.payment_mode) = ANY (v_prepaid)) AND p.created_at >= d0) AS inp,
               sum(p.amount) FILTER (WHERE public._dashboard_canon_mode(p.payment_mode) = 'Membership') AS pm,
               sum(p.amount) FILTER (WHERE public._dashboard_canon_mode(p.payment_mode) = 'SessionPackage') AS pk,
               sum(p.amount) FILTER (WHERE public._dashboard_canon_mode(p.payment_mode) = 'VoucherWallet') AS pv,
               sum(p.amount) FILTER (WHERE public._dashboard_canon_mode(p.payment_mode) = ANY (v_prepaid) AND public._dashboard_canon_mode(p.payment_mode) NOT IN ('Membership', 'SessionPackage', 'VoucherWallet')) AS po
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
    FROM (SELECT public._dashboard_canon_mode(COALESCE(pp.payment_mode, ps.payment_mode)) AS mode, COALESCE(pp.amount, ps.total_amount) AS amount
            FROM public.product_sales ps LEFT JOIN public.product_sale_payments pp ON pp.sale_id = ps.id
           WHERE ps.branch_id = ANY (p_ids) AND ps.refunded_at IS NULL AND ps.created_at >= d0 AND ps.created_at < d1
             AND public._dashboard_canon_mode(COALESCE(pp.payment_mode, ps.payment_mode)) = ANY (v_prepaid)) w;
  v_use := v_use_mem + v_use_pkg + v_use_vch + v_use_oth;

  -- Cash in, on its own: every real-mode money movement of the period (service payments, product payments, prepaid sold) less refunds paid out.
  WITH flows AS (
    SELECT 'svc'::text AS src, public._dashboard_canon_mode(p.payment_mode) AS mode, p.amount
      FROM public.payments p JOIN public.bookings b ON b.id = p.booking_id
     WHERE b.branch_id = ANY (p_ids) AND p.created_at >= d0 AND p.created_at < d1
    UNION ALL
    SELECT 'prod', public._dashboard_canon_mode(COALESCE(pp.payment_mode, ps.payment_mode)), COALESCE(pp.amount, ps.total_amount)
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
    SELECT f.*, (public._dashboard_canon_mode(f.mode) = ANY (v_prepaid)) AS is_prepaid,
           CASE WHEN public._dashboard_canon_mode(f.mode) = 'Cash' THEN 'cash'
                WHEN public._dashboard_canon_mode(f.mode) ILIKE '%card%' OR public._dashboard_canon_mode(f.mode) ILIKE 'visa%' OR public._dashboard_canon_mode(f.mode) ILIKE 'master%' THEN 'card'
                WHEN public._dashboard_canon_mode(f.mode) ILIKE 'fonepay%' OR public._dashboard_canon_mode(f.mode) ILIKE 'esewa%' OR public._dashboard_canon_mode(f.mode) ILIKE 'khalti%' OR public._dashboard_canon_mode(f.mode) ILIKE '%qr%' OR public._dashboard_canon_mode(f.mode) ILIKE 'mobilebanking%' THEN 'qr'
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
$function$;


CREATE OR REPLACE FUNCTION public.platform_org_branch_breakdown(p_org_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH by_branch AS (
    SELECT br.id AS branch_id, br.name AS branch_name, SUM(pmt.amount) AS gross
    FROM public.payments pmt
    JOIN public.bookings bk ON bk.id = pmt.booking_id
    JOIN public.branches br ON br.id = bk.branch_id
    WHERE br.org_id = p_org_id
      AND bk.payment_status = 'paid'
      AND bk.date BETWEEN p_from AND p_to
      AND public._dashboard_canon_mode(pmt.payment_mode) NOT IN ('Membership','ReferralWallet','VoucherWallet','ReferralVoucher','SessionPackage')
    GROUP BY br.id, br.name
    UNION ALL
    SELECT v.branch_id, br.name, SUM(v.actual_price)
    FROM public.vouchers v JOIN public.branches br ON br.id = v.branch_id
    WHERE v.org_id = p_org_id AND v.issued_date BETWEEN p_from AND p_to
    GROUP BY v.branch_id, br.name
    UNION ALL
    -- membership_transactions has no branch_id -> org-level bucket
    SELECT NULL::uuid, '— (org-level)', SUM(mt.amount)
    FROM public.membership_transactions mt
    WHERE mt.org_id = p_org_id AND mt.kind = 'deposit'
      AND (mt.created_at AT TIME ZONE 'Asia/Kathmandu')::date BETWEEN p_from AND p_to
    HAVING SUM(mt.amount) > 0
  ),
  rolled AS (
    SELECT branch_id, MAX(branch_name) AS branch_name, SUM(gross) AS gross
    FROM by_branch WHERE gross IS NOT NULL AND gross <> 0
    GROUP BY branch_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'branch_id', branch_id, 'branch_name', branch_name, 'gross', gross) ORDER BY gross DESC), '[]'::jsonb)
  FROM rolled;
$function$;


CREATE OR REPLACE FUNCTION public.platform_org_category_breakdown(p_org_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cats AS (
    SELECT s.category AS category, SUM(pmt.amount) AS gross
    FROM public.payments pmt
    JOIN public.bookings bk ON bk.id = pmt.booking_id
    JOIN public.branches br ON br.id = bk.branch_id
    JOIN public.services s  ON s.id = bk.service_id
    WHERE br.org_id = p_org_id
      AND bk.payment_status = 'paid'
      AND bk.date BETWEEN p_from AND p_to
      AND public._dashboard_canon_mode(pmt.payment_mode) NOT IN ('Membership','ReferralWallet','VoucherWallet','ReferralVoucher','SessionPackage')
    GROUP BY s.category
    UNION ALL
    SELECT 'Voucher sales', SUM(v.actual_price)
    FROM public.vouchers v
    WHERE v.org_id = p_org_id AND v.issued_date BETWEEN p_from AND p_to
    HAVING SUM(v.actual_price) > 0
    UNION ALL
    SELECT 'Membership deposits', SUM(mt.amount)
    FROM public.membership_transactions mt
    WHERE mt.org_id = p_org_id AND mt.kind = 'deposit'
      AND (mt.created_at AT TIME ZONE 'Asia/Kathmandu')::date BETWEEN p_from AND p_to
    HAVING SUM(mt.amount) > 0
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('category', category, 'gross', gross) ORDER BY gross DESC), '[]'::jsonb)
  FROM cats WHERE gross IS NOT NULL AND gross <> 0;
$function$;


CREATE OR REPLACE FUNCTION public.platform_org_sales_base(p_org_id uuid, p_from date, p_to date)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH booking_income AS (
    -- Component 1: real (non-wallet) payments against paid, non-refunded bookings,
    -- at the payments grain (handles split tenders). Bucketed by booking.date.
    SELECT COALESCE(SUM(pmt.amount), 0) AS amt
    FROM public.payments pmt
    JOIN public.bookings bk ON bk.id = pmt.booking_id
    JOIN public.branches br ON br.id = bk.branch_id
    WHERE br.org_id = p_org_id
      AND bk.payment_status = 'paid'
      AND bk.date BETWEEN p_from AND p_to
      AND public._dashboard_canon_mode(pmt.payment_mode) NOT IN ('Membership','ReferralWallet','VoucherWallet','ReferralVoucher','SessionPackage')
  ),
  voucher_income AS (
    -- Component 2: money paid to buy vouchers, bucketed by issued_date.
    SELECT COALESCE(SUM(v.actual_price), 0) AS amt
    FROM public.vouchers v
    WHERE v.org_id = p_org_id
      AND v.issued_date BETWEEN p_from AND p_to
  ),
  membership_income AS (
    -- Component 3: membership wallet top-ups (deposits only), by created_at date.
    SELECT COALESCE(SUM(mt.amount), 0) AS amt
    FROM public.membership_transactions mt
    WHERE mt.org_id = p_org_id
      AND mt.kind = 'deposit'
      AND (mt.created_at AT TIME ZONE 'Asia/Kathmandu')::date BETWEEN p_from AND p_to
  )
  SELECT (SELECT amt FROM booking_income)
       + (SELECT amt FROM voucher_income)
       + (SELECT amt FROM membership_income);
$function$;


INSERT INTO public.schema_migrations (version, name) VALUES ('396', 'payment-mode-canonical-readers')
ON CONFLICT (version) DO NOTHING;
COMMIT;
