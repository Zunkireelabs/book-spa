-- Migration 189: public_get_services() offer pricing (additive, REVERSIBLE)
--
-- Extends the public_get_services RPC (migration-184) with three new
-- trailing columns — effective_price_npr, is_on_offer, original_price_npr —
-- computed via the same compute_service_offer_pricing() function
-- (migration-187) the dashboard's services_with_offer_pricing view
-- (migration-188) uses, so the website and the dashboard always agree on
-- "what does this cost right now."
--
-- Purely additive in effect: the original 7 columns keep their name/
-- position/meaning unchanged, just 3 new trailing columns. Postgres itself
-- still requires an explicit DROP FUNCTION first, though — CREATE OR
-- REPLACE cannot change a RETURNS TABLE column set even when only adding
-- columns (verified locally: "cannot change return type of existing
-- function ... Row type defined by OUT parameters is different"). The
-- input signature (p_org_slug text) is unchanged, so the DROP + CREATE is
-- atomic within this migration's transaction — no window where the
-- function doesn't exist. nuadthainepal.com doesn't consume this RPC yet,
-- so there is no live breaking-change risk either way.
--
-- price_npr remains the base price, unchanged meaning. effective_price_npr
-- is the "what to actually display" field. original_price_npr is non-null
-- only when is_on_offer is true, so a frontend can render "was X, now Y"
-- without conditional logic against price_npr vs effective_price_npr.
--
-- Idempotent: CREATE OR REPLACE FUNCTION, REVOKE/GRANT re-runnable.
-- Portable: no hardcoded UUIDs; org resolved by slug.
--
-- Reversible (manual): re-apply migration-184's CREATE OR REPLACE FUNCTION
-- body verbatim (after a DROP FUNCTION public.public_get_services(text))
-- to drop back to the 7-column shape.

DROP FUNCTION IF EXISTS public.public_get_services(text);

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
  category_display_order  integer,
  effective_price_npr     numeric,
  is_on_offer             boolean,
  original_price_npr      numeric
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
    COALESCE(sc.display_order, 2147483647) AS category_display_order,
    p.effective_price_npr,
    p.is_on_offer,
    p.original_price_npr
  FROM public.services s
  JOIN public.organizations o ON o.id = s.org_id
  LEFT JOIN public.service_categories sc
    ON sc.org_id = s.org_id
   AND sc.name = s.category
  CROSS JOIN LATERAL public.compute_service_offer_pricing(
    s.price_npr, s.offer_enabled, s.offer_type, s.offer_value,
    COALESCE(sc.offer_enabled, false), sc.offer_percent
  ) p
  WHERE o.slug = p_org_slug
    AND o.is_active = true
    AND s.is_active = true
  ORDER BY category_display_order, s.category, s.name;
$$;

REVOKE ALL ON FUNCTION public.public_get_services(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_get_services(text) TO anon;

INSERT INTO public.schema_migrations (version, name)
VALUES ('189', 'public-services-offer-pricing')
ON CONFLICT (version) DO NOTHING;
