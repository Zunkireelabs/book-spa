-- Migration 195: compute_service_offer_pricing() (additive, REVERSIBLE)
--
-- Single shared source of truth for "what does this service actually cost
-- right now" — used identically by the dashboard's services_with_offer_pricing
-- view (migration-196) and the public_get_services RPC (migration-197), so
-- the override rule is never duplicated or allowed to drift between the two.
--
-- Override rule (confirmed): a service's own offer, when enabled with a
-- valid type/value, always wins outright over its category's offer, even if
-- the category offer is also on. If the service's own offer is off (or
-- malformed — enabled but missing type/value), it inherits its category's
-- percent offer when the category has one on. If neither applies, the price
-- is unchanged.
--
-- Takes scalar arguments rather than a service id doing its own lookup, so
-- it's directly testable in isolation (call it with literals in the SQL
-- editor) and composes into any caller's existing join without an extra
-- per-row subquery.
--
-- Idempotent: CREATE OR REPLACE FUNCTION. Portable: no table/org lookups at
-- all, purely a pricing calculation.
--
-- Reversible (manual):
--   DROP FUNCTION IF EXISTS public.compute_service_offer_pricing(numeric, boolean, text, numeric, boolean, numeric);

CREATE OR REPLACE FUNCTION public.compute_service_offer_pricing(
  p_price_npr               numeric,
  p_service_offer_enabled   boolean,
  p_service_offer_type      text,
  p_service_offer_value     numeric,
  p_category_offer_enabled  boolean,
  p_category_offer_percent  numeric
)
RETURNS TABLE (
  effective_price_npr numeric,
  is_on_offer         boolean,
  original_price_npr  numeric
)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    CASE
      WHEN p_service_offer_enabled AND p_service_offer_type = 'fixed' AND p_service_offer_value IS NOT NULL
        THEN p_service_offer_value
      WHEN p_service_offer_enabled AND p_service_offer_type = 'percent' AND p_service_offer_value IS NOT NULL
        THEN ROUND(p_price_npr * (1 - p_service_offer_value / 100.0), 2)
      WHEN NOT p_service_offer_enabled AND p_category_offer_enabled AND p_category_offer_percent IS NOT NULL
        THEN ROUND(p_price_npr * (1 - p_category_offer_percent / 100.0), 2)
      ELSE p_price_npr
    END AS effective_price_npr,
    (
      (p_service_offer_enabled AND p_service_offer_type IS NOT NULL AND p_service_offer_value IS NOT NULL)
      OR (NOT p_service_offer_enabled AND p_category_offer_enabled AND p_category_offer_percent IS NOT NULL)
    ) AS is_on_offer,
    CASE
      WHEN (p_service_offer_enabled AND p_service_offer_type IS NOT NULL AND p_service_offer_value IS NOT NULL)
        OR (NOT p_service_offer_enabled AND p_category_offer_enabled AND p_category_offer_percent IS NOT NULL)
      THEN p_price_npr
      ELSE NULL
    END AS original_price_npr;
$$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('195', 'compute-service-offer-pricing-function')
ON CONFLICT (version) DO NOTHING;
