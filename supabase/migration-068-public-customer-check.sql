-- Migration 068: public "is this phone already a customer?" existence check
-- (additive, REVERSIBLE)
--
-- The customer-to-customer referral program (migrations 058/062-065/067) already only
-- pays a reward when the referred person is a genuinely NEW customer -- createBooking()
-- silently checks find_customer_for_booking()'s result before calling
-- record_customer_referral()/public_record_customer_referral(). That check is invisible
-- until submission: neither the public booking form nor staff have any live signal that
-- an entered phone already belongs to an existing customer, so a referral can be quietly
-- dropped with no explanation.
--
-- This adds ONE new anon-safe RPC so the public booking flow (unauthenticated `anon`
-- role, no session) can show a live notice as the customer types their phone number --
-- "looks like you're already a customer" -- purely informational. It does not change
-- any reward-eligibility logic.
--
-- Deliberately returns a boolean ONLY -- no id, no name, not even the masked display
-- name public_lookup_referrer_by_phone (migration-067) returns -- since this check
-- doesn't need to identify who the phone belongs to, just whether it's known. Same
-- security posture as migration-067's anon-safe RPCs: org resolved by slug, active-only,
-- SECURITY DEFINER with search_path locked.
--
-- Idempotent: CREATE OR REPLACE FUNCTION, REVOKE/GRANT re-runnable, ON CONFLICT DO NOTHING.
-- Portable: no hardcoded UUIDs; org resolved by slug.
--
-- Reversible (manual):
--   DROP FUNCTION IF EXISTS public.public_check_customer_exists(text, text);

CREATE OR REPLACE FUNCTION public.public_check_customer_exists(
  p_org_slug text,
  p_phone    text
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.customers c
    JOIN public.organizations o ON o.id = c.org_id
    WHERE o.slug = p_org_slug
      AND o.is_active = true
      AND c.is_active = true
      AND c.phone = p_phone
  );
$$;

REVOKE ALL ON FUNCTION public.public_check_customer_exists(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_check_customer_exists(text, text) TO anon;

INSERT INTO public.schema_migrations (version, name)
VALUES ('068', 'public-customer-check')
ON CONFLICT (version) DO NOTHING;
