-- Migration 136: public customer-match lookup (name + phone/email), gated by name match
--
-- Root cause of the 171 duplicate-customer pairs found on production (migration-135): the
-- public booking flow's checkExistingCustomerByPhone (migration-074) only ever returns a
-- boolean, never the actual matching record, so a returning customer typing their phone in
-- slightly different formats each visit silently creates a new row instead of being offered
-- their saved profile.
--
-- This RPC lets the public flow surface the actual match and let the visitor confirm/
-- auto-fill from it — but the public flow is unauthenticated (anon role), so a naive
-- "return full customer record for any phone/email" RPC is a PII-enumeration risk (anyone
-- could probe phone numbers or emails to learn who is a customer, by name). Mitigation
-- (confirmed by user): only return a match when the visitor-provided NAME also loosely
-- matches (case-insensitive, trimmed) the stored full_name for that phone/email — same
-- gating shape CustomerForm.jsx's existing maybeCheckExistingCustomer already uses (both
-- fields must be filled before any check happens at all). Any mismatch returns nothing,
-- not a partial/near-match result — erring strict keeps the enumeration surface small.
--
-- Idempotent: CREATE OR REPLACE FUNCTION, REVOKE/GRANT re-runnable.
-- Portable: no hardcoded UUIDs; org resolved by slug.
--
-- Reversible (manual):
--   DROP FUNCTION IF EXISTS public.public_find_customer_match(text, text, text, text);

CREATE OR REPLACE FUNCTION public.public_find_customer_match(
  p_org_slug text,
  p_name     text,
  p_phone    text DEFAULT NULL,
  p_email    text DEFAULT NULL
)
RETURNS TABLE (
  customer_id   uuid,
  full_name     text,
  gender        text,
  date_of_birth date
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
  SELECT c.id, c.full_name, c.gender, c.date_of_birth
  FROM public.customers c
  JOIN public.organizations o ON o.id = c.org_id
  WHERE o.slug = p_org_slug
    AND o.is_active = true
    AND c.is_active = true
    AND lower(btrim(c.full_name)) = lower(btrim(coalesce(p_name, '')))
    AND btrim(coalesce(p_name, '')) <> ''
    AND (
      (p_phone IS NOT NULL AND c.phone = p_phone)
      OR (p_email IS NOT NULL AND lower(btrim(c.email)) = lower(btrim(p_email)))
    )
  ORDER BY c.created_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.public_find_customer_match(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_find_customer_match(text, text, text, text) TO anon;

INSERT INTO public.schema_migrations (version, name)
VALUES ('136', 'public-customer-match')
ON CONFLICT (version) DO NOTHING;
