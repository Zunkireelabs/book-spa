-- Migration 068: gift card / voucher reward catalog (additive, REVERSIBLE)
--
-- Extends migration-067's referral reward_type (wallet / gift_card / voucher). Wallet rewards
-- take a free-typed amount; gift_card and voucher rewards instead pick from a small
-- org-managed catalog (e.g. "NPR 500 Gift Card", "Free Facial Voucher") so staff logging a
-- referral choose from a dropdown instead of typing free text. Manager+admin manage the
-- catalog (same posture as migration-049's services write policy); all staff can read it
-- org-wide to populate the dropdown.
--
-- Safe to re-run.
--
-- ROLLBACK:
--   ALTER TABLE public.customer_referrals DROP COLUMN IF EXISTS reward_catalog_id;
--   ALTER TABLE public.customer_referrals DROP COLUMN IF EXISTS reward_label;
--   DROP TABLE IF EXISTS public.reward_catalog;
--   -- then restore record_customer_referral from migration-067-referral-reward-type.sql

-- ============================================================
-- 1. REWARD_CATALOG table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.reward_catalog (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  reward_type  text          NOT NULL CHECK (reward_type IN ('gift_card', 'voucher')),
  name         text          NOT NULL,
  value        numeric(12,2) CHECK (value IS NULL OR value >= 0),
  is_active    boolean       NOT NULL DEFAULT true,
  created_by   uuid          REFERENCES public.users(id),
  created_at   timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT reward_catalog_name_uniq UNIQUE (org_id, reward_type, name)
);

CREATE INDEX IF NOT EXISTS idx_reward_catalog_org_type_active
  ON public.reward_catalog(org_id, reward_type)
  WHERE is_active;

ALTER TABLE public.reward_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own org reward catalog" ON public.reward_catalog;
CREATE POLICY "Users can read own org reward catalog"
  ON public.reward_catalog FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id());

DROP POLICY IF EXISTS "Manager and admin can create org reward catalog" ON public.reward_catalog;
CREATE POLICY "Manager and admin can create org reward catalog"
  ON public.reward_catalog FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
    AND org_id = get_user_org_id()
  );

DROP POLICY IF EXISTS "Manager and admin can update org reward catalog" ON public.reward_catalog;
CREATE POLICY "Manager and admin can update org reward catalog"
  ON public.reward_catalog FOR UPDATE
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
    AND org_id = get_user_org_id()
  )
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
    AND org_id = get_user_org_id()
  );

DROP POLICY IF EXISTS "Manager and admin can delete org reward catalog" ON public.reward_catalog;
CREATE POLICY "Manager and admin can delete org reward catalog"
  ON public.reward_catalog FOR DELETE
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
    AND org_id = get_user_org_id()
  );

-- ============================================================
-- 2. CUSTOMER_REFERRALS: which catalog item was picked
-- ============================================================

ALTER TABLE public.customer_referrals
  ADD COLUMN IF NOT EXISTS reward_catalog_id uuid REFERENCES public.reward_catalog(id) ON DELETE SET NULL;

ALTER TABLE public.customer_referrals
  ADD COLUMN IF NOT EXISTS reward_label text;

-- ============================================================
-- 3. record_customer_referral — accept catalog selection
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

  IF p_reward_type NOT IN ('wallet', 'gift_card', 'voucher') THEN
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

-- Drop the migration-067 six-arg overload so callers can't accidentally hit the old
-- signature (which has no catalog awareness) via PostgREST function-name resolution.
DROP FUNCTION IF EXISTS public.record_customer_referral(uuid, uuid, uuid, text, text, numeric);

-- ============================================================
-- 4. Record migration
-- ============================================================

INSERT INTO public.schema_migrations (version, name)
VALUES ('068', 'reward-catalog') ON CONFLICT (version) DO NOTHING;
