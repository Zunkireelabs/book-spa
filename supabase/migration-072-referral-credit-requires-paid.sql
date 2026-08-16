-- ============================================================
-- Migration 072: Referrer wallet credit requires payment fully settled
-- ============================================================
--
-- credit_pending_referral_for_booking() previously gated purely on
-- bookings.status = 'Completed', with no check on payment_status
-- (unpaid/partial/paid, migration-042). Since status and payment tracking
-- are independent (staff can mark a booking Completed while a balance is
-- still due), the referrer's wallet could be credited before the referred
-- customer had actually paid in full. Product decision: only credit once
-- BOTH the service is Completed AND payment_status = 'paid'.
--
-- This function is now called speculatively from two places:
--   - updateBookingStatus() when status -> 'Completed' (unchanged call site)
--   - recordPayment() when a payment fully settles the balance (new call
--     site, src/services/api.js)
-- Whichever condition becomes true second is the one that actually credits;
-- the other call finds the remaining condition unmet and silently no-ops
-- (RETURN NULL, not an exception — this is now an expected/normal outcome,
-- not an error).
--
-- Idempotent: CREATE OR REPLACE FUNCTION. Same signature, no schema change.
--
-- Reversible (manual): re-run migration-067's original definition (RAISE
-- EXCEPTION on non-Completed status, no payment_status check).
-- ============================================================

CREATE OR REPLACE FUNCTION public.credit_pending_referral_for_booking(
  p_booking_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_referral_id   uuid;
  v_org_id        uuid;
  v_referrer      uuid;
  v_status        text;
  v_reward_type   text;
  v_requested     numeric(12,2);
  v_requires_manual boolean;
  v_booking_status booking_status;
  v_payment_status text;
  v_amount        numeric(12,2);
  v_credit_id     uuid;
BEGIN
  SELECT id, org_id, referring_customer_id, reward_status, reward_type, requested_reward_amount, requires_manual_reward
    INTO v_referral_id, v_org_id, v_referrer, v_status, v_reward_type, v_requested, v_requires_manual
  FROM public.customer_referrals
  WHERE booking_id = p_booking_id
  FOR UPDATE;

  IF v_referral_id IS NULL THEN
    RETURN NULL; -- no referral attached to this booking; normal case
  END IF;

  IF v_status <> 'pending' THEN
    RETURN NULL; -- already credited or voided; idempotent no-op
  END IF;

  IF v_requires_manual THEN
    RETURN NULL; -- customer self-service referral — awaits an explicit staff decision
                 -- via resolve_customer_referral_reward, not auto-credited here
  END IF;

  SELECT status, payment_status INTO v_booking_status, v_payment_status
  FROM public.bookings WHERE id = p_booking_id;

  IF v_booking_status IS DISTINCT FROM 'Completed' THEN
    RETURN NULL; -- service not yet completed
  END IF;

  IF v_payment_status IS DISTINCT FROM 'paid' THEN
    RETURN NULL; -- payment not yet fully settled
  END IF;

  -- Gift card / voucher rewards are fulfilled by staff outside the system — mark credited
  -- for reporting, but never touch the wallet ledger.
  IF v_reward_type IN ('gift_card', 'voucher') THEN
    UPDATE public.customer_referrals
       SET reward_status = 'credited',
           reward_amount = v_requested,
           credited_at   = now(),
           credited_by   = auth.uid()
     WHERE id = v_referral_id;
    RETURN NULL;
  END IF;

  -- Wallet: staff-entered amount wins; fall back to the org-wide default.
  v_amount := v_requested;
  IF v_amount IS NULL THEN
    SELECT referral_reward_amount INTO v_amount FROM public.organizations WHERE id = v_org_id;
  END IF;

  IF v_amount IS NULL OR v_amount = 0 THEN
    UPDATE public.customer_referrals
       SET reward_status = 'credited',
           reward_amount = 0,
           credited_at   = now(),
           credited_by   = auth.uid()
     WHERE id = v_referral_id;
    RETURN NULL; -- confirmed, but no reward configured — nothing to ledger
  END IF;

  INSERT INTO public.customer_referral_credits (org_id, referral_id, customer_id, amount)
  VALUES (v_org_id, v_referral_id, v_referrer, v_amount)
  RETURNING id INTO v_credit_id;

  UPDATE public.customer_referrals
     SET reward_status = 'credited',
         reward_amount = v_amount,
         credited_at   = now(),
         credited_by   = auth.uid()
   WHERE id = v_referral_id;

  RETURN v_credit_id;
END;
$$;

REVOKE ALL ON FUNCTION public.credit_pending_referral_for_booking(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.credit_pending_referral_for_booking(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.credit_pending_referral_for_booking(uuid) TO authenticated;

-- ============================================================
-- MIGRATION 072 COMPLETE
-- ============================================================
