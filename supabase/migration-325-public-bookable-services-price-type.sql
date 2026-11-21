-- Migration 325: public_get_bookable_services() returns price_type, min_price,
-- max_price (additive, REVERSIBLE)
--
-- The online booking flow (provider-profile-flow's ServicesSection) needs to know
-- how to price each service: calendar_only must show no price at all, and tiered
-- must show the "Rs 160 - 380" range the user asked for — neither is derivable
-- from price_npr alone, and this RPC (not services_with_offer_pricing) is what the
-- public flow actually reads from.
--
-- min_price/max_price reuse service_price_range(uuid) (migration-323) via a
-- LATERAL join rather than reimplementing the MIN/MAX — same "one place answers
-- this" reasoning as everywhere else tiered pricing touches. For a non-tiered
-- service these just equal price_npr, which is harmless (the UI only looks at
-- them when price_type = 'tiered').
--
-- Reversible (manual): re-apply migration-311's CREATE OR REPLACE FUNCTION body
-- verbatim (drops price_type/min_price/max_price back out).
--
-- Postgres rejects CREATE OR REPLACE when RETURNS TABLE's column set changes,
-- even to append trailing columns ("cannot change return type of existing
-- function") — DROP FUNCTION first, same as migration-311.

BEGIN;

DROP FUNCTION IF EXISTS public.public_get_bookable_services(text);

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
  active_campaign_name    text,
  is_combo                boolean,
  price_type              text,
  min_price               numeric,
  max_price               numeric
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
    camp.campaign_name AS active_campaign_name,
    s.is_combo,
    s.price_type,
    range.min_price,
    range.max_price
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
  CROSS JOIN LATERAL public.service_price_range(s.id) range
  WHERE o.slug = p_org_slug
    AND o.is_active = true
    AND s.is_active = true
  ORDER BY category_display_order, s.category, s.name;
$$;

REVOKE ALL ON FUNCTION public.public_get_bookable_services(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_get_bookable_services(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.public_get_bookable_services(text) TO anon;
GRANT EXECUTE ON FUNCTION public.public_get_bookable_services(text) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('325', 'public-bookable-services-price-type')
ON CONFLICT (version) DO NOTHING;

COMMIT;
