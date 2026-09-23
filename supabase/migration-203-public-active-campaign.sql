-- Migration 203: public_get_active_campaign() (additive, REVERSIBLE)
--
-- Public, anon-safe RPC feeding the website's campaign banner and popup —
-- matching the same trusted pattern as public_get_services (migration-184)
-- and the public booking-flow RPCs (public_check_customer_exists,
-- public_lookup_referrer_by_phone): org resolved by slug, SECURITY DEFINER
-- with search_path locked, no session required, granted to anon only.
--
-- Returns at most one row — the single most-relevant currently-active
-- campaign for that org (is_active = true AND today within
-- [start_date, end_date]), picking the one ending soonest if more than one
-- happens to be active (confirmed decision: the data model technically
-- allows overlapping campaigns, but the website only ever shows one
-- banner/popup at a time). Empty result (no rows) when no campaign is
-- currently active — the website renders nothing in that case, no error.
--
-- Deliberately does NOT expose the campaigns table directly to anon (no
-- RLS policy grants that) — this RPC is the only public-facing surface,
-- keeping campaigns' full row shape (org_id, is_active internals, etc.)
-- server-side only.
--
-- Idempotent: CREATE OR REPLACE FUNCTION, REVOKE/GRANT re-runnable.
-- Portable: no hardcoded UUIDs; org resolved by slug.
--
-- Reversible (manual):
--   DROP FUNCTION IF EXISTS public.public_get_active_campaign(text);

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
  end_date          date
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
    c.end_date
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
VALUES ('203', 'public-active-campaign')
ON CONFLICT (version) DO NOTHING;
