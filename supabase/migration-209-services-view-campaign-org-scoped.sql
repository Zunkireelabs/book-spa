-- Migration 209: services_with_offer_pricing passes org_id to the
-- now-org-scoped campaign lookup (additive, REVERSIBLE)
--
-- migration-208 made get_active_campaign_discount_percent() require a
-- third p_org_id argument (no default, deliberately breaking any caller
-- that doesn't pass one). This is the dashboard-facing caller — updates
-- the LATERAL join to pass s.org_id. No column changes, so a plain
-- CREATE OR REPLACE VIEW is enough (same as migration-201's own note).
--
-- Idempotent: CREATE OR REPLACE VIEW. Portable: no hardcoded UUIDs.
--
-- Reversible (manual): re-apply migration-201's CREATE OR REPLACE VIEW
-- body verbatim (only safe once migration-208 is also reverted, since the
-- 2-arg function signature it calls would no longer exist otherwise).

CREATE OR REPLACE VIEW public.services_with_offer_pricing AS
SELECT
  s.*,
  sc.offer_enabled AS category_offer_enabled,
  sc.offer_percent AS category_offer_percent,
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
LEFT JOIN public.service_categories sc
  ON sc.org_id = s.org_id AND sc.name = s.category
CROSS JOIN LATERAL public.compute_service_offer_pricing(
  s.price_npr, s.offer_enabled, s.offer_type, s.offer_value,
  COALESCE(sc.offer_enabled, false), sc.offer_percent
) p
LEFT JOIN LATERAL public.get_active_campaign_discount_percent(s.id, sc.id, s.org_id) camp ON true;

INSERT INTO public.schema_migrations (version, name)
VALUES ('209', 'services-view-campaign-org-scoped')
ON CONFLICT (version) DO NOTHING;
