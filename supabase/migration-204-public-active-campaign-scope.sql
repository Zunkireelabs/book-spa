-- Migration 204: public_get_active_campaign() scope info (additive, REVERSIBLE)
--
-- Adds applies_to (a comma-joined list of the campaign's linked category
-- names + individually-linked service names) so the website banner can
-- tell visitors what the discount actually covers, not just its name and
-- percentage. Follows this repo's convention of extending an already-
-- committed migration with a new one rather than editing it in place
-- (migration-203 is committed history, not touched here).
--
-- Uses string_agg over a UNION of campaign_categories (joined to
-- service_categories for the display name) and campaign_services (joined
-- to services), deduplicated, alphabetically ordered for a stable label.
--
-- DROP FUNCTION first, same RETURNS TABLE lesson as migration-197/202/203 —
-- CREATE OR REPLACE cannot add a column to an existing function's return
-- shape.
--
-- Idempotent: CREATE OR REPLACE FUNCTION, REVOKE/GRANT re-runnable.
-- Portable: no hardcoded UUIDs; org resolved by slug.
--
-- Reversible (manual): re-apply migration-203's CREATE OR REPLACE FUNCTION
-- body verbatim (after a DROP FUNCTION public.public_get_active_campaign(text))
-- to drop the applies_to column.

DROP FUNCTION IF EXISTS public.public_get_active_campaign(text);

CREATE OR REPLACE FUNCTION public.public_get_active_campaign(
  p_org_slug text
)
RETURNS TABLE (
  name              text,
  message           text,
  banner_image_url  text,
  discount_percent  numeric,
  start_date        date,
  end_date          date,
  applies_to        text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
  SELECT
    c.name,
    c.message,
    c.banner_image_url,
    c.discount_percent,
    c.start_date,
    c.end_date,
    (
      SELECT string_agg(label, ', ' ORDER BY label)
      FROM (
        SELECT DISTINCT sc.name AS label
        FROM public.campaign_categories cc
        JOIN public.service_categories sc ON sc.id = cc.category_id
        WHERE cc.campaign_id = c.id

        UNION

        SELECT DISTINCT s.name AS label
        FROM public.campaign_services cs
        JOIN public.services s ON s.id = cs.service_id
        WHERE cs.campaign_id = c.id
      ) scope
    ) AS applies_to
  FROM public.campaigns c
  JOIN public.organizations o ON o.id = c.org_id
  WHERE o.slug = p_org_slug
    AND o.is_active = true
    AND c.is_active = true
    AND CURRENT_DATE BETWEEN c.start_date AND c.end_date
  ORDER BY c.end_date ASC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.public_get_active_campaign(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_get_active_campaign(text) TO anon;

INSERT INTO public.schema_migrations (version, name)
VALUES ('204', 'public-active-campaign-scope')
ON CONFLICT (version) DO NOTHING;
