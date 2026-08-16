-- ============================================================
-- Migration 071: Referral rewards are Wallet-only
-- ============================================================
--
-- Referral rewards previously let staff/managers choose between Wallet credit
-- and Gift Voucher in three UI locations (StaffBookingForm at booking
-- creation, PaymentModal, BookingActionModal). Product decision: referral
-- rewards are always Wallet credit going forward — no voucher choice.
--
-- This migration tightens the two SECURITY DEFINER RPCs that accept a
-- reward_type from the client, so the restriction holds even against a
-- direct RPC call, not just a hidden UI control:
--   - record_customer_referral (migration-062): now only accepts 'wallet'.
--   - resolve_customer_referral_reward (migration-067): now only accepts
--     'wallet'; the 'voucher' branch (credit-via-catalog, never touching the
--     wallet ledger) is removed since it's unreachable once validation
--     rejects anything but 'wallet'.
--
-- Deliberately NOT touched: credit_pending_referral_for_booking (the
-- auto-credit-on-booking-completion path) keeps its existing
-- `reward_type IN ('gift_card', 'voucher')` branch — pre-existing
-- customer_referrals rows already carrying those reward types (from before
-- this change) still need to auto-credit correctly. No data backfill/
-- conversion of existing rows is done here — that's a separate decision.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.
--
-- Reversible (manual): re-run migration-062/067's original function bodies.
-- ============================================================

-- ---- record_customer_referral: wallet only ------------------------------------
-- Two overloads exist in the DB — a legacy 6-arg one (migration-062) that's no
-- longer called by the frontend, and the 7-arg one (migration-064, with
-- p_reward_catalog_id) that createBooking()/StaffBookingForm actually calls
-- today. Both are tightened to wallet-only for defense-in-depth, but the
-- 7-arg version is the one that matters — the catalog-lookup logic is dropped
-- from it since only 'wallet' is accepted now.

CREATE OR REPLACE FUNCTION public.record_customer_referral(
  p_referring_customer_id uuid,
  p_referred_customer_id  uuid,
  p_booking_id            uuid,
  p_notes                 text DEFAULT NULL,
  p_reward_type           text DEFAULT 'wallet',
  p_reward_amount         numeric(12,2) DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_org   uuid := get_user_org_id();
  v_referrer_org uuid;
  v_referred_org uuid;
  v_booking_customer uuid;
  v_booking_branch   uuid;
  v_booking_org      uuid;
  v_referral_id  uuid;
BEGIN
  IF v_caller_org IS NULL THEN
    RAISE EXCEPTION 'record_customer_referral: caller has no organization';
  END IF;

  IF p_referring_customer_id = p_referred_customer_id THEN
    RAISE EXCEPTION 'record_customer_referral: a customer cannot refer themselves';
  END IF;

  IF p_reward_type IS DISTINCT FROM 'wallet' THEN
    RAISE EXCEPTION 'record_customer_referral: only wallet rewards are supported';
  END IF;

  IF p_reward_amount IS NOT NULL AND p_reward_amount < 0 THEN
    RAISE EXCEPTION 'record_customer_referral: reward_amount cannot be negative';
  END IF;

  SELECT org_id INTO v_referrer_org FROM public.customers WHERE id = p_referring_customer_id;
  SELECT org_id INTO v_referred_org FROM public.customers WHERE id = p_referred_customer_id;

  IF v_referrer_org IS NULL THEN
    RAISE EXCEPTION 'record_customer_referral: referring customer % not found', p_referring_customer_id;
  END IF;
  IF v_referred_org IS NULL THEN
    RAISE EXCEPTION 'record_customer_referral: referred customer % not found', p_referred_customer_id;
  END IF;
  IF v_referrer_org IS DISTINCT FROM v_caller_org OR v_referred_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'record_customer_referral: customers must be in your organization';
  END IF;

  SELECT b.customer_id, b.branch_id, br.org_id
    INTO v_booking_customer, v_booking_branch, v_booking_org
  FROM public.bookings b
  JOIN public.branches br ON br.id = b.branch_id
  WHERE b.id = p_booking_id;

  IF v_booking_org IS NULL THEN
    RAISE EXCEPTION 'record_customer_referral: booking % not found', p_booking_id;
  END IF;
  IF v_booking_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'record_customer_referral: booking is not in your organization';
  END IF;
  IF v_booking_customer IS DISTINCT FROM p_referred_customer_id THEN
    RAISE EXCEPTION 'record_customer_referral: booking does not belong to the referred customer';
  END IF;

  IF EXISTS (SELECT 1 FROM public.customer_referrals WHERE referred_customer_id = p_referred_customer_id) THEN
    RAISE EXCEPTION 'record_customer_referral: this customer has already been referred once';
  END IF;

  INSERT INTO public.customer_referrals
    (org_id, referring_customer_id, referred_customer_id, booking_id, created_by, notes,
     reward_type, requested_reward_amount)
  VALUES
    (v_caller_org, p_referring_customer_id, p_referred_customer_id, p_booking_id, auth.uid(), p_notes,
     p_reward_type, p_reward_amount)
  RETURNING id INTO v_referral_id;

  RETURN v_referral_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_customer_referral(uuid, uuid, uuid, text, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_customer_referral(uuid, uuid, uuid, text, text, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_customer_referral(uuid, uuid, uuid, text, text, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_customer_referral(
  p_referring_customer_id uuid,
  p_referred_customer_id  uuid,
  p_booking_id            uuid,
  p_notes                 text DEFAULT NULL,
  p_reward_type           text DEFAULT 'wallet',
  p_reward_amount         numeric(12,2) DEFAULT NULL,
  p_reward_catalog_id     uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_org   uuid := get_user_org_id();
  v_referrer_org uuid;
  v_referred_org uuid;
  v_booking_customer uuid;
  v_booking_branch   uuid;
  v_booking_org      uuid;
  v_referral_id  uuid;
BEGIN
  IF v_caller_org IS NULL THEN
    RAISE EXCEPTION 'record_customer_referral: caller has no organization';
  END IF;

  IF p_referring_customer_id = p_referred_customer_id THEN
    RAISE EXCEPTION 'record_customer_referral: a customer cannot refer themselves';
  END IF;

  IF p_reward_type IS DISTINCT FROM 'wallet' THEN
    RAISE EXCEPTION 'record_customer_referral: only wallet rewards are supported';
  END IF;

  IF p_reward_amount IS NOT NULL AND p_reward_amount < 0 THEN
    RAISE EXCEPTION 'record_customer_referral: reward_amount cannot be negative';
  END IF;

  SELECT org_id INTO v_referrer_org FROM public.customers WHERE id = p_referring_customer_id;
  SELECT org_id INTO v_referred_org FROM public.customers WHERE id = p_referred_customer_id;

  IF v_referrer_org IS NULL THEN
    RAISE EXCEPTION 'record_customer_referral: referring customer % not found', p_referring_customer_id;
  END IF;
  IF v_referred_org IS NULL THEN
    RAISE EXCEPTION 'record_customer_referral: referred customer % not found', p_referred_customer_id;
  END IF;
  IF v_referrer_org IS DISTINCT FROM v_caller_org OR v_referred_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'record_customer_referral: customers must be in your organization';
  END IF;

  SELECT b.customer_id, b.branch_id, br.org_id
    INTO v_booking_customer, v_booking_branch, v_booking_org
  FROM public.bookings b
  JOIN public.branches br ON br.id = b.branch_id
  WHERE b.id = p_booking_id;

  IF v_booking_org IS NULL THEN
    RAISE EXCEPTION 'record_customer_referral: booking % not found', p_booking_id;
  END IF;
  IF v_booking_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'record_customer_referral: booking is not in your organization';
  END IF;
  IF v_booking_customer IS DISTINCT FROM p_referred_customer_id THEN
    RAISE EXCEPTION 'record_customer_referral: booking does not belong to the referred customer';
  END IF;

  IF EXISTS (SELECT 1 FROM public.customer_referrals WHERE referred_customer_id = p_referred_customer_id) THEN
    RAISE EXCEPTION 'record_customer_referral: this customer has already been referred once';
  END IF;

  -- p_reward_catalog_id is accepted for signature compatibility with existing
  -- callers but ignored — only wallet rewards are supported now, so there's no
  -- catalog item to look up or link.
  INSERT INTO public.customer_referrals
    (org_id, referring_customer_id, referred_customer_id, booking_id, created_by, notes,
     reward_type, requested_reward_amount)
  VALUES
    (v_caller_org, p_referring_customer_id, p_referred_customer_id, p_booking_id, auth.uid(), p_notes,
     p_reward_type, p_reward_amount)
  RETURNING id INTO v_referral_id;

  RETURN v_referral_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_customer_referral(uuid, uuid, uuid, text, text, numeric, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_customer_referral(uuid, uuid, uuid, text, text, numeric, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_customer_referral(uuid, uuid, uuid, text, text, numeric, uuid) TO authenticated;

-- ---- resolve_customer_referral_reward: wallet only -----------------------------

CREATE OR REPLACE FUNCTION public.resolve_customer_referral_reward(
  p_referral_id       uuid,
  p_reward_type       text,
  p_reward_amount     numeric(12,2) DEFAULT NULL,
  p_reward_catalog_id uuid          DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_org    uuid := get_user_org_id();
  v_caller_role   text := get_user_role();
  v_org_id        uuid;
  v_referrer      uuid;
  v_status        text;
  v_amount        numeric(12,2);
  v_credit_id     uuid;
BEGIN
  IF v_caller_org IS NULL THEN
    RAISE EXCEPTION 'resolve_customer_referral_reward: caller has no organization';
  END IF;
  IF v_caller_role NOT IN ('manager', 'admin') THEN
    RAISE EXCEPTION 'resolve_customer_referral_reward: manager or admin only';
  END IF;
  IF p_reward_type IS DISTINCT FROM 'wallet' THEN
    RAISE EXCEPTION 'resolve_customer_referral_reward: only wallet rewards are supported';
  END IF;
  IF p_reward_amount IS NOT NULL AND p_reward_amount < 0 THEN
    RAISE EXCEPTION 'resolve_customer_referral_reward: reward_amount cannot be negative';
  END IF;

  SELECT org_id, referring_customer_id, reward_status
    INTO v_org_id, v_referrer, v_status
  FROM public.customer_referrals
  WHERE id = p_referral_id
  FOR UPDATE;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'resolve_customer_referral_reward: referral % not found', p_referral_id;
  END IF;
  IF v_org_id IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'resolve_customer_referral_reward: referral is not in your organization';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'resolve_customer_referral_reward: referral % is not pending', p_referral_id;
  END IF;

  UPDATE public.customer_referrals
     SET reward_type             = p_reward_type,
         requested_reward_amount = p_reward_amount,
         reward_catalog_id       = NULL,
         reward_label            = NULL
   WHERE id = p_referral_id;

  -- Wallet: staff-entered amount wins; fall back to the org-wide default.
  v_amount := p_reward_amount;
  IF v_amount IS NULL THEN
    SELECT referral_reward_amount INTO v_amount FROM public.organizations WHERE id = v_org_id;
  END IF;

  IF v_amount IS NULL OR v_amount = 0 THEN
    UPDATE public.customer_referrals
       SET reward_status = 'credited',
           reward_amount = 0,
           credited_at   = now(),
           credited_by   = auth.uid()
     WHERE id = p_referral_id;
    RETURN p_referral_id;
  END IF;

  INSERT INTO public.customer_referral_credits (org_id, referral_id, customer_id, amount)
  VALUES (v_org_id, p_referral_id, v_referrer, v_amount)
  RETURNING id INTO v_credit_id;

  UPDATE public.customer_referrals
     SET reward_status = 'credited',
         reward_amount = v_amount,
         credited_at   = now(),
         credited_by   = auth.uid()
   WHERE id = p_referral_id;

  RETURN v_credit_id;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_customer_referral_reward(uuid, text, numeric, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_customer_referral_reward(uuid, text, numeric, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_customer_referral_reward(uuid, text, numeric, uuid) TO authenticated;

-- ============================================================
-- MIGRATION 071 COMPLETE
-- ============================================================
