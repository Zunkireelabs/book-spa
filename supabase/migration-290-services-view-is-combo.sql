-- Migration 290: expose services.is_combo (migration-288) through
-- services_with_offer_pricing — the view fetchServicesForManagement reads from.
--
-- 2026-11-03 fix: originally used CREATE OR REPLACE VIEW on the (false) assumption
-- that the view's existing column order matched this file's SELECT list exactly.
-- It does on staging, but production's pre-existing view had `image_url` and
-- `category` swapped (a historical drift predating this migration, from before the
-- two databases' migration histories were kept in lockstep) — CREATE OR REPLACE
-- VIEW refuses to reorder existing output columns, so this failed outright on
-- production ("cannot change name of view column image_url to category") while
-- having already succeeded on staging weeks earlier. Switched to DROP + CREATE,
-- which rebuilds the view fresh regardless of whatever order existed before —
-- safe here since nothing else depends on this view (checked via pg_depend on both
-- databases) and Supabase's default ACLs (ALTER DEFAULT PRIVILEGES on schema
-- public) auto-grant anon/authenticated/service_role on any new relation, so no
-- explicit GRANT is needed after recreating it.
--
-- Idempotent: safe to re-run — DROP VIEW IF EXISTS + CREATE VIEW either way.
-- Reversible: DROP + CREATE back to the pre-290 body (drop the is_combo column
-- from the SELECT list) — see migration-2xx that last defined this view for the
-- exact prior body if a rollback is ever needed.

BEGIN;

DROP VIEW IF EXISTS public.services_with_offer_pricing;

CREATE VIEW public.services_with_offer_pricing AS
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
