-- Migration 196: services_with_offer_pricing view (additive, REVERSIBLE)
--
-- Dashboard-facing view so ServiceManagementPanel / fetchServicesForManagement
-- never hand-rolls the category-join + offer-pricing calculation in JS. Wraps
-- services with its category's offer fields and the shared
-- compute_service_offer_pricing() result (migration-195) via a LATERAL join,
-- mirroring the same join shape public_get_services (migration-197) uses.
--
-- RLS: this view has no policies of its own — Postgres evaluates the
-- underlying services/service_categories row-level policies for the
-- querying role when the view is selected from, so existing org-scoping is
-- inherited automatically. No new RLS policy is added or needed. (Verified
-- locally per the plan's verification step 6 — a manager from one org must
-- not see another org's offer data through this view.)
--
-- Idempotent: CREATE OR REPLACE VIEW. Portable: no hardcoded UUIDs.
--
-- Reversible (manual):
--   DROP VIEW IF EXISTS public.services_with_offer_pricing;

CREATE OR REPLACE VIEW public.services_with_offer_pricing AS
SELECT
  s.*,
  sc.offer_enabled AS category_offer_enabled,
  sc.offer_percent AS category_offer_percent,
  p.effective_price_npr,
  p.is_on_offer,
  p.original_price_npr
FROM public.services s
LEFT JOIN public.service_categories sc
  ON sc.org_id = s.org_id AND sc.name = s.category
CROSS JOIN LATERAL public.compute_service_offer_pricing(
  s.price_npr, s.offer_enabled, s.offer_type, s.offer_value,
  COALESCE(sc.offer_enabled, false), sc.offer_percent
) p;

INSERT INTO public.schema_migrations (version, name)
VALUES ('196', 'services-with-offer-pricing-view')
ON CONFLICT (version) DO NOTHING;
