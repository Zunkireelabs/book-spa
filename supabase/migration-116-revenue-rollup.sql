-- supabase/migration-116-revenue-rollup.sql
-- Drawer-basis "total sales, counted once" + commission math. Reads across all
-- orgs internally (SECURITY DEFINER) so no tenant RLS change is needed.

-- Helper: drawer-basis sales for one org over [p_from, p_to]. Callable for any
-- sub-range so the rollup can slice per rate-period. Internal only.
CREATE OR REPLACE FUNCTION public.platform_org_sales_base(
  p_org_id uuid, p_from date, p_to date
) RETURNS numeric
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
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
      AND pmt.payment_mode NOT IN ('Membership','ReferralWallet','VoucherWallet','ReferralVoucher')
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
$$;

CREATE OR REPLACE FUNCTION public.platform_get_revenue_rollup(
  p_from date, p_to date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  v_result jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(org_obj ORDER BY org_name), '[]'::jsonb) INTO v_result
  FROM (
    SELECT
      jsonb_build_object(
        'org_id', o.id,
        'org_name', o.name,
        'gross_total', public.platform_org_sales_base(o.id, p_from, p_to),
        'revenue_by_category', public.platform_org_category_breakdown(o.id, p_from, p_to),
        'revenue_by_branch',   public.platform_org_branch_breakdown(o.id, p_from, p_to),
        'active_rate_percent',     ar.rate_percent,
        'active_commission_basis', ar.commission_basis,
        'commission_for_range',    public.platform_commission_for_range(o.id, p_from, p_to),
        'commission_owed_to_date', CASE WHEN fr.first_from IS NULL THEN NULL
                                        ELSE public.platform_commission_for_range(o.id, fr.first_from, v_today) END,
        'collected_to_date',       COALESCE(coll.total, 0),
        'net_owed',                CASE WHEN fr.first_from IS NULL THEN NULL
                                        ELSE public.platform_commission_for_range(o.id, fr.first_from, v_today)
                                             - COALESCE(coll.total, 0) END
      ) AS org_obj,
      o.name AS org_name
    FROM public.organizations o
    LEFT JOIN LATERAL (
      SELECT rate_percent, commission_basis
      FROM public.org_commission_rates
      WHERE org_id = o.id AND effective_to IS NULL
      ORDER BY effective_from DESC LIMIT 1
    ) ar ON true
    LEFT JOIN LATERAL (
      SELECT MIN(effective_from) AS first_from
      FROM public.org_commission_rates WHERE org_id = o.id
    ) fr ON true
    LEFT JOIN LATERAL (
      SELECT SUM(amount_collected) AS total
      FROM public.org_commission_collections WHERE org_id = o.id
    ) coll ON true
    WHERE o.is_active
  ) sub;

  RETURN v_result;
END $$;

GRANT EXECUTE ON FUNCTION public.platform_get_revenue_rollup(date,date) TO authenticated;
-- platform_org_sales_base intentionally NOT granted to authenticated (internal).

INSERT INTO public.schema_migrations (version, name)
VALUES ('116', 'revenue-rollup') ON CONFLICT (version) DO NOTHING;
