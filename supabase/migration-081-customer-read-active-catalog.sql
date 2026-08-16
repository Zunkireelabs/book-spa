-- Migration 081: let logged-in customers read the same active-catalog data
-- anonymous visitors already can (services/therapists/rooms).
--
-- These three tables each had two SELECT policies: "Anonymous can read
-- active X" (TO anon, USING is_active = true) and "Users can read own org X"
-- (TO authenticated, USING org_id = get_user_org_id()). get_user_org_id()
-- resolves via the staff `users` table -- a logged-in customer session is
-- `authenticated` but has no `users` row, so it falls into neither policy.
-- Effect: getCustomerBookingHistory()'s service/therapist/room embeds
-- silently returned null under RLS, rendering as "Unknown Service" etc. on
-- the customer /account page, even though the booking itself had a valid
-- service_id.
--
-- Fix: broaden the existing anon-only policies to also cover `authenticated`
-- -- same USING clause, same data (is_active = true, no org scoping), just
-- available to both roles. This is the same public-read posture booking
-- creation already relies on for anonymous customers; logged-in customers
-- should see no less.
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY.
--
-- Reversible (manual): re-create each policy with `TO anon` only.

BEGIN;

DROP POLICY IF EXISTS "Anonymous can read active services" ON public.services;
CREATE POLICY "Anonymous can read active services" ON public.services
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "Anonymous can read active therapists" ON public.therapists;
CREATE POLICY "Anonymous can read active therapists" ON public.therapists
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "Anonymous can read active rooms" ON public.rooms;
CREATE POLICY "Anonymous can read active rooms" ON public.rooms
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

INSERT INTO public.schema_migrations (version, name)
VALUES ('081', 'customer-read-active-catalog')
ON CONFLICT (version) DO NOTHING;

COMMIT;
