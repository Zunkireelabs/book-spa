-- Migration 096: fix TOCTOU race in record_referral_wallet_payment
--
-- Bug: record_referral_wallet_payment() (migration-071) re-derives the
-- customer's referral wallet balance via get_referral_credit_balance() --
-- a plain unlocked `SELECT SUM(credits) - SUM(debits)` -- then inserts a
-- debit row if the balance covers the spend. The only row lock taken is
-- `SELECT ... FROM bookings ... FOR UPDATE OF b`, which serializes two
-- calls against the SAME booking_id but does nothing for two DIFFERENT
-- bookings belonging to the same customer. Two concurrent referral-wallet
-- payments on different bookings for the same customer can both read the
-- same pre-debit balance under READ COMMITTED before either INSERT
-- commits, letting the wallet go negative (overdraw) -- the same failure
-- class already fixed for pooled voucher payments in migration-091.
--
-- redeem_referral_voucher() (also migration-071) is NOT affected -- it
-- locks the customer_referrals row (`FOR UPDATE OF cr`) before checking
-- redeemed_at, which correctly serializes concurrent redemption attempts
-- of the same voucher reward.
--
-- Fix: lock the customer's own `customers` row (`FOR UPDATE`) before
-- recomputing the balance, so a second concurrent call for the same
-- customer blocks until the first transaction commits or rolls back,
-- then sees the up-to-date balance.
--
-- Idempotent: CREATE OR REPLACE FUNCTION (same signature as migration-071).
--
-- Reversible (manual): restore record_referral_wallet_payment() from
-- migration-071-referral-reward-redemption.sql.

BEGIN;

CREATE OR REPLACE FUNCTION public.record_referral_wallet_payment(
  p_booking_id  uuid,
  p_amount      numeric,
  p_notes       text DEFAULT NULL
)
RETURNS uuid  -- the new payments.id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_org    uuid := get_user_org_id();
  v_actor         uuid := auth.uid();
  v_customer_id   uuid;
  v_booking_org   uuid;
  v_is_locked     boolean;
  v_balance       numeric(12,2);
  v_payment_id    uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'record_referral_wallet_payment: must be signed in';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'record_referral_wallet_payment: amount must be positive';
  END IF;

  SELECT b.customer_id, br.org_id, b.is_locked
    INTO v_customer_id, v_booking_org, v_is_locked
  FROM public.bookings b
  JOIN public.branches br ON br.id = b.branch_id
  WHERE b.id = p_booking_id
  FOR UPDATE OF b;

  IF v_booking_org IS NULL THEN
    RAISE EXCEPTION 'record_referral_wallet_payment: booking % not found', p_booking_id;
  END IF;

  IF v_booking_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'record_referral_wallet_payment: booking is not in your organization';
  END IF;

  IF v_is_locked THEN
    RAISE EXCEPTION 'record_referral_wallet_payment: this day has been closed, no further modifications allowed';
  END IF;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'record_referral_wallet_payment: booking has no linked customer';
  END IF;

  -- Lock the customer row so a concurrent wallet payment on a DIFFERENT
  -- booking for the same customer can't race the balance check below —
  -- the booking-row lock above only serializes calls on this booking_id.
  PERFORM 1 FROM public.customers WHERE id = v_customer_id FOR UPDATE;

  -- Re-derive the balance server-side rather than trusting the client's read —
  -- never trust a client-computed balance for a spend.
  v_balance := public.get_referral_credit_balance(v_customer_id);

  IF v_balance < p_amount THEN
    RAISE EXCEPTION 'record_referral_wallet_payment: insufficient referral wallet balance (have %, need %)',
      v_balance, p_amount;
  END IF;

  INSERT INTO public.payments (booking_id, amount, payment_mode, recorded_by, notes)
  VALUES (p_booking_id, p_amount, 'ReferralWallet', v_actor, p_notes)
  RETURNING id INTO v_payment_id;

  INSERT INTO public.customer_referral_debits
    (org_id, customer_id, amount, booking_id, payment_id, created_by)
  VALUES
    (v_caller_org, v_customer_id, p_amount, p_booking_id, v_payment_id, v_actor);

  RETURN v_payment_id;
END;
$$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('096', 'fix-referral-wallet-payment-race')
ON CONFLICT (version) DO NOTHING;

COMMIT;
