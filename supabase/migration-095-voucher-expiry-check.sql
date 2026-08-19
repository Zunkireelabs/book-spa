-- Migration 095: enforce voucher expiry at redemption time
--
-- Bug: neither claim_voucher() (migration-072, the manager/admin standalone
-- Vouchers panel) nor record_voucher_wallet_payment() (migration-076, the
-- booking-payment voucher tender) checks vouchers.expiry_date before
-- inserting a voucher_claims row. Both already re-derive the remaining
-- balance server-side (never trusting the client), but an expired voucher
-- with a nonzero remaining balance can still be redeemed through either
-- path -- search_vouchers_for_payment() filters expired vouchers out of the
-- picker UI, but that's a display filter, not an RPC-level guard, so a
-- voucher_id obtained earlier (e.g. from fetchVoucher's detail/claim modal,
-- or a stale search result held past expiry mid-session) still redeems.
--
-- Fix: both RPCs now re-check `expiry_date >= current date (Asia/Kathmandu)`
-- under the same row lock used for the balance check, so expiry can't be
-- raced either.
--
-- Idempotent: CREATE OR REPLACE FUNCTION (same signatures as migration-072/076).
--
-- Reversible (manual): restore claim_voucher()/record_voucher_wallet_payment()
-- bodies from migration-072-vouchers.sql / migration-076-voucher-wallet-payment.sql.

BEGIN;

CREATE OR REPLACE FUNCTION public.claim_voucher(
  p_voucher_id         uuid,
  p_amount_claimed     numeric,
  p_redeemed_date      date DEFAULT NULL,
  p_guest_name_used_by text DEFAULT NULL,
  p_service_claimed    text DEFAULT NULL,
  p_branch_claimed_id  uuid DEFAULT NULL,
  p_notes              text DEFAULT NULL
)
RETURNS public.voucher_claims
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role             user_role := get_user_role();
  v_org              uuid      := get_user_org_id();
  v_voucher_org      uuid;
  v_total_issued     numeric(10,2);
  v_expiry_date      date;
  v_branch_org       uuid;
  v_already_claimed  numeric(10,2);
  v_row              public.voucher_claims;
BEGIN
  IF v_role NOT IN ('manager','admin') THEN
    RAISE EXCEPTION 'claim_voucher: manager or admin role required';
  END IF;

  IF p_amount_claimed IS NULL OR p_amount_claimed <= 0 THEN
    RAISE EXCEPTION 'claim_voucher: amount_claimed must be positive';
  END IF;

  IF p_branch_claimed_id IS NULL THEN
    RAISE EXCEPTION 'claim_voucher: branch_claimed_id is required';
  END IF;

  SELECT org_id INTO v_branch_org FROM public.branches WHERE id = p_branch_claimed_id;
  IF v_branch_org IS NULL OR v_branch_org IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'claim_voucher: claiming branch is not in your organization';
  END IF;

  -- Lock the voucher row so a concurrent claim can't race the balance check.
  SELECT org_id, total_amount_issued, expiry_date
    INTO v_voucher_org, v_total_issued, v_expiry_date
  FROM public.vouchers
  WHERE id = p_voucher_id
  FOR UPDATE;

  IF v_voucher_org IS NULL THEN
    RAISE EXCEPTION 'claim_voucher: voucher % not found', p_voucher_id;
  END IF;
  IF v_voucher_org IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'claim_voucher: voucher is not in your organization';
  END IF;

  IF v_expiry_date < (now() AT TIME ZONE 'Asia/Kathmandu')::date THEN
    RAISE EXCEPTION 'claim_voucher: voucher expired on %', v_expiry_date;
  END IF;

  SELECT COALESCE(SUM(amount_claimed), 0) INTO v_already_claimed
  FROM public.voucher_claims
  WHERE voucher_id = p_voucher_id;

  IF p_amount_claimed > (v_total_issued - v_already_claimed) THEN
    RAISE EXCEPTION 'claim_voucher: amount % exceeds remaining balance %',
      p_amount_claimed, (v_total_issued - v_already_claimed);
  END IF;

  INSERT INTO public.voucher_claims (
    voucher_id, org_id, redeemed_date, guest_name_used_by, service_claimed,
    branch_claimed_id, amount_claimed, notes, performed_by
  )
  VALUES (
    p_voucher_id, v_org,
    COALESCE(p_redeemed_date, (now() AT TIME ZONE 'Asia/Kathmandu')::date),
    p_guest_name_used_by, p_service_claimed, p_branch_claimed_id,
    p_amount_claimed, p_notes, auth.uid()
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_voucher_wallet_payment(
  p_booking_id  uuid,
  p_voucher_id  uuid,
  p_amount      numeric,
  p_notes       text DEFAULT NULL
)
RETURNS uuid  -- the new payments.id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_org      uuid := get_user_org_id();
  v_actor           uuid := auth.uid();
  v_booking_org     uuid;
  v_branch_id       uuid;
  v_customer_name   text;
  v_is_locked       boolean;
  v_voucher_org     uuid;
  v_total_issued    numeric(10,2);
  v_expiry_date     date;
  v_already_claimed numeric(10,2);
  v_payment_id      uuid;
  v_claim_id        uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'record_voucher_wallet_payment: must be signed in';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'record_voucher_wallet_payment: amount must be positive';
  END IF;

  SELECT br.org_id, b.branch_id, b.customer_name, b.is_locked
    INTO v_booking_org, v_branch_id, v_customer_name, v_is_locked
  FROM public.bookings b
  JOIN public.branches br ON br.id = b.branch_id
  WHERE b.id = p_booking_id
  FOR UPDATE OF b;

  IF v_booking_org IS NULL THEN
    RAISE EXCEPTION 'record_voucher_wallet_payment: booking % not found', p_booking_id;
  END IF;

  IF v_booking_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'record_voucher_wallet_payment: booking is not in your organization';
  END IF;

  IF v_is_locked THEN
    RAISE EXCEPTION 'record_voucher_wallet_payment: this day has been closed, no further modifications allowed';
  END IF;

  -- Lock the voucher row so a concurrent claim/payment can't race the balance check.
  SELECT org_id, total_amount_issued, expiry_date
    INTO v_voucher_org, v_total_issued, v_expiry_date
  FROM public.vouchers
  WHERE id = p_voucher_id
  FOR UPDATE;

  IF v_voucher_org IS NULL THEN
    RAISE EXCEPTION 'record_voucher_wallet_payment: voucher % not found', p_voucher_id;
  END IF;
  IF v_voucher_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'record_voucher_wallet_payment: voucher is not in your organization';
  END IF;

  IF v_expiry_date < (now() AT TIME ZONE 'Asia/Kathmandu')::date THEN
    RAISE EXCEPTION 'record_voucher_wallet_payment: voucher expired on %', v_expiry_date;
  END IF;

  -- Re-derive the balance server-side rather than trusting the client's read —
  -- never trust a client-computed balance for a spend.
  SELECT COALESCE(SUM(amount_claimed), 0) INTO v_already_claimed
  FROM public.voucher_claims
  WHERE voucher_id = p_voucher_id;

  IF p_amount > (v_total_issued - v_already_claimed) THEN
    RAISE EXCEPTION 'record_voucher_wallet_payment: amount % exceeds remaining voucher balance %',
      p_amount, (v_total_issued - v_already_claimed);
  END IF;

  INSERT INTO public.payments (booking_id, amount, payment_mode, recorded_by, notes)
  VALUES (p_booking_id, p_amount, 'VoucherWallet', v_actor, p_notes)
  RETURNING id INTO v_payment_id;

  INSERT INTO public.voucher_claims (
    voucher_id, org_id, redeemed_date, guest_name_used_by, service_claimed,
    branch_claimed_id, amount_claimed, notes, performed_by, booking_id, payment_id
  )
  VALUES (
    p_voucher_id, v_caller_org, (now() AT TIME ZONE 'Asia/Kathmandu')::date, v_customer_name, NULL,
    v_branch_id, p_amount, p_notes, v_actor, p_booking_id, v_payment_id
  )
  RETURNING id INTO v_claim_id;

  RETURN v_payment_id;
END;
$$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('095', 'voucher-expiry-check')
ON CONFLICT (version) DO NOTHING;

COMMIT;
