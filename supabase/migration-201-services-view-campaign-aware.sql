-- Migration 201: services_with_offer_pricing campaign-awareness (additive, REVERSIBLE)
--
-- Layers an active-campaign check (migration-200) on top of the existing
-- manual-offer pricing (migration-195/196): if
-- get_active_campaign_discount_percent() returns a value for a service,
-- that wins outright over whatever compute_service_offer_pricing() would
-- have said (confirmed priority decision — a campaign linking a service is
-- the most deliberate, current action for that window, even over a
-- pre-existing manual offer). Otherwise the existing manual-offer result
-- passes through completely unchanged.
--
-- Views can have columns appended via plain CREATE OR REPLACE VIEW without
-- a DROP first (unlike RETURNS TABLE functions — the lesson from
-- migration-197) as long as the existing columns keep their name/type/
-- position, which this preserves exactly: effective_price_npr/is_on_offer/
-- original_price_npr keep their meaning (now campaign-aware), and
-- active_campaign_name is purely a new trailing column so the dashboard
-- can badge "Dashain Offer" distinctly from a plain manual "Offer" badge.
--
-- RLS: unchanged from migration-196's note — inherited from the underlying
-- tables (services/service_categories/campaigns/campaign_services/
-- campaign_categories), no new policy needed.
--
-- Idempotent: CREATE OR REPLACE VIEW. Portable: no hardcoded UUIDs.
--
-- Reversible (manual): re-apply migration-196's CREATE OR REPLACE VIEW
-- body verbatim to drop the campaign layer.

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
LEFT JOIN LATERAL public.get_active_campaign_discount_percent(s.id, sc.id) camp ON true;

INSERT INTO public.schema_migrations (version, name)
VALUES ('201', 'services-view-campaign-aware')
ON CONFLICT (version) DO NOTHING;
