-- Migration 142: exclude SessionPackage payments from platform revenue rollup
--
-- migration-141 (service packages) introduced a new payment_mode,
-- 'SessionPackage', posted with a real (non-zero) `payments.amount` so
-- booking-level settlement/reporting (getDailySummary etc.) reconciles
-- correctly. But the platform revenue functions from migration-116/117
-- predate SessionPackage and only exclude the wallet/membership modes that
-- existed at the time:
--
--   AND pmt.payment_mode NOT IN ('Membership','ReferralWallet','VoucherWallet','ReferralVoucher')
--
-- A SessionPackage redemption settles a session that was already paid for
-- when the package was issued (that payment happened separately, off the
-- payments table, at package-issue time) -- so counting the redemption's
-- payments.amount here double-counts it as new platform revenue. Fix: add
-- 'SessionPackage' to the exclusion list everywhere it appears.
--
-- migration-116 and migration-117 are already applied to the live database,
-- so this migration CREATE OR REPLACEs the three affected functions
-- verbatim except for the widened exclusion list. No table/view changes.
--
-- Idempotent: CREATE OR REPLACE FUNCTION, ON CONFLICT DO NOTHING for the
-- migration record.
--
-- Reversible (manual): re-run migration-116/117's original CREATE OR REPLACE
-- FUNCTION bodies (without 'SessionPackage' in the exclusion list).

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
      AND pmt.payment_mode NOT IN ('Membership','ReferralWallet','VoucherWallet','ReferralVoucher','SessionPackage')
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
      AND pmt.payment_mode NOT IN ('Membership','ReferralWallet','VoucherWallet','ReferralVoucher','SessionPackage')
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
      AND pmt.payment_mode NOT IN ('Membership','ReferralWallet','VoucherWallet','ReferralVoucher','SessionPackage')
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

-- Grants unchanged from migration-116/117 (CREATE OR REPLACE preserves
-- existing grants), restated here for clarity/idempotency only.
GRANT EXECUTE ON FUNCTION public.platform_org_category_breakdown(uuid,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_org_branch_breakdown(uuid,date,date) TO authenticated;
-- platform_org_sales_base intentionally NOT granted to authenticated (internal).

INSERT INTO public.schema_migrations (version, name)
VALUES ('142', 'session-package-revenue-exclusion')
ON CONFLICT (version) DO NOTHING;
