-- Migration 070: simplify referral reward types to Wallet + Gift Voucher only (additive, REVERSIBLE)
--
-- migration-068/069 introduced three reward types (wallet / gift_card / voucher). Product
-- decision: collapse gift_card and voucher into a single "Gift Voucher" option (stored as
-- 'voucher') so staff only ever choose between Wallet (free amount) and Gift Voucher
-- (catalog dropdown). Any existing 'gift_card' rows are remapped to 'voucher' before the
-- CHECK constraints are tightened.
--
-- Safe to re-run.
--
-- ROLLBACK: re-run migration-069-reward-catalog.sql's constraint/function definitions to
-- restore the three-way ('wallet','gift_card','voucher') check.

-- ============================================================
-- 1. Remap existing 'gift_card' data to 'voucher'
-- ============================================================

UPDATE public.reward_catalog SET reward_type = 'voucher' WHERE reward_type = 'gift_card';
UPDATE public.customer_referrals SET reward_type = 'voucher' WHERE reward_type = 'gift_card';

-- ============================================================
-- 2. Tighten CHECK constraints to (wallet, voucher) only
-- ============================================================

ALTER TABLE public.reward_catalog DROP CONSTRAINT IF EXISTS reward_catalog_reward_type_check;
ALTER TABLE public.reward_catalog
  ADD CONSTRAINT reward_catalog_reward_type_check CHECK (reward_type IN ('voucher'));

ALTER TABLE public.customer_referrals DROP CONSTRAINT IF EXISTS customer_referrals_reward_type_check;
ALTER TABLE public.customer_referrals
  ADD CONSTRAINT customer_referrals_reward_type_check CHECK (reward_type IN ('wallet', 'voucher'));

-- ============================================================
-- 3. record_customer_referral — validate against the 2-way set
-- ============================================================

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
  v_catalog_org  uuid;
  v_catalog_type text;
  v_catalog_name text;
  v_catalog_value numeric(12,2);
BEGIN
  IF v_caller_org IS NULL THEN
    RAISE EXCEPTION 'record_customer_referral: caller has no organization';
  END IF;

  IF p_referring_customer_id = p_referred_customer_id THEN
    RAISE EXCEPTION 'record_customer_referral: a customer cannot refer themselves';
  END IF;

  IF p_reward_type NOT IN ('wallet', 'voucher') THEN
    RAISE EXCEPTION 'record_customer_referral: invalid reward_type %', p_reward_type;
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

  IF p_reward_catalog_id IS NOT NULL THEN
    SELECT org_id, reward_type, name, value
      INTO v_catalog_org, v_catalog_type, v_catalog_name, v_catalog_value
    FROM public.reward_catalog
    WHERE id = p_reward_catalog_id;

    IF v_catalog_org IS NULL THEN
      RAISE EXCEPTION 'record_customer_referral: reward catalog item % not found', p_reward_catalog_id;
    END IF;
    IF v_catalog_org IS DISTINCT FROM v_caller_org THEN
      RAISE EXCEPTION 'record_customer_referral: reward catalog item is not in your organization';
    END IF;
    IF v_catalog_type IS DISTINCT FROM p_reward_type THEN
      RAISE EXCEPTION 'record_customer_referral: reward catalog item type does not match reward_type';
    END IF;
  END IF;

  INSERT INTO public.customer_referrals
    (org_id, referring_customer_id, referred_customer_id, booking_id, created_by, notes,
     reward_type, requested_reward_amount, reward_catalog_id, reward_label)
  VALUES
    (v_caller_org, p_referring_customer_id, p_referred_customer_id, p_booking_id, auth.uid(), p_notes,
     p_reward_type, COALESCE(p_reward_amount, v_catalog_value), p_reward_catalog_id, v_catalog_name)
  RETURNING id INTO v_referral_id;

  RETURN v_referral_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_customer_referral(uuid, uuid, uuid, text, text, numeric, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_customer_referral(uuid, uuid, uuid, text, text, numeric, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_customer_referral(uuid, uuid, uuid, text, text, numeric, uuid) TO authenticated;

-- ============================================================
-- 4. credit_pending_referral_for_booking — 'gift_card' branch collapses to 'voucher'
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
  v_booking_status booking_status;
  v_amount        numeric(12,2);
  v_credit_id     uuid;
BEGIN
  SELECT id, org_id, referring_customer_id, reward_status, reward_type, requested_reward_amount
    INTO v_referral_id, v_org_id, v_referrer, v_status, v_reward_type, v_requested
  FROM public.customer_referrals
  WHERE booking_id = p_booking_id
  FOR UPDATE;

  IF v_referral_id IS NULL THEN
    RETURN NULL; -- no referral attached to this booking; normal case
  END IF;

  IF v_status <> 'pending' THEN
    RETURN NULL; -- already credited or voided; idempotent no-op
  END IF;

  SELECT status INTO v_booking_status FROM public.bookings WHERE id = p_booking_id;
  IF v_booking_status IS DISTINCT FROM 'Completed' THEN
    RAISE EXCEPTION 'credit_pending_referral_for_booking: booking % is not Completed', p_booking_id;
  END IF;

  -- Gift Voucher rewards are fulfilled by staff outside the system — mark credited for
  -- reporting, but never touch the wallet ledger.
  IF v_reward_type = 'voucher' THEN
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
-- 5. Record migration
-- ============================================================

INSERT INTO public.schema_migrations (version, name)
VALUES ('070', 'simplify-reward-types') ON CONFLICT (version) DO NOTHING;
