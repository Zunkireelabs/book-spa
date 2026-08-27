-- supabase/migration-117-breakdowns-drilldown.sql

CREATE OR REPLACE FUNCTION public.platform_org_category_breakdown(
  p_org_id uuid, p_from date, p_to date
) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  WITH cats AS (
    SELECT s.category AS category, SUM(pmt.amount) AS gross
    FROM public.payments pmt
    JOIN public.bookings bk ON bk.id = pmt.booking_id
    JOIN public.branches br ON br.id = bk.branch_id
    JOIN public.services s  ON s.id = bk.service_id
    WHERE br.org_id = p_org_id
      AND bk.payment_status = 'paid'
      AND bk.date BETWEEN p_from AND p_to
      AND pmt.payment_mode NOT IN ('Membership','ReferralWallet','VoucherWallet','ReferralVoucher')
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
$$;

CREATE OR REPLACE FUNCTION public.platform_org_branch_breakdown(
  p_org_id uuid, p_from date, p_to date
) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  WITH by_branch AS (
    SELECT br.id AS branch_id, br.name AS branch_name, SUM(pmt.amount) AS gross
    FROM public.payments pmt
    JOIN public.bookings bk ON bk.id = pmt.booking_id
    JOIN public.branches br ON br.id = bk.branch_id
    WHERE br.org_id = p_org_id
      AND bk.payment_status = 'paid'
      AND bk.date BETWEEN p_from AND p_to
      AND pmt.payment_mode NOT IN ('Membership','ReferralWallet','VoucherWallet','ReferralVoucher')
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
$$;

CREATE OR REPLACE FUNCTION public.platform_commission_for_range(
  p_org_id uuid, p_from date, p_to date
) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  r RECORD;
  v_overlap_from date;
  v_overlap_to   date;
  v_base numeric;
  v_total numeric := 0;
  v_any boolean := false;
BEGIN
  FOR r IN
    SELECT rate_percent, commission_basis, vat_rate_percent, effective_from, effective_to
    FROM public.org_commission_rates
    WHERE org_id = p_org_id
  LOOP
    v_overlap_from := GREATEST(p_from, r.effective_from);
    v_overlap_to   := LEAST(p_to, COALESCE(r.effective_to, v_today));
    IF v_overlap_from <= v_overlap_to THEN
      v_any := true;
      v_base := public.platform_org_sales_base(p_org_id, v_overlap_from, v_overlap_to);
      IF r.commission_basis = 'vat_exclusive' THEN
        v_base := v_base / (1 + r.vat_rate_percent / 100.0);
      END IF;
      v_total := v_total + v_base * r.rate_percent / 100.0;
    END IF;
  END LOOP;
  IF NOT v_any THEN RETURN NULL; END IF;
  RETURN round(v_total, 2);
END $$;

CREATE OR REPLACE FUNCTION public.platform_get_org_bookings(
  p_org_id uuid, p_from date, p_to date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(row_obj ORDER BY (row_obj->>'date') DESC), '[]'::jsonb) INTO v
  FROM (
    SELECT jsonb_build_object(
      'booking_id', bk.id,
      'booking_number', bk.booking_number,
      'date', bk.date,
      'branch_name', br.name,
      'service_name', s.name,
      'category', s.category,
      'final_amount', bk.final_amount,
      'payment_status', bk.payment_status,
      'status', bk.status,
      'payments', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('amount', p2.amount, 'payment_mode', p2.payment_mode)), '[]'::jsonb)
        FROM public.payments p2 WHERE p2.booking_id = bk.id
      )
    ) AS row_obj
    FROM public.bookings bk
    JOIN public.branches br ON br.id = bk.branch_id
    JOIN public.services s  ON s.id = bk.service_id
    WHERE br.org_id = p_org_id
      AND bk.date BETWEEN p_from AND p_to
  ) sub;
  RETURN v;
END $$;

GRANT EXECUTE ON FUNCTION public.platform_org_category_breakdown(uuid,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_org_branch_breakdown(uuid,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_commission_for_range(uuid,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_get_org_bookings(uuid,date,date) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('117', 'breakdowns-drilldown') ON CONFLICT (version) DO NOTHING;
