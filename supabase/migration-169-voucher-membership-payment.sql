-- ============================================================
-- Migration 169: Membership balance as a payment method for vouchers
-- ============================================================
--
-- A membership customer buying a gift voucher should be able to pay (in
-- part or in full) from their membership wallet balance, same as they
-- already can at booking checkout (record_membership_payment, migration-046).
--
-- Done inside issue_voucher() itself, in the same transaction as the
-- voucher_payments insert loop it already runs — not a separate RPC called
-- afterward from JS. That way a mid-way failure (insufficient balance, no
-- membership, no linked customer) rolls back the whole voucher: no orphaned
-- voucher_payments row for a Membership tender that never actually debited
-- the wallet, and no wallet debit for a voucher that ultimately failed.
--
-- membership_transactions.voucher_payment_id mirrors the existing
-- booking_id/payment_id link columns on that same table, so a deduction row
-- always has one of the two link shapes set (booking_id+payment_id, or
-- voucher_payment_id) but never both — this is the voucher-purchase shape.
--
-- Base signature: the CURRENT live issue_voucher is the 12-arg version from
-- migration-140 (migration-139 added p_voucher_code for manual booklet
-- codes; migration-140 wrapped the voucher INSERT in a race-safe
-- BEGIN/EXCEPTION block) — NOT migration-100's 11-arg version. This
-- migration extends migration-140's body in place (CREATE OR REPLACE, same
-- 12-arg signature, no DROP FUNCTION needed for it).
--
-- A prior draft of this migration mistakenly targeted the stale 11-arg
-- signature, which (per the arity-overload gotcha called out in
-- migration-100/139's own comments) created a dead second overload instead
-- of replacing anything — the app always sends p_voucher_code, so it never
-- resolved to it, but drop it explicitly for any environment where that
-- draft was already applied.
--
-- Safe to run multiple times.
-- ============================================================

-- ---- 1. Link column + index ----

ALTER TABLE public.membership_transactions
  ADD COLUMN IF NOT EXISTS voucher_payment_id uuid
    REFERENCES public.voucher_payments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_membership_txns_voucher_payment
  ON public.membership_transactions(voucher_payment_id)
  WHERE voucher_payment_id IS NOT NULL;

-- ---- 2. Clean up a stale 11-arg overload from an earlier draft of this migration ----

DROP FUNCTION IF EXISTS public.issue_voucher(uuid, uuid, text, text, numeric, numeric, date, date, text, uuid, jsonb);

-- ---- 3. issue_voucher(): accept 'Membership' tenders, deduct atomically ----
-- (base body copied from migration-140, extended with the Membership tender
-- validation/deduction block)

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
-- MIGRATION 169 COMPLETE
-- ============================================================

INSERT INTO public.schema_migrations (version, name)
VALUES ('169', 'voucher-membership-payment')
ON CONFLICT (version) DO NOTHING;
