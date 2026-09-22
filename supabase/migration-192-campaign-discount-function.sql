-- Migration 192: get_active_campaign_discount_percent() (additive, REVERSIBLE)
--
-- The one function the whole campaigns feature hinges on. Given a service
-- (and its category), returns the discount percent from the
-- highest-priority currently-active campaign linked to it, or NULL if none
-- applies. "Currently active" = is_active = true AND CURRENT_DATE BETWEEN
-- start_date AND end_date — checked inline every call, no cron, matching
-- how vouchers/memberships already check their own date ranges at read
-- time (migration-095-voucher-expiry-check.sql) rather than a background
-- job flipping a status.
--
-- Priority (confirmed decision): a campaign linking the service directly
-- wins over one that only links the service's category. This function
-- deliberately does NOT consider the service's own manual offer or its
-- category's manual offer (migrations 185/186/187) — that comparison
-- happens one layer up, in services_with_offer_pricing (migration-193),
-- which prefers this function's result over compute_service_offer_pricing's
-- when both are available. Kept separate rather than folded into
-- compute_service_offer_pricing itself so that function (already shipped
-- and tested, migration-187) stays untouched.
--
-- If more than one active campaign links the same service (directly, or
-- via more than one of its... a service only has one category, so this can
-- only happen via two different campaigns both directly linking the same
-- service, or one directly + one via category) — picks the one ending
-- soonest, so the most imminent/specific promotion wins ties.
--
-- Idempotent: CREATE OR REPLACE FUNCTION. Portable: no hardcoded UUIDs.
--
-- Reversible (manual):
--   DROP FUNCTION IF EXISTS public.get_active_campaign_discount_percent(uuid, uuid);

CREATE OR REPLACE FUNCTION public.get_active_campaign_discount_percent(
  p_service_id  uuid,
  p_category_id uuid
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
VALUES ('192', 'campaign-discount-function')
ON CONFLICT (version) DO NOTHING;
