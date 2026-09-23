-- Migration 206: compute_service_offer_pricing() fixed-offer price guard
-- (additive, REVERSIBLE)
--
-- Review finding on PR #296: a fixed-type service offer had no floor check
-- anywhere — offer_value could be set to or above the service's own
-- price_npr, which would still flag is_on_offer = true and show a
-- strikethrough "original" price below a higher "discounted" one (a price
-- increase mislabeled as a discount). ServiceManagementPanel.jsx now
-- blocks this at entry (client-side), but that alone leaves the same hole
-- open to any other write path (direct API/SQL edit, a future admin
-- screen, etc.) — this closes it at the shared pricing-calculation layer
-- instead, following this migration's own convention (migration-193's
-- header) of deliberately not adding a hard CHECK constraint, since a
-- constraint can't express "less than a sibling column" portably the way
-- this function already expresses every other offer rule.
--
-- Follows the same convention as the rest of this function: a fixed offer
-- at or above price_npr is treated exactly like any other malformed
-- enabled-offer case already was (enabled but missing type/value) — falls
-- straight to ELSE, price unchanged, is_on_offer false. Deliberately does
-- NOT fall back to the category's offer here (that fallback only ever
-- applied when the service offer was off entirely, not when it was on but
-- invalid — this preserves that exact existing distinction rather than
-- inventing a new one). Percent-type offers are untouched (already bounded
-- to (0, 100) at the client and mathematically can't exceed price_npr
-- regardless).
--
-- Idempotent: CREATE OR REPLACE FUNCTION (same signature/return shape as
-- migration-195, so no DROP needed first). Portable: no table/org lookups.
--
-- Reversible (manual): re-apply migration-195's CREATE OR REPLACE FUNCTION
-- body verbatim to drop the guard.

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
      WHEN p_service_offer_enabled AND p_service_offer_type = 'fixed' AND p_service_offer_value IS NOT NULL AND p_service_offer_value < p_price_npr
        THEN p_service_offer_value
      WHEN p_service_offer_enabled AND p_service_offer_type = 'percent' AND p_service_offer_value IS NOT NULL
        THEN ROUND(p_price_npr * (1 - p_service_offer_value / 100.0), 2)
      WHEN NOT p_service_offer_enabled AND p_category_offer_enabled AND p_category_offer_percent IS NOT NULL
        THEN ROUND(p_price_npr * (1 - p_category_offer_percent / 100.0), 2)
      ELSE p_price_npr
    END AS effective_price_npr,
    (
      (p_service_offer_enabled AND p_service_offer_type = 'fixed' AND p_service_offer_value IS NOT NULL AND p_service_offer_value < p_price_npr)
      OR (p_service_offer_enabled AND p_service_offer_type = 'percent' AND p_service_offer_value IS NOT NULL)
      OR (NOT p_service_offer_enabled AND p_category_offer_enabled AND p_category_offer_percent IS NOT NULL)
    ) AS is_on_offer,
    CASE
      WHEN (p_service_offer_enabled AND p_service_offer_type = 'fixed' AND p_service_offer_value IS NOT NULL AND p_service_offer_value < p_price_npr)
        OR (p_service_offer_enabled AND p_service_offer_type = 'percent' AND p_service_offer_value IS NOT NULL)
        OR (NOT p_service_offer_enabled AND p_category_offer_enabled AND p_category_offer_percent IS NOT NULL)
      THEN p_price_npr
      ELSE NULL
    END AS original_price_npr;
$$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('206', 'fixed-offer-price-guard')
ON CONFLICT (version) DO NOTHING;
