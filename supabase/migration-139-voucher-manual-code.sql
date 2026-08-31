-- ============================================================
-- Migration 139: manual voucher code entry (temporary)
-- ============================================================
--
-- Staff have physical voucher booklets with pre-printed codes and need the
-- system's code to match. issue_voucher() previously always minted the code
-- itself from voucher_code_counters. This adds an optional p_voucher_code
-- param — if supplied, it's used as typed (trimmed only) instead of the
-- counter-based code, and the counter is left untouched so auto-generation
-- resumes correctly whenever this is reverted.
--
-- TEMPORARY: this is meant to be reverted once physical booklets are retired.
-- Revert is UI-only (stop sending voucherCode) — no migration needed to undo,
-- since the RPC falls back to its old counter-based behavior whenever
-- p_voucher_code is NULL/blank.
--
-- Adds one param, so this is a 12-arg signature — different arity from
-- migration-100's 11-arg version. Per that migration's own note, Postgres
-- keys functions by name + full signature: CREATE OR REPLACE does NOT
-- replace a different-arity function, it creates a second overload
-- alongside it. Drop the 11-arg signature explicitly so only the 12-arg
-- overload survives (same pattern migration-100 used against its own
-- stale 9-arg/10-arg predecessors).
--
-- Safe to run multiple times.
-- ============================================================

DROP FUNCTION IF EXISTS public.issue_voucher(uuid, uuid, text, text, numeric, numeric, date, date, text, uuid, jsonb);

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
  p_tenders jsonb DEFAULT NULL,
  p_voucher_code text DEFAULT NULL
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

  IF p_voucher_code IS NOT NULL AND length(btrim(p_voucher_code)) > 0 THEN
    -- Manual code from a physical booklet: use as typed, don't touch the
    -- counter so auto-generation stays correct for whenever this reverts.
    v_code := btrim(p_voucher_code);
    IF EXISTS (SELECT 1 FROM public.vouchers WHERE org_id = v_org AND voucher_code = v_code) THEN
      RAISE EXCEPTION 'issue_voucher: voucher code % is already in use', v_code;
    END IF;
  ELSE
    -- Keyed by code_prefix (not voucher_type_id): sibling types that share a
    -- prefix (e.g. the three "Full Body Oil Massage" durations, all "NT 4326")
    -- draw from one shared sequence, matching what the code text depends on.
    INSERT INTO public.voucher_code_counters (org_id, branch_id, code_prefix, next_number)
    VALUES (v_org, p_branch_id, v_type.code_prefix, 2)
    ON CONFLICT (branch_id, code_prefix)
      DO UPDATE SET next_number = public.voucher_code_counters.next_number + 1
    RETURNING next_number - 1 INTO v_seq;

    v_code := v_type.code_prefix || '-' || lpad(v_seq::text, 4, '0');
  END IF;

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

REVOKE ALL ON FUNCTION public.issue_voucher(uuid, uuid, text, text, numeric, numeric, date, date, text, uuid, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_voucher(uuid, uuid, text, text, numeric, numeric, date, date, text, uuid, jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.issue_voucher(uuid, uuid, text, text, numeric, numeric, date, date, text, uuid, jsonb, text) TO authenticated;

-- ============================================================
-- MIGRATION 139 COMPLETE
-- ============================================================

INSERT INTO public.schema_migrations (version, name)
VALUES ('139', 'voucher-manual-code')
ON CONFLICT (version) DO NOTHING;
