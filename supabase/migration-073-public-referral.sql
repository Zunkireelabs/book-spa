-- Migration 073: public referral source picker + staff-decided reward
-- (additive + one security fix, REVERSIBLE)
--
-- Adds a customer-facing "how were you referred" picker to the public booking flow
-- (/:orgSlug/book, unauthenticated `anon` role): Client (an existing customer — name +
-- phone), Social Media (Facebook/Instagram/TikTok/Other), or Staff (a name, free text).
--
-- Only the Client source is reward-eligible, and the reward is never auto-decided —
-- a manager/admin picks Wallet or Voucher later, from the booking's action modal.
-- Social Media / Staff are purely informational (tracked on the booking row, no
-- reward pipeline). This reuses the existing customer-to-customer referral program
-- (customer_referrals table, migrations 063/067/068) for the Client/reward path —
-- it does NOT introduce a new reward ledger.
--
-- While building this we found migration-008 gave `anon` UNCONDITIONAL SELECT on the
-- entire `customers` table ("anon_select_customers", USING (true)) — no org scoping.
-- The app only ever filtered by org_id client-side; RLS never enforced it, so any
-- unauthenticated client could already dump every customer (name/phone/email/gender)
-- across every tenant. This migration closes that policy entirely and replaces the
-- one legitimate anon use of it (createBooking's existing-customer-by-phone/email
-- dedup check) with a narrow SECURITY DEFINER RPC.
--
-- Schema additions:
--   - bookings.referral_source          text CHECK IN ('client','social_media','staff')
--   - bookings.referral_source_detail   text  -- free-form: name+phone / platform / staff name
--   - customer_referrals.requires_manual_reward  boolean NOT NULL DEFAULT false
--     Set true only by public_record_customer_referral (below). This is what stops
--     credit_pending_referral_for_booking's existing auto-credit-on-Completion from
--     silently applying the 'wallet' placeholder to a self-service referral — it now
--     skips (no-ops) any row with requires_manual_reward = true, leaving it 'pending'
--     until a manager/admin explicitly resolves it via resolve_customer_referral_reward.
--     Staff-logged referrals (StaffBookingForm.jsx -> record_customer_referral) are
--     unaffected: requires_manual_reward stays false there, auto-credit keeps working
--     exactly as before.
--
-- Five SECURITY DEFINER RPCs, `search_path` locked to 'public':
--   1. find_customer_for_booking       — anon+authenticated. Exact org+phone/email
--      match only. Replaces the raw SELECT createBooking used for dedup.
--   2. public_lookup_referrer_by_phone — anon only. Exact org(by slug)+phone match,
--      active customers only, returns a MASKED name (first name + last initial) —
--      never full name/email/phone. No match = empty set, not an error.
--   3. public_record_customer_referral — anon only. Mirrors record_customer_referral's
--      validation but resolves org from p_org_slug (no session exists for `anon`),
--      always sets requires_manual_reward = true. reward_type/reward_status are just
--      the table's NOT NULL DEFAULTs ('wallet'/'pending') — placeholders, not a real
--      decision; see requires_manual_reward above.
--   4. credit_pending_referral_for_booking (CREATE OR REPLACE, existing function) —
--      adds one guard: skips rows with requires_manual_reward = true.
--   5. resolve_customer_referral_reward — authenticated, manager/admin only. Lets
--      staff explicitly pick Wallet or Voucher for a pending Client referral and
--      credits it immediately (no booking-status gate — the manager/admin's explicit
--      choice is the authorization).
--
-- Idempotent: DROP POLICY IF EXISTS, CREATE OR REPLACE FUNCTION, guarded ALTER TABLE
-- ADD COLUMN. Portable: no hardcoded UUIDs; org resolved by slug.
--
-- NOTE: anon_select_bookings (migration-008) has the identical unscoped USING (true)
-- problem on `bookings`. Not touched by this migration — flagged as a follow-up.
--
-- Reversible (manual):
--   DROP FUNCTION IF EXISTS public.resolve_customer_referral_reward(uuid, text, numeric, uuid);
--   DROP FUNCTION IF EXISTS public.public_record_customer_referral(text, uuid, uuid, uuid);
--   DROP FUNCTION IF EXISTS public.public_lookup_referrer_by_phone(text, text);
--   DROP FUNCTION IF EXISTS public.find_customer_for_booking(uuid, text, text);
--   ALTER TABLE public.customer_referrals DROP COLUMN IF EXISTS requires_manual_reward;
--   ALTER TABLE public.bookings DROP COLUMN IF EXISTS referral_source;
--   ALTER TABLE public.bookings DROP COLUMN IF EXISTS referral_source_detail;
--   -- then restore credit_pending_referral_for_booking from migration-069-reward-catalog.sql
--   CREATE POLICY "anon_select_customers" ON public.customers FOR SELECT TO anon USING (true);

-- ============================================================
-- 1. Close the hole: anon no longer gets raw SELECT on customers
-- ============================================================

DROP POLICY IF EXISTS "anon_select_customers" ON public.customers;

-- ============================================================
-- 2. Schema additions
-- ============================================================

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS referral_source text
    CHECK (referral_source IS NULL OR referral_source IN ('client', 'social_media', 'staff'));

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS referral_source_detail text;

ALTER TABLE public.customer_referrals
  ADD COLUMN IF NOT EXISTS requires_manual_reward boolean NOT NULL DEFAULT false;

-- ============================================================
-- 3. find_customer_for_booking — anon-safe replacement for the
--    dedup SELECT createBooking used to run directly against customers
-- ============================================================

CREATE OR REPLACE FUNCTION public.find_customer_for_booking(
  p_org_id uuid,
  p_phone  text DEFAULT NULL,
  p_email  text DEFAULT NULL
)
RETURNS TABLE (id uuid, gender text)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
  SELECT c.id, c.gender
  FROM public.customers c
  WHERE c.org_id = p_org_id
    AND (
      (p_phone IS NOT NULL AND c.phone = p_phone)
      OR (p_email IS NOT NULL AND c.email = p_email)
    )
  ORDER BY (c.phone = p_phone) DESC NULLS LAST
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.find_customer_for_booking(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_customer_for_booking(uuid, text, text) TO anon, authenticated;

-- ============================================================
-- 4. public_lookup_referrer_by_phone — anon, exact match, masked result
-- ============================================================

CREATE OR REPLACE FUNCTION public.public_lookup_referrer_by_phone(
  p_org_slug text,
  p_phone    text
)
RETURNS TABLE (id uuid, display_name text)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
  SELECT
    c.id,
    trim(
      split_part(c.full_name, ' ', 1)
      || CASE
           WHEN position(' ' in trim(c.full_name)) > 0
             THEN ' ' || left(trim(split_part(c.full_name, ' ', 2)), 1) || '.'
           ELSE ''
         END
    ) AS display_name
  FROM public.customers c
  JOIN public.organizations o ON o.id = c.org_id
  WHERE o.slug = p_org_slug
    AND o.is_active = true
    AND c.is_active = true
    AND c.phone = p_phone
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.public_lookup_referrer_by_phone(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_lookup_referrer_by_phone(text, text) TO anon;

-- ============================================================
-- 5. public_record_customer_referral — anon-safe variant of
--    record_customer_referral, org resolved from slug, always pending +
--    requires_manual_reward (no auto reward decision)
-- ============================================================

CREATE OR REPLACE FUNCTION public.public_record_customer_referral(
  p_org_slug              text,
  p_referring_customer_id uuid,
  p_referred_customer_id  uuid,
  p_booking_id            uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_org       uuid;
  v_referrer_org     uuid;
  v_referred_org     uuid;
  v_booking_customer uuid;
  v_booking_org      uuid;
  v_referral_id      uuid;
BEGIN
  SELECT id INTO v_caller_org
  FROM public.organizations
  WHERE slug = p_org_slug AND is_active = true;

  IF v_caller_org IS NULL THEN
    RAISE EXCEPTION 'public_record_customer_referral: organization % not found', p_org_slug;
  END IF;

  IF p_referring_customer_id = p_referred_customer_id THEN
    RAISE EXCEPTION 'public_record_customer_referral: a customer cannot refer themselves';
  END IF;

  SELECT org_id INTO v_referrer_org FROM public.customers WHERE id = p_referring_customer_id;
  SELECT org_id INTO v_referred_org FROM public.customers WHERE id = p_referred_customer_id;

  IF v_referrer_org IS NULL THEN
    RAISE EXCEPTION 'public_record_customer_referral: referring customer % not found', p_referring_customer_id;
  END IF;
  IF v_referred_org IS NULL THEN
    RAISE EXCEPTION 'public_record_customer_referral: referred customer % not found', p_referred_customer_id;
  END IF;
  IF v_referrer_org IS DISTINCT FROM v_caller_org OR v_referred_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'public_record_customer_referral: customers must be in this organization';
  END IF;

  SELECT b.customer_id, br.org_id
    INTO v_booking_customer, v_booking_org
  FROM public.bookings b
  JOIN public.branches br ON br.id = b.branch_id
  WHERE b.id = p_booking_id;

  IF v_booking_org IS NULL THEN
    RAISE EXCEPTION 'public_record_customer_referral: booking % not found', p_booking_id;
  END IF;
  IF v_booking_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'public_record_customer_referral: booking is not in this organization';
  END IF;
  IF v_booking_customer IS DISTINCT FROM p_referred_customer_id THEN
    RAISE EXCEPTION 'public_record_customer_referral: booking does not belong to the referred customer';
  END IF;

  IF EXISTS (SELECT 1 FROM public.customer_referrals WHERE referred_customer_id = p_referred_customer_id) THEN
    RAISE EXCEPTION 'public_record_customer_referral: this customer has already been referred once';
  END IF;

  INSERT INTO public.customer_referrals
    (org_id, referring_customer_id, referred_customer_id, booking_id, created_by, requires_manual_reward)
  VALUES
    (v_caller_org, p_referring_customer_id, p_referred_customer_id, p_booking_id, NULL, true)
  RETURNING id INTO v_referral_id;

  RETURN v_referral_id;
END;
$$;

REVOKE ALL ON FUNCTION public.public_record_customer_referral(text, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_record_customer_referral(text, uuid, uuid, uuid) TO anon;

-- ============================================================
-- 6. credit_pending_referral_for_booking — skip rows the customer flow
--    flagged as requiring a manual staff decision
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

  SELECT status INTO v_booking_status FROM public.bookings WHERE id = p_booking_id;
  IF v_booking_status IS DISTINCT FROM 'Completed' THEN
    RAISE EXCEPTION 'credit_pending_referral_for_booking: booking % is not Completed', p_booking_id;
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
-- 7. resolve_customer_referral_reward — manager/admin explicitly picks
--    Wallet or Voucher for a pending Client referral, credits immediately
-- ============================================================

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
  v_catalog_org   uuid;
  v_catalog_type  text;
  v_catalog_name  text;
  v_catalog_value numeric(12,2);
  v_amount        numeric(12,2);
  v_credit_id     uuid;
BEGIN
  IF v_caller_org IS NULL THEN
    RAISE EXCEPTION 'resolve_customer_referral_reward: caller has no organization';
  END IF;
  IF v_caller_role NOT IN ('manager', 'admin') THEN
    RAISE EXCEPTION 'resolve_customer_referral_reward: manager or admin only';
  END IF;
  IF p_reward_type NOT IN ('wallet', 'voucher') THEN
    RAISE EXCEPTION 'resolve_customer_referral_reward: invalid reward_type %', p_reward_type;
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

  IF p_reward_catalog_id IS NOT NULL THEN
    SELECT org_id, reward_type, name, value
      INTO v_catalog_org, v_catalog_type, v_catalog_name, v_catalog_value
    FROM public.reward_catalog
    WHERE id = p_reward_catalog_id;

    IF v_catalog_org IS NULL THEN
      RAISE EXCEPTION 'resolve_customer_referral_reward: reward catalog item % not found', p_reward_catalog_id;
    END IF;
    IF v_catalog_org IS DISTINCT FROM v_caller_org THEN
      RAISE EXCEPTION 'resolve_customer_referral_reward: reward catalog item is not in your organization';
    END IF;
    IF v_catalog_type IS DISTINCT FROM p_reward_type THEN
      RAISE EXCEPTION 'resolve_customer_referral_reward: reward catalog item type does not match reward_type';
    END IF;
  END IF;

  UPDATE public.customer_referrals
     SET reward_type             = p_reward_type,
         requested_reward_amount = COALESCE(p_reward_amount, v_catalog_value),
         reward_catalog_id       = p_reward_catalog_id,
         reward_label            = v_catalog_name
   WHERE id = p_referral_id;

  -- Voucher: fulfilled by staff outside the system — mark credited for reporting,
  -- never touches the wallet ledger.
  IF p_reward_type = 'voucher' THEN
    UPDATE public.customer_referrals
       SET reward_status = 'credited',
           reward_amount = COALESCE(p_reward_amount, v_catalog_value),
           credited_at   = now(),
           credited_by   = auth.uid()
     WHERE id = p_referral_id;
    RETURN p_referral_id;
  END IF;

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
-- 8. Record migration
-- ============================================================

INSERT INTO public.schema_migrations (version, name)
VALUES ('073', 'public-referral') ON CONFLICT (version) DO NOTHING;
