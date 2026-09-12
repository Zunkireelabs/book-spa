-- ============================================================
-- Migration 170: allow issuing a zero-total (100%-discount) voucher
-- ============================================================
--
-- issue_voucher() rejects an empty p_tenders array unconditionally, BEFORE
-- v_total (actual_price minus discount) is even computed. A 100%-discounted
-- voucher has v_total = 0 — nothing to collect, so an empty tenders array is
-- the CORRECT input — but the RPC still raised "at least one payment tender
-- is required", making it structurally impossible to issue any free voucher:
-- the per-tender validation loop also requires every tender amount > 0, so
-- there's no way to construct a nonempty tenders array summing to 0 either.
--
-- Fix: keep the type check (p_tenders must be an array if provided) but only
-- require it be NON-EMPTY once v_total is known to be > 0. When v_total = 0,
-- an empty/null p_tenders is accepted, the tender loop naturally iterates zero
-- times (jsonb_array_elements is strict — a NULL argument yields no rows), and
-- no voucher_payments row is inserted (nothing was collected).
--
-- Same 12-arg issue_voucher signature as migration-169 — CREATE OR REPLACE in
-- place, no DROP FUNCTION needed.
--
-- Safe to run multiple times.
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
  v_role              user_role := get_user_role();
  v_org               uuid      := get_user_org_id();
  v_branch_org        uuid;
  v_customer_org      uuid;
  v_type              record;
  v_seq               int;
  v_code              text;
  v_actual_price      numeric(10,2);
  v_issued            date := COALESCE(p_issued_date, (now() AT TIME ZONE 'Asia/Kathmandu')::date);
  v_expiry            date := COALESCE(p_expiry_date, v_issued + interval '90 days');
  v_row               public.vouchers;
  v_total             numeric(10,2);
  v_tender            jsonb;
  v_tender_sum        numeric(10,2) := 0;
  v_tender_amt        numeric(10,2);
  v_tender_mode       text;
  v_membership_amt    numeric(10,2) := 0;
  v_membership_id     uuid;
  v_membership_balance numeric(12,2);
  v_voucher_payment_id uuid;
BEGIN
  IF v_role NOT IN ('staff','manager','admin') THEN
    RAISE EXCEPTION 'issue_voucher: staff, manager, or admin role required';
  END IF;

  IF p_guest_name IS NULL OR length(btrim(p_guest_name)) = 0 THEN
    RAISE EXCEPTION 'issue_voucher: guest name is required';
  END IF;

  -- Type check only here — whether a nonempty array is REQUIRED depends on
  -- v_total, which isn't known until after the voucher type/discount are
  -- resolved below.
  IF p_tenders IS NOT NULL AND jsonb_typeof(p_tenders) != 'array' THEN
    RAISE EXCEPTION 'issue_voucher: p_tenders must be a JSON array';
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

  -- A voucher with a real cost still needs at least one tender; a fully
  -- discounted (v_total = 0) voucher legitimately has nothing to collect.
  IF v_total > 0 AND (p_tenders IS NULL OR jsonb_array_length(p_tenders) = 0) THEN
    RAISE EXCEPTION 'issue_voucher: at least one payment tender is required';
  END IF;

  -- Validate tenders sum to the voucher's total before touching any table.
  -- (jsonb_array_elements is STRICT — a NULL p_tenders yields zero rows, so
  -- this loop naturally no-ops for a zero-total voucher with no tenders.)
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
    IF v_tender_mode = 'Membership' THEN
      v_membership_amt := v_membership_amt + v_tender_amt;
    END IF;
  END LOOP;

  IF v_tender_sum != v_total THEN
    RAISE EXCEPTION 'issue_voucher: tenders total % does not match voucher total %', v_tender_sum, v_total;
  END IF;

  -- Membership tender: resolve + lock the wallet and validate balance before
  -- touching any table, same lock-then-validate order as record_membership_payment.
  IF v_membership_amt > 0 THEN
    IF p_customer_id IS NULL THEN
      RAISE EXCEPTION 'issue_voucher: a linked customer is required to pay by Membership';
    END IF;

    SELECT id, balance INTO v_membership_id, v_membership_balance
    FROM public.memberships
    WHERE org_id = v_org AND customer_id = p_customer_id
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_membership_id IS NULL THEN
      RAISE EXCEPTION 'issue_voucher: customer has no membership';
    END IF;

    IF v_membership_balance < v_membership_amt THEN
      RAISE EXCEPTION 'issue_voucher: insufficient wallet balance (have %, need %)',
        v_membership_balance, v_membership_amt;
    END IF;
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

  BEGIN
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
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'issue_voucher: voucher code % is already in use', v_code;
  END;

  FOR v_tender IN SELECT * FROM jsonb_array_elements(p_tenders)
  LOOP
    INSERT INTO public.voucher_payments (voucher_id, org_id, branch_id, amount, payment_mode, recorded_by)
    VALUES (
      v_row.id, v_org, p_branch_id,
      (v_tender->>'amount')::numeric,
      v_tender->>'payment_mode',
      auth.uid()
    )
    RETURNING id INTO v_voucher_payment_id;

    IF v_tender->>'payment_mode' = 'Membership' THEN
      INSERT INTO public.membership_transactions
        (membership_id, org_id, kind, amount, payment_mode, voucher_payment_id, performed_by, notes, branch_id)
      VALUES
        (v_membership_id, v_org, 'deduction', -((v_tender->>'amount')::numeric), NULL,
         v_voucher_payment_id, auth.uid(), 'Voucher purchase: ' || v_code, p_branch_id);
    END IF;
  END LOOP;

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_voucher(uuid, uuid, text, text, numeric, numeric, date, date, text, uuid, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_voucher(uuid, uuid, text, text, numeric, numeric, date, date, text, uuid, jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.issue_voucher(uuid, uuid, text, text, numeric, numeric, date, date, text, uuid, jsonb, text) TO authenticated;

-- ============================================================
-- MIGRATION 170 COMPLETE
-- ============================================================

INSERT INTO public.schema_migrations (version, name)
VALUES ('170', 'voucher-zero-total-tender')
ON CONFLICT (version) DO NOTHING;
