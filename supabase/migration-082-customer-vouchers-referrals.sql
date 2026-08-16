-- Migration 082: link vouchers to customer_accounts at issuance, grant
-- customers read access to their own vouchers/voucher_claims/referrals.
--
-- vouchers previously had no structured customer link at all -- just
-- free-text guest_name/guest_info (gift-card style, issuable to anyone).
-- Adds an optional customer_id so staff CAN link a voucher to a registered
-- customer at issuance time (via issue_voucher()'s new p_customer_id param),
-- without requiring it -- existing guest-name-only issuance still works.
--
-- Also grants customers read access to voucher_types (needed to display a
-- voucher's type name) and customer_referrals (their own referral stats),
-- both previously staff-only via get_user_role()/get_user_org_id(), which
-- resolve through the staff `users` table -- same class of gap fixed for
-- memberships in migration-065 and services/therapists/rooms in 081.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE
-- POLICY, CREATE OR REPLACE FUNCTION.
--
-- Reversible (manual):
--   ALTER TABLE public.vouchers DROP COLUMN IF EXISTS customer_id;
--   -- then restore issue_voucher() without p_customer_id from
--   -- migration-071-vouchers.sql, and drop the four new policies below.

BEGIN;

-- ============================================================
-- 1. vouchers.customer_id
-- ============================================================

ALTER TABLE public.vouchers ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id);
CREATE INDEX IF NOT EXISTS idx_vouchers_customer ON public.vouchers(customer_id);

-- ============================================================
-- 2. issue_voucher(): optional p_customer_id, org-validated
-- ============================================================

CREATE OR REPLACE FUNCTION public.issue_voucher(
  p_branch_id uuid,
  p_voucher_type_id uuid,
  p_guest_name text,
  p_guest_info text DEFAULT NULL,
  p_discount_percent numeric DEFAULT 0,
  p_actual_price numeric DEFAULT NULL,
  p_issued_date date DEFAULT NULL,
  p_expiry_date date DEFAULT NULL,
  p_remarks text DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL
)
RETURNS public.vouchers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role         user_role := get_user_role();
  v_org          uuid      := get_user_org_id();
  v_branch_org   uuid;
  v_customer_org uuid;
  v_type         record;
  v_seq          int;
  v_code         text;
  v_actual_price numeric(10,2);
  v_issued       date := COALESCE(p_issued_date, (now() AT TIME ZONE 'Asia/Kathmandu')::date);
  v_expiry       date := COALESCE(p_expiry_date, v_issued + interval '90 days');
  v_row          public.vouchers;
BEGIN
  IF v_role NOT IN ('staff','manager','admin') THEN
    RAISE EXCEPTION 'issue_voucher: staff, manager, or admin role required';
  END IF;

  IF p_guest_name IS NULL OR length(btrim(p_guest_name)) = 0 THEN
    RAISE EXCEPTION 'issue_voucher: guest name is required';
  END IF;

  SELECT org_id INTO v_branch_org FROM public.branches WHERE id = p_branch_id;
  IF v_branch_org IS NULL OR v_branch_org IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'issue_voucher: branch is not in your organization';
  END IF;

  IF p_customer_id IS NOT NULL THEN
    SELECT org_id INTO v_customer_org FROM public.customers WHERE id = p_customer_id;
    IF v_customer_org IS NULL OR v_customer_org IS DISTINCT FROM v_org THEN
      RAISE EXCEPTION 'issue_voucher: customer is not in your organization';
    END IF;
  END IF;

  SELECT * INTO v_type FROM public.voucher_types
  WHERE id = p_voucher_type_id AND org_id = v_org;
  IF v_type IS NULL THEN
    RAISE EXCEPTION 'issue_voucher: voucher type not found in your organization';
  END IF;

  IF p_discount_percent IS NULL OR p_discount_percent < 0 OR p_discount_percent > 100 THEN
    RAISE EXCEPTION 'issue_voucher: discount_percent must be between 0 and 100';
  END IF;

  IF v_expiry < v_issued THEN
    RAISE EXCEPTION 'issue_voucher: expiry_date cannot be before issued_date';
  END IF;

  v_actual_price := COALESCE(p_actual_price, v_type.standard_price);

  INSERT INTO public.voucher_code_counters (org_id, branch_id, voucher_type_id, next_number)
  VALUES (v_org, p_branch_id, p_voucher_type_id, 2)
  ON CONFLICT (branch_id, voucher_type_id)
    DO UPDATE SET next_number = public.voucher_code_counters.next_number + 1
  RETURNING next_number - 1 INTO v_seq;

  v_code := v_type.code_prefix || '-' || lpad(v_seq::text, 4, '0');

  INSERT INTO public.vouchers (
    org_id, branch_id, voucher_type_id, voucher_code, issued_date, expiry_date,
    guest_name, guest_info, actual_price, discount_percent, total_amount_issued,
    remarks, issued_by, customer_id
  )
  VALUES (
    v_org, p_branch_id, p_voucher_type_id, v_code, v_issued, v_expiry,
    btrim(p_guest_name), p_guest_info, v_actual_price, p_discount_percent,
    round(v_actual_price - (v_actual_price * p_discount_percent / 100), 2),
    p_remarks, auth.uid(), p_customer_id
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.issue_voucher(uuid, uuid, text, text, numeric, numeric, date, date, text, uuid) TO authenticated;

-- ============================================================
-- 3. Customer-facing RLS
-- ============================================================

DROP POLICY IF EXISTS "customer reads own org voucher types" ON public.voucher_types;
CREATE POLICY "customer reads own org voucher types" ON public.voucher_types
  FOR SELECT
  USING (
    org_id IN (SELECT org_id FROM public.customer_accounts WHERE auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "customer reads own vouchers" ON public.vouchers;
CREATE POLICY "customer reads own vouchers" ON public.vouchers
  FOR SELECT
  USING (
    customer_id IN (
      SELECT customer_id FROM public.customer_accounts
      WHERE auth_user_id = auth.uid() AND customer_id IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "customer reads own voucher claims" ON public.voucher_claims;
CREATE POLICY "customer reads own voucher claims" ON public.voucher_claims
  FOR SELECT
  USING (
    voucher_id IN (
      SELECT v.id FROM public.vouchers v
      WHERE v.customer_id IN (
        SELECT customer_id FROM public.customer_accounts
        WHERE auth_user_id = auth.uid() AND customer_id IS NOT NULL
      )
    )
  );

DROP POLICY IF EXISTS "customer reads own referrals" ON public.customer_referrals;
CREATE POLICY "customer reads own referrals" ON public.customer_referrals
  FOR SELECT
  USING (
    referring_customer_id IN (
      SELECT customer_id FROM public.customer_accounts
      WHERE auth_user_id = auth.uid() AND customer_id IS NOT NULL
    )
    OR referred_customer_id IN (
      SELECT customer_id FROM public.customer_accounts
      WHERE auth_user_id = auth.uid() AND customer_id IS NOT NULL
    )
  );

INSERT INTO public.schema_migrations (version, name)
VALUES ('082', 'customer-vouchers-referrals')
ON CONFLICT (version) DO NOTHING;

COMMIT;
