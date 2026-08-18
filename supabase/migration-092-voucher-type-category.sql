-- Migration 092: category column on voucher_types
--
-- First real consumer of membership_tiers.discount_rules (migration-045) --
-- that jsonb column has been plumbed all the way to the UI
-- (bookingTransformers.transformMembership -> tierDiscountRules) since
-- memberships shipped, but nothing has ever read it. voucher_types had no
-- notion of "category" to look a rule up by, so NewVoucherModal can auto-fill
-- a member's tier discount when issuing a voucher.
--
-- Values match discount_rules' existing keys exactly: spa / salon /
-- body_scrub / package (see migration-045's tier seed:
-- '{"spa":45,"salon":25,"body_scrub":30,"package":10}').
--
-- Idempotent: guarded ALTER TABLE, UPDATE by name (safe to re-run).
-- Portable: no hardcoded UUIDs -- backfill matches on voucher_types.name
-- across all orgs, a no-op wherever a name doesn't exist.
--
-- Reversible (manual):
--   ALTER TABLE public.voucher_types DROP COLUMN IF EXISTS category;

BEGIN;

ALTER TABLE public.voucher_types
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'spa';

ALTER TABLE public.voucher_types
  DROP CONSTRAINT IF EXISTS voucher_types_category_check;
ALTER TABLE public.voucher_types
  ADD CONSTRAINT voucher_types_category_check
  CHECK (category IN ('spa', 'salon', 'body_scrub', 'package'));

-- Everything defaults to 'spa' (correct for the massage/oil/sauna/reflexology/
-- worth-voucher/discount-voucher catalog). Only salon and package need
-- an explicit override.

UPDATE public.voucher_types SET category = 'salon'
WHERE name = 'Hair Cut - Male/Female';

UPDATE public.voucher_types SET category = 'package'
WHERE name IN ('Summer package', 'MONSOON PACKAGE', 'MONSOON PKG');

INSERT INTO public.schema_migrations (version, name)
VALUES ('092', 'voucher-type-category')
ON CONFLICT (version) DO NOTHING;

COMMIT;
