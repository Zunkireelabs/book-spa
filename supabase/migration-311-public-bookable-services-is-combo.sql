-- Migration 311: public_get_bookable_services() returns is_combo (additive, REVERSIBLE)
--
-- ZNLY-182: the online booking flow (provider-profile-flow -> BookingConfirmation)
-- needs to know whether the selected service is a combo, to decide whether to write
-- per-component booking_combo_items rows (migration-310). The services list it
-- actually renders from comes from public_get_bookable_services() (migration-205/211),
-- which never returned is_combo — unlike the staff-authenticated fetchServices()
-- (services/api.js, services_with_offer_pricing view), is_combo was simply never
-- plumbed through this particular RPC. Appends it as a new trailing column — safe
-- with CREATE OR REPLACE since it's added at the end of RETURNS TABLE, not inserted
-- or reordered.
--
-- Reversible (manual): re-apply migration-211's CREATE OR REPLACE FUNCTION body
-- verbatim (drops is_combo back out).
--
-- Postgres rejects CREATE OR REPLACE when RETURNS TABLE's column set changes, even
-- to append a trailing column ("cannot change return type of existing function") —
-- DROP FUNCTION first, same as this file's own reversal instructions above.
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
  is_combo                boolean
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
    s.is_combo
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
GRANT EXECUTE ON FUNCTION public.public_get_bookable_services(text) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('311', 'public-bookable-services-is-combo')
ON CONFLICT (version) DO NOTHING;
