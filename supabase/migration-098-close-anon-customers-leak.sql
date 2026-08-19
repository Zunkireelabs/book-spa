-- Migration 098: close anon cross-org customers leak (HOTFIX, REVERSIBLE)
--
-- migration-008 gave `anon` UNCONDITIONAL SELECT on the entire `customers`
-- table ("anon_select_customers", USING (true)) — no org scoping. Any
-- unauthenticated caller could dump every customer across every tenant:
-- name, phone, email, gender.
--
-- This is a standalone extraction of the fix migration-073 already applied
-- on `stage` (which bundled it together with the public-referral-picker
-- feature). Pulling just the security fix + its one dependent RPC out lets
-- it ship to `main` without waiting on the full referral migration chain
-- (067-071, 073, 077, 078, 082, 096), which is not yet reviewed for prod.
--
-- createBooking's customer dedup lookup (services/api.js) already calls
-- find_customer_for_booking instead of a raw SELECT — this migration is
-- what makes that RPC exist. Dropping the policy without it would silently
-- break dedup (customers would stop linking across repeat bookings; the
-- lookup is wrapped in a non-blocking try/catch, so bookings would still
-- succeed, just create a duplicate customer record each time).
--
-- Idempotent: DROP POLICY IF EXISTS, CREATE OR REPLACE FUNCTION. Safe to
-- apply even where migration-073 already ran (stage) — both define the
-- same objects identically, so 073 becomes a no-op re-apply there later.
--
-- Reversible (manual):
--   DROP FUNCTION IF EXISTS public.find_customer_for_booking(uuid, text, text);
--   CREATE POLICY "anon_select_customers" ON public.customers FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "anon_select_customers" ON public.customers;

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

INSERT INTO public.schema_migrations (version, name)
VALUES ('098', 'close-anon-customers-leak') ON CONFLICT (version) DO NOTHING;
