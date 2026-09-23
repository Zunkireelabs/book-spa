-- Migration 205: public_get_bookable_services() (additive, REVERSIBLE)
--
-- Zenly's own customer booking flow (/:orgSlug/book, fully public/anon —
-- see Routes.jsx) currently fetches services via a direct anon SELECT on
-- the plain `services` table (fetchServicesByOrgId in api.js), so it never
-- picks up offer pricing (migrations 193-197) or campaign discounts
-- (migrations 198-204) — those only reached the dashboard
-- (services_with_offer_pricing view) and the separate nuadthainepal.com
-- marketing site (public_get_services, migration-184/197/202). This closes
-- that gap for Zenly's own booking flow specifically.
--
-- Deliberately NOT a change to public_get_services itself: that RPC's
-- migration-184 comment is an explicit, tested design decision to never
-- expose internal fields (service id, org_id, image_url) to the fully
-- external, unauthenticated marketing site. Zenly's booking flow is a
-- different consumer with a different, legitimate need — it must create a
-- real booking afterward, which requires the actual service id — so this
-- is a separate, purpose-built RPC rather than loosening that contract.
--
-- Same SECURITY DEFINER + org-by-slug pattern as public_get_services /
-- public_get_active_campaign, for the same reason: the customer flow runs
-- fully anonymous (no session), so the campaign lookup
-- (get_active_campaign_discount_percent) — which itself queries
-- campaigns/campaign_services/campaign_categories, all under strict
-- org-scoped RLS keyed off get_user_org_id() — would silently see zero
-- rows for an anon caller without a SECURITY DEFINER function running the
-- whole lookup chain as the function owner instead.
--
-- Same body as public_get_services' campaign-aware version
-- (migration-202) plus two trailing-safe-to-prepend columns since this is
-- a brand new function (no existing consumers to preserve column
-- order/shape for): id and image_url, both needed by the booking flow's
-- existing UI (service selection + create-booking payload).
--
-- Idempotent: CREATE OR REPLACE FUNCTION, REVOKE/GRANT re-runnable.
-- Portable: no hardcoded UUIDs; org resolved by slug.
--
-- Reversible (manual):
--   DROP FUNCTION IF EXISTS public.public_get_bookable_services(text);

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
  LEFT JOIN LATERAL public.get_active_campaign_discount_percent(s.id, sc.id) camp ON true
  WHERE o.slug = p_org_slug
    AND o.is_active = true
    AND s.is_active = true
  ORDER BY category_display_order, s.category, s.name;
$$;

REVOKE ALL ON FUNCTION public.public_get_bookable_services(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_get_bookable_services(text) TO anon;

INSERT INTO public.schema_migrations (version, name)
VALUES ('205', 'public-bookable-services')
ON CONFLICT (version) DO NOTHING;
