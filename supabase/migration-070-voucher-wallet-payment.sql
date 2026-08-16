-- ============================================================
-- Migration 070: Voucher wallet balance as a booking payment tender
-- ============================================================
--
-- Vouchers (migration-066) and booking payments have been entirely disconnected
-- until now — a voucher could only be redeemed from the standalone manager/
-- admin-only Vouchers panel, never applied toward a booking's bill. This lets
-- staff apply part (or all) of a voucher's remaining balance as one payment
-- tender on a booking, with any shortfall collected via another payment
-- method in the same payment — mirroring record_referral_wallet_payment
-- (migration-065) exactly, combined with claim_voucher()'s balance-check
-- logic (migration-066).
--
-- Two new pieces:
--   1. voucher_claims gets nullable booking_id/payment_id columns, so a claim
--      made through the payment flow links back to the booking+payment that
--      triggered it (existing standalone admin-panel claims stay NULL here).
--   2. record_voucher_wallet_payment(booking_id, voucher_id, amount, notes) —
--      SECURITY DEFINER, atomically inserts a payments row
--      (payment_mode='VoucherWallet') and a voucher_claims row. No role
--      restriction (any authenticated org member, staff included, may call
--      it — same posture as record_referral_wallet_payment) since this is a
--      payment-flow action, distinct from the manager/admin-only Vouchers
--      admin panel.
--   3. search_vouchers_for_payment(query) — SECURITY DEFINER, lets staff find
--      a voucher by code or guest name to attach to a payment, without
--      widening the broad manager/admin-only SELECT RLS on `vouchers` itself.
--
-- payments.payment_mode has no fixed CHECK allowlist since migration-052
-- (relaxed to a basic sanity check), so no constraint change is needed there.
--
-- Idempotent: CREATE OR REPLACE FUNCTION, guarded ALTER TABLE ADD COLUMN.
-- Portable: no hardcoded UUIDs.
--
-- Reversible (manual):
--   DROP FUNCTION IF EXISTS public.record_voucher_wallet_payment(uuid, uuid, numeric, text);
--   DROP FUNCTION IF EXISTS public.search_vouchers_for_payment(text);
--   ALTER TABLE public.voucher_claims DROP COLUMN IF EXISTS booking_id;
--   ALTER TABLE public.voucher_claims DROP COLUMN IF EXISTS payment_id;
-- ============================================================

-- ---- 1. voucher_claims: link a claim back to the booking/payment that made it ----

ALTER TABLE public.voucher_claims
  ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_voucher_claims_booking ON public.voucher_claims(booking_id);

-- ---- 2. record_voucher_wallet_payment -----------------------------------------

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
  SELECT org_id, total_amount_issued INTO v_voucher_org, v_total_issued
  FROM public.vouchers
  WHERE id = p_voucher_id
  FOR UPDATE;

  IF v_voucher_org IS NULL THEN
    RAISE EXCEPTION 'record_voucher_wallet_payment: voucher % not found', p_voucher_id;
  END IF;
  IF v_voucher_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'record_voucher_wallet_payment: voucher is not in your organization';
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

REVOKE ALL ON FUNCTION public.record_voucher_wallet_payment(uuid, uuid, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_voucher_wallet_payment(uuid, uuid, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_voucher_wallet_payment(uuid, uuid, numeric, text) TO authenticated;

-- ---- 3. search_vouchers_for_payment -------------------------------------------
-- Lets any authenticated org member (staff included) find a voucher by code or
-- guest name to attach to a payment, without granting broad SELECT on
-- `vouchers` itself (that stays manager/admin-only, per migration-066/069).

CREATE OR REPLACE FUNCTION public.search_vouchers_for_payment(p_query text)
RETURNS TABLE (
  voucher_id        uuid,
  voucher_code      text,
  guest_name        text,
  guest_info        text,
  expiry_date       date,
  remaining_balance numeric
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
  SELECT
    v.id,
    v.voucher_code,
    v.guest_name,
    v.guest_info,
    v.expiry_date,
    (v.total_amount_issued - COALESCE(c.total_claimed, 0)) AS remaining_balance
  FROM public.vouchers v
  LEFT JOIN (
    SELECT voucher_id, SUM(amount_claimed) AS total_claimed
    FROM public.voucher_claims
    GROUP BY voucher_id
  ) c ON c.voucher_id = v.id
  WHERE v.org_id = get_user_org_id()
    AND v.expiry_date >= (now() AT TIME ZONE 'Asia/Kathmandu')::date
    AND (v.total_amount_issued - COALESCE(c.total_claimed, 0)) > 0
    AND (
      p_query IS NULL OR btrim(p_query) = '' OR
      v.voucher_code ILIKE '%' || p_query || '%' OR
      v.guest_name   ILIKE '%' || p_query || '%'
    )
  ORDER BY v.guest_name
  LIMIT 10;
$$;

REVOKE ALL ON FUNCTION public.search_vouchers_for_payment(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_vouchers_for_payment(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.search_vouchers_for_payment(text) TO authenticated;

-- ============================================================
-- MIGRATION 070 COMPLETE
-- ============================================================
