-- ============================================================
-- Migration 100: Voucher payment tracking
-- ============================================================
--
-- vouchers has no link to money collected — discount_percent only affects
-- total_amount_issued (face value), not payment. Cash/card collected for a
-- voucher sale never entered any payments-shaped table, so daily
-- reconciliation (getDailySummary/DailyClosingPanel) undercounts cash on any
-- day a voucher was sold for cash, and there's no "voucher sales" number
-- anywhere in the app.
--
-- payments.booking_id is NOT NULL and every report query is booking-first
-- (fetch bookings, join payments by booking_id) — a voucher sale has no
-- booking, so it can't live in payments without touching a core table every
-- booking financial flow depends on. membership_transactions already solves
-- this exact shape (its own ledger, free-text payment_mode, no payments
-- link) — voucher_payments mirrors it.
--
-- No backfill: historical vouchers (including the imported paper-ledger
-- batch) stay untracked for payment. Only vouchers issued after this ships
-- get a voucher_payments row.
--
-- Safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.voucher_payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id   uuid NOT NULL REFERENCES public.vouchers(id),
  org_id       uuid NOT NULL,
  branch_id    uuid NOT NULL,
  amount       numeric(10,2) NOT NULL CHECK (amount > 0),
  payment_mode text NOT NULL,
  recorded_by  uuid NOT NULL,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT voucher_payments_payment_mode_check
    CHECK (length(btrim(payment_mode)) > 0 AND length(payment_mode) <= 40)
);

CREATE INDEX IF NOT EXISTS voucher_payments_voucher_id_idx ON public.voucher_payments(voucher_id);
CREATE INDEX IF NOT EXISTS voucher_payments_branch_created_idx ON public.voucher_payments(branch_id, created_at);

ALTER TABLE public.voucher_payments ENABLE ROW LEVEL SECURITY;

-- Read access matches vouchers itself: manager/admin/admin_viewer only —
-- staff get a create action (via issue_voucher), not a financial ledger view.
DROP POLICY IF EXISTS "Manager/admin can read own org voucher payments" ON public.voucher_payments;
CREATE POLICY "Manager/admin can read own org voucher payments"
  ON public.voucher_payments FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id() AND get_user_role() IN ('manager','admin','admin_viewer'));

-- NO direct INSERT/UPDATE/DELETE policy — writes go through issue_voucher()
-- (SECURITY DEFINER, same as vouchers itself). Append-only.

-- ---- issue_voucher(): accept tenders, write voucher_payments atomically ----

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
  p_customer_id uuid DEFAULT NULL,
  p_tenders jsonb DEFAULT NULL
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
  v_total        numeric(10,2);
  v_tender       jsonb;
  v_tender_sum   numeric(10,2) := 0;
  v_tender_amt   numeric(10,2);
  v_tender_mode  text;
BEGIN
  IF v_role NOT IN ('staff','manager','admin') THEN
    RAISE EXCEPTION 'issue_voucher: staff, manager, or admin role required';
  END IF;

  IF p_guest_name IS NULL OR length(btrim(p_guest_name)) = 0 THEN
    RAISE EXCEPTION 'issue_voucher: guest name is required';
  END IF;

  IF p_tenders IS NULL OR jsonb_typeof(p_tenders) != 'array' OR jsonb_array_length(p_tenders) = 0 THEN
    RAISE EXCEPTION 'issue_voucher: at least one payment tender is required';
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
  v_total := round(v_actual_price - (v_actual_price * p_discount_percent / 100), 2);

  -- Validate tenders sum to the voucher's total before touching any table.
  FOR v_tender IN SELECT * FROM jsonb_array_elements(p_tenders)
  LOOP
    v_tender_amt := (v_tender->>'amount')::numeric;
    v_tender_mode := v_tender->>'payment_mode';
    IF v_tender_amt IS NULL OR v_tender_amt <= 0 THEN
      RAISE EXCEPTION 'issue_voucher: each tender amount must be greater than zero';
    END IF;
    IF v_tender_mode IS NULL OR length(btrim(v_tender_mode)) = 0 THEN
      RAISE EXCEPTION 'issue_voucher: each tender must have a payment_mode';
    END IF;
    v_tender_sum := v_tender_sum + v_tender_amt;
  END LOOP;

  IF v_tender_sum != v_total THEN
    RAISE EXCEPTION 'issue_voucher: tenders total % does not match voucher total %', v_tender_sum, v_total;
  END IF;

  -- Keyed by code_prefix (not voucher_type_id): sibling types that share a
  -- prefix (e.g. the three "Full Body Oil Massage" durations, all "NT 4326")
  -- draw from one shared sequence, matching what the code text depends on.
  INSERT INTO public.voucher_code_counters (org_id, branch_id, code_prefix, next_number)
  VALUES (v_org, p_branch_id, v_type.code_prefix, 2)
  ON CONFLICT (branch_id, code_prefix)
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
    v_total,
    p_remarks, auth.uid(), p_customer_id
  )
  RETURNING * INTO v_row;

  FOR v_tender IN SELECT * FROM jsonb_array_elements(p_tenders)
  LOOP
    INSERT INTO public.voucher_payments (voucher_id, org_id, branch_id, amount, payment_mode, recorded_by)
    VALUES (
      v_row.id, v_org, p_branch_id,
      (v_tender->>'amount')::numeric,
      v_tender->>'payment_mode',
      auth.uid()
    );
  END LOOP;

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_voucher(uuid, uuid, text, text, numeric, numeric, date, date, text, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_voucher(uuid, uuid, text, text, numeric, numeric, date, date, text, uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.issue_voucher(uuid, uuid, text, text, numeric, numeric, date, date, text, uuid, jsonb) TO authenticated;

-- ============================================================
-- MIGRATION 100 COMPLETE
-- ============================================================

INSERT INTO public.schema_migrations (version, name)
VALUES ('100', 'voucher-payments')
ON CONFLICT (version) DO NOTHING;
