-- Migration 208: get_active_campaign_discount_percent() org-scoped
-- (additive, REVERSIBLE)
--
-- Second half of the cross-org campaign leak fix (see migration-207's
-- header for the full finding). migration-207 stops new bad links from
-- being written; this stops the pricing calculation itself from ever
-- crossing an org boundary regardless — defense in depth, matching the
-- same "fix at both the write-time guard and the shared calculation
-- layer" approach migration-206 already used for the fixed-offer-price
-- bug, not just a write-time guard alone.
--
-- p_org_id is a REQUIRED third parameter (no default) — deliberately, so
-- a caller that forgets to pass it fails to compile/run loudly (function
-- signature mismatch) instead of silently reverting to the unscoped,
-- leaky behavior. All 3 existing callers (services_with_offer_pricing —
-- migration-209, public_get_services — migration-210,
-- public_get_bookable_services — migration-211) are updated in lockstep.
--
-- DROP FUNCTION first: the parameter list is changing (2 args -> 3), not
-- just the return shape, so CREATE OR REPLACE alone isn't enough — same
-- lesson migration-197's header already documents for RETURNS TABLE
-- changes, extended here to parameter-list changes too.
--
-- Idempotent: DROP FUNCTION IF EXISTS + CREATE FUNCTION. Portable: no
-- hardcoded UUIDs.
--
-- Reversible (manual): re-apply migration-200's CREATE OR REPLACE
-- FUNCTION body verbatim (after a DROP FUNCTION on the 3-arg signature)
-- to drop the org scoping.

DROP FUNCTION IF EXISTS public.get_active_campaign_discount_percent(uuid, uuid);

CREATE OR REPLACE FUNCTION public.get_active_campaign_discount_percent(
  p_service_id  uuid,
  p_category_id uuid,
  p_org_id      uuid
)
RETURNS TABLE (
  discount_percent numeric,
  campaign_name     text
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT c.discount_percent, c.name
  FROM public.campaigns c
  WHERE c.is_active = true
    AND c.org_id = p_org_id
    AND CURRENT_DATE BETWEEN c.start_date AND c.end_date
    AND (
      EXISTS (SELECT 1 FROM public.campaign_services cs WHERE cs.campaign_id = c.id AND cs.service_id = p_service_id)
      OR (p_category_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.campaign_categories cc WHERE cc.campaign_id = c.id AND cc.category_id = p_category_id
      ))
    )
  ORDER BY
    -- direct service link outranks a category-only link
    (EXISTS (SELECT 1 FROM public.campaign_services cs WHERE cs.campaign_id = c.id AND cs.service_id = p_service_id)) DESC,
    c.end_date ASC
  LIMIT 1;
$$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('208', 'campaign-discount-org-scoped')
ON CONFLICT (version) DO NOTHING;
