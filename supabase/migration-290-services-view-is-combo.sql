-- Migration 290: expose services.is_combo (migration-288) through
-- services_with_offer_pricing — the view fetchServicesForManagement reads from.
-- CREATE OR REPLACE VIEW can append a column without dropping the view (Postgres
-- only disallows removing/reordering existing output columns), so this is a safe,
-- additive change to an existing view.
--
-- Idempotent: CREATE OR REPLACE VIEW is naturally re-runnable.
-- Reversible: CREATE OR REPLACE VIEW back to the pre-290 body (drop the is_combo
-- column from the SELECT list) — see migration-2xx that last defined this view for
-- the exact prior body if a rollback is ever needed.

BEGIN;

CREATE OR REPLACE VIEW public.services_with_offer_pricing AS
SELECT
  s.id,
  s.name,
  s.duration_minutes,
  s.price_npr,
  s.description,
  s.is_active,
  s.created_at,
  s.org_id,
  s.category,
  s.image_url,
  s.is_couple,
  s.offer_enabled,
  s.offer_type,
  s.offer_value,
  sc.offer_enabled AS category_offer_enabled,
  sc.offer_percent AS category_offer_percent,
  CASE
    WHEN camp.discount_percent IS NOT NULL THEN round(s.price_npr * (1::numeric - camp.discount_percent / 100.0), 2)
    ELSE p.effective_price_npr
  END AS effective_price_npr,
  camp.discount_percent IS NOT NULL OR p.is_on_offer AS is_on_offer,
  CASE
    WHEN camp.discount_percent IS NOT NULL THEN s.price_npr
    ELSE p.original_price_npr
  END AS original_price_npr,
  camp.campaign_name AS active_campaign_name,
  s.is_combo
FROM services s
  LEFT JOIN service_categories sc ON sc.org_id = s.org_id AND sc.name = s.category
  CROSS JOIN LATERAL compute_service_offer_pricing(s.price_npr, s.offer_enabled, s.offer_type, s.offer_value, COALESCE(sc.offer_enabled, false), sc.offer_percent) p(effective_price_npr, is_on_offer, original_price_npr)
  LEFT JOIN LATERAL get_active_campaign_discount_percent(s.id, sc.id, s.org_id) camp(discount_percent, campaign_name) ON true;

INSERT INTO public.schema_migrations (version, name)
VALUES ('290', 'services-view-is-combo')
ON CONFLICT (version) DO NOTHING;

COMMIT;
