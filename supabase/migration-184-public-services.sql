-- Migration 184: public "get active services" RPC for the marketing website
-- (additive, REVERSIBLE)
--
-- nuadthainepal.com (a separate static Next.js export, no server, no Supabase
-- integration today) currently hardcodes its service names/prices in
-- src/components/sections/ServicesSection.tsx and needs a manual code edit +
-- rebuild + redeploy every time Zenly's services change. This adds one
-- anon-safe RPC so the website can fetch live service data straight from
-- Zenly's database instead, matching the existing public-RPC pattern used by
-- the public booking flow (public_check_customer_exists, migration-074;
-- public_lookup_referrer_by_phone, migration-073): org resolved by slug,
-- active-only, SECURITY DEFINER with search_path locked, no session required.
--
-- Returns only what a public pricing page needs — name, duration, price,
-- description, and the service's category (id + name + display_order, so the
-- frontend can render stable tabs without re-shuffling when a category is
-- renamed). Never internal fields (service id, org_id, created_at, image_url).
--
-- Per the nuadthainepal.com frontend's confirmed shape decision: Zenly's data
-- model stays as-is (one row per duration/price, no variant grouping, no
-- addon/extra flag) — the website groups/flattens on its own side. Category
-- images and freeform per-category copy also stay entirely on the frontend,
-- keyed by the category id this RPC returns.
--
-- category_id/category_display_order come from service_categories, joined by
-- (org_id, name) since services.category is a free-text column, not an FK
-- (service_categories has no tracked CREATE TABLE migration — same drift
-- migration-066's comment describes for services.category/image_url — so
-- this joins defensively with a LEFT JOIN + COALESCE rather than assuming
-- every services.category value has a matching row).
--
-- Ordered by category display_order (uncategorized last) then name, for a
-- stable, predictable render order.
--
-- Idempotent: CREATE OR REPLACE FUNCTION, REVOKE/GRANT re-runnable.
-- Portable: no hardcoded UUIDs; org resolved by slug.
--
-- Reversible (manual):
--   DROP FUNCTION IF EXISTS public.public_get_services(text);

CREATE OR REPLACE FUNCTION public.public_get_services(
  p_org_slug text
)
RETURNS TABLE (
  name                    text,
  duration_minutes        integer,
  price_npr               decimal(10,2),
  description             text,
  category_name           text,
  category_id             uuid,
  category_display_order  integer
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
  SELECT
    s.name,
    s.duration_minutes,
    s.price_npr,
    s.description,
    s.category AS category_name,
    sc.id      AS category_id,
    COALESCE(sc.display_order, 2147483647) AS category_display_order
  FROM public.services s
  JOIN public.organizations o ON o.id = s.org_id
  LEFT JOIN public.service_categories sc
    ON sc.org_id = s.org_id
   AND sc.name = s.category
  WHERE o.slug = p_org_slug
    AND o.is_active = true
    AND s.is_active = true
  ORDER BY category_display_order, s.category, s.name;
$$;

REVOKE ALL ON FUNCTION public.public_get_services(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_get_services(text) TO anon;

INSERT INTO public.schema_migrations (version, name)
VALUES ('184', 'public-services')
ON CONFLICT (version) DO NOTHING;
