-- Migration 211: public_get_bookable_services() passes org_id to the
-- now-org-scoped campaign lookup (additive, REVERSIBLE)
--
-- Same fix as migration-209/210, for Zenly's own booking-flow RPC
-- (migration-205). Passes s.org_id as the new required third argument to
-- get_active_campaign_discount_percent() (migration-208). No RETURNS
-- TABLE change, so a plain CREATE OR REPLACE FUNCTION is enough.
--
-- Idempotent: CREATE OR REPLACE FUNCTION, REVOKE/GRANT re-runnable.
-- Portable: no hardcoded UUIDs; org resolved by slug.
--
-- Reversible (manual): re-apply migration-205's CREATE OR REPLACE
-- FUNCTION body verbatim (only safe once migration-208 is also reverted,
-- since the 2-arg function signature it calls would no longer exist
-- otherwise).

CREATE OR REPLACE FUNCTION public.public_get_bookable_services(
  p_org_slug text
)
RETURNS TABLE (
  id                      uuid,
  name                    text,
  duration_minutes        integer,
  price_npr               decimal(10,2),
  description             text,
  image_url               text,
  category_name           text,
  category_id             uuid,
  category_display_order  integer,
  effective_price_npr     numeric,
  is_on_offer             boolean,
  original_price_npr      numeric,
  active_campaign_name    text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
  SELECT
    s.id,
    s.name,
    s.duration_minutes,
    s.price_npr,
    s.description,
    s.image_url,
    s.category AS category_name,
    sc.id      AS category_id,
    COALESCE(sc.display_order, 2147483647) AS category_display_order,
    CASE
      WHEN camp.discount_percent IS NOT NULL THEN ROUND(s.price_npr * (1 - camp.discount_percent / 100.0), 2)
      ELSE p.effective_price_npr
    END AS effective_price_npr,
    (camp.discount_percent IS NOT NULL OR p.is_on_offer) AS is_on_offer,
    CASE
      WHEN camp.discount_percent IS NOT NULL THEN s.price_npr
      ELSE p.original_price_npr
    END AS original_price_npr,
    camp.campaign_name AS active_campaign_name
  FROM public.services s
  JOIN public.organizations o ON o.id = s.org_id
  LEFT JOIN public.service_categories sc
    ON sc.org_id = s.org_id
   AND sc.name = s.category
  CROSS JOIN LATERAL public.compute_service_offer_pricing(
    s.price_npr, s.offer_enabled, s.offer_type, s.offer_value,
    COALESCE(sc.offer_enabled, false), sc.offer_percent
  ) p
  LEFT JOIN LATERAL public.get_active_campaign_discount_percent(s.id, sc.id, s.org_id) camp ON true
  WHERE o.slug = p_org_slug
    AND o.is_active = true
    AND s.is_active = true
  ORDER BY category_display_order, s.category, s.name;
$$;

REVOKE ALL ON FUNCTION public.public_get_bookable_services(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_get_bookable_services(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.public_get_bookable_services(text) TO anon;

INSERT INTO public.schema_migrations (version, name)
VALUES ('211', 'public-bookable-services-campaign-org-scoped')
ON CONFLICT (version) DO NOTHING;
