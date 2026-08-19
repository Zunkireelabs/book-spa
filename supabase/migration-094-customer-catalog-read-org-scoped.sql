-- Migration 094: let logged-in customers read active services/therapists/
-- rooms in their own org, without reopening the cross-org staff leak.
--
-- migration-081 tried to fix this (customer sessions are `authenticated` but
-- have no row in the staff `users` table, so get_user_org_id() resolves to
-- nothing and getCustomerBookingHistory()'s service/therapist/room embeds
-- come back null under RLS, rendering "Unknown Service" etc. on the customer
-- /account page) by widening the anon-only "Anonymous can read active X"
-- policies to `TO anon, authenticated`. That reopened the exact cross-org
-- leak fixed in migration-093 (any authenticated user, staff at any org
-- included, matches an org-unscoped policy) -- migration-093 correctly
-- restricted those policies back to `TO anon` only, which is right for the
-- staff leak but also silently took back 081's customer-facing fix, since
-- both migrations touch the same policy names.
--
-- Fix: don't touch the anon/staff policies at all. Add a separate,
-- org-scoped policy for customers, using the same pattern already used
-- correctly for vouchers/referrals in migration-082 ("customer reads own
-- org voucher types": org_id IN (SELECT org_id FROM customer_accounts WHERE
-- auth_user_id = auth.uid())).
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY.
-- Portable: no hardcoded UUIDs.
--
-- Reversible (manual):
--   DROP POLICY IF EXISTS "customer reads own org services" ON public.services;
--   DROP POLICY IF EXISTS "customer reads own org therapists" ON public.therapists;
--   DROP POLICY IF EXISTS "customer reads own org rooms" ON public.rooms;

BEGIN;

DROP POLICY IF EXISTS "customer reads own org services" ON public.services;
CREATE POLICY "customer reads own org services" ON public.services
  FOR SELECT
  TO authenticated
  USING (
    is_active = true
    AND org_id IN (SELECT org_id FROM public.customer_accounts WHERE auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "customer reads own org therapists" ON public.therapists;
CREATE POLICY "customer reads own org therapists" ON public.therapists
  FOR SELECT
  TO authenticated
  USING (
    is_active = true
    AND org_id IN (SELECT org_id FROM public.customer_accounts WHERE auth_user_id = auth.uid())
  );

-- rooms has no org_id column (only branch_id) — resolve org via branches.
DROP POLICY IF EXISTS "customer reads own org rooms" ON public.rooms;
CREATE POLICY "customer reads own org rooms" ON public.rooms
  FOR SELECT
  TO authenticated
  USING (
    is_active = true
    AND branch_id IN (
      SELECT b.id FROM public.branches b
      WHERE b.org_id IN (SELECT org_id FROM public.customer_accounts WHERE auth_user_id = auth.uid())
    )
  );

INSERT INTO public.schema_migrations (version, name)
VALUES ('094', 'customer-catalog-read-org-scoped')
ON CONFLICT (version) DO NOTHING;

COMMIT;
