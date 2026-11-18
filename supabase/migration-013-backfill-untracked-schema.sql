-- Migration 013: capture two schema objects that exist in the live databases but were never
-- tracked in this repo.
--
-- Both were created by hand at some point and are referenced by migrations that assume them.
-- The repo already knew about both:
--   migration-194: "service_categories has no tracked CREATE TABLE migration (pre-existing ...)"
--   migration-223: "client_request_id already exists on the table (added ad hoc, never wired up)"
--
-- Consequence, found 2026-11-18 while rebuilding the schema from scratch to verify
-- migration-335 before trusting it: applying schema.sql + every migration in order produces 81
-- errors. service_categories alone takes out a chain of six — services_with_offer_pricing is
-- never created, which breaks migration-200's campaign discount function, which breaks 201,
-- 205, 209, 290 and 294. See docs/known-issues/2026-11-18-schema-not-reproducible.md.
--
-- Numbered 013 deliberately, not at the end of the sequence: migration-184 onward reference
-- service_categories, so creating it last is too late to help a rebuild. 013 sits after
-- migration-009 (which creates organizations, the FK target) and well before the first real
-- dependency. Slot 013 was unused.
--
-- NO-OP ON STAGING AND PRODUCTION. Everything here is IF NOT EXISTS, and both objects already
-- exist there. This migration only does work on a database built from this repo.
--
-- The column list for service_categories is reconstructed from how migrations use it:
--   sc.id, sc.org_id, sc.name          (migration-201, 290, 294 joins and selects)
--   sc.offer_enabled, sc.offer_percent (migration-194 adds these — kept there, not duplicated)
--   display_order, is_active           (migration-049 policies and ordering)
-- If the live tables carry columns beyond these, this migration does not remove or conflict
-- with them; it only guarantees the minimum the rest of the repo depends on.
--
-- Reversible (manual):
--   ALTER TABLE public.bookings DROP COLUMN IF EXISTS client_request_id;
--   DROP TABLE IF EXISTS public.service_categories;   -- only on a scratch rebuild; NEVER live

-- ---------------------------------------------------------------------------
-- 1. service_categories
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.service_categories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  name          text NOT NULL,
  display_order integer DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_categories_org ON public.service_categories (org_id);

-- Matches the posture of every other tenant-scoped table here: RLS on, policies supplied by the
-- migrations that already reference this table (049 and later), not invented now.
ALTER TABLE public.service_categories ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. bookings.client_request_id
--
-- The public booking flow generates a random UUID per attempt and carries it on the INSERT, so
-- the row can be read back without reopening anon SELECT on bookings (migration-223, which
-- closed the 2026-09-24 incident). migration-335 additionally uses it as the idempotency key.
-- ---------------------------------------------------------------------------
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS client_request_id uuid;

-- migration-223 creates this index too; harmless to assert here so a rebuilt database has it
-- regardless of the order the two are applied in.
CREATE INDEX IF NOT EXISTS idx_bookings_client_request_id
  ON public.bookings (client_request_id);

-- ---------------------------------------------------------------------------
-- Ledger
-- ---------------------------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('013', 'backfill-untracked-schema')
ON CONFLICT (version) DO NOTHING;
