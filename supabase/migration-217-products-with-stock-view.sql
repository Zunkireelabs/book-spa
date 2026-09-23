-- Migration 217: products_with_stock view (additive, REVERSIBLE)
--
-- Convenience view for the "Overall" (all-branches) catalog view: sums
-- each product's product_branch_stock (migration-212) rows into one
-- total_stock figure, so the dashboard doesn't need a second aggregation
-- query on top of the per-branch one. NULL (not 0) for an untracked
-- product — "not tracked" and "tracked but zero everywhere" are different
-- facts and shouldn't collapse into the same number.
--
-- RLS: no policy of its own — inherits products'/product_branch_stock's
-- own org-scoped SELECT policies for the querying role, same as
-- services_with_offer_pricing's note (migration-196).
--
-- Idempotent: CREATE OR REPLACE VIEW. Portable: no hardcoded UUIDs.
--
-- Reversible (manual):
--   DROP VIEW IF EXISTS public.products_with_stock;

CREATE OR REPLACE VIEW public.products_with_stock AS
SELECT
  p.*,
  CASE WHEN p.track_stock THEN COALESCE(SUM(pbs.quantity), 0) ELSE NULL END AS total_stock
FROM public.products p
LEFT JOIN public.product_branch_stock pbs ON pbs.product_id = p.id
GROUP BY p.id;

INSERT INTO public.schema_migrations (version, name)
VALUES ('217', 'products-with-stock-view')
ON CONFLICT (version) DO NOTHING;
