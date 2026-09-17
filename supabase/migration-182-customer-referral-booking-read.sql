-- Migration 182: let a referring customer see the single booking that
-- earned each of their referral rewards (service name + date), for the
-- "which service did my referral use" detail on the /account referral
-- popup.
--
-- customer_referrals.booking_id points at the REFERRED friend's booking,
-- not the referring customer's own — so the existing "customer reads own
-- bookings" policy (scoped to the caller's own customer_account_id) never
-- matches it, and an embedded `booking:bookings(...)` select on
-- customer_referrals silently comes back null under RLS.
--
-- This adds a narrow, separate policy that only exposes a booking row when
-- it is specifically the reward-triggering (or reward-redemption) booking
-- of one of the caller's own referrals — not any other booking belonging to
-- the referred friend. Scope is deliberately minimal: this is the one piece
-- of the friend's activity the referral program is already built to surface
-- to the referrer (it's what earned them the reward), not a general
-- cross-customer booking read.
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY.
-- Portable: no hardcoded UUIDs.
--
-- Reversible (manual):
--   DROP POLICY IF EXISTS "customer reads own referral-linked bookings" ON public.bookings;

BEGIN;

DROP POLICY IF EXISTS "customer reads own referral-linked bookings" ON public.bookings;
CREATE POLICY "customer reads own referral-linked bookings" ON public.bookings
  FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT cr.booking_id FROM public.customer_referrals cr
      WHERE cr.referring_customer_id IN (
        SELECT customer_id FROM public.customer_accounts
        WHERE auth_user_id = auth.uid() AND customer_id IS NOT NULL
      )
      UNION
      SELECT cr.redeemed_booking_id FROM public.customer_referrals cr
      WHERE cr.redeemed_booking_id IS NOT NULL
        AND cr.referring_customer_id IN (
          SELECT customer_id FROM public.customer_accounts
          WHERE auth_user_id = auth.uid() AND customer_id IS NOT NULL
        )
    )
  );

INSERT INTO public.schema_migrations (version, name)
VALUES ('182', 'customer-referral-booking-read')
ON CONFLICT (version) DO NOTHING;

COMMIT;
