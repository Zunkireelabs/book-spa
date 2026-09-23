-- ============================================================
-- LOCAL-ONLY supplemental table: service_categories (NOT run against staging/production)
-- ============================================================
--
-- service_categories has NO tracked CREATE TABLE anywhere in this repo's schema.sql or any
-- migration — it exists on staging/production only because it was created directly via the
-- Supabase dashboard at some point (pre-existing drift, first documented in
-- migration-184-public-services.sql's comments). Every migration that references it
-- (migration-184, migration-194 onward) was written and tested against staging/production, where
-- the table already exists — never against a byte-for-byte fresh bootstrap.
--
-- A fresh local OrbStack bootstrap (supabase/LOCAL_DEV.md) replays schema.sql + every migration
-- from scratch, so it hits this gap for real: migration-184 fails immediately with
-- "relation public.service_categories does not exist" the first time this is attempted end to
-- end. This file closes that gap for local dev only, the same way
-- scripts/local-only-supplemental-triggers.sql closes migration-002's schema.sql-snapshot gap —
-- run once, right after rls.sql, before any migration replays.
--
-- Schema inferred from src/services/api.js's usage (fetchCategoriesForManagement,
-- fetchActiveCategories, createCategory, updateCategory, toggleCategoryActive): columns id,
-- org_id, name, description, is_active, display_order, created_at, with a unique (org_id, name)
-- constraint (createCategory handles Postgres error code 23505 as "duplicate name").
--
-- RLS mirrors the services table's own policy shape (supabase/rls.sql: unconditionally
-- permissive SELECT for both authenticated and anon, org isolation enforced entirely at the app
-- layer via .eq('org_id', ...) — not a new pattern introduced here), plus the permissive
-- manager/admin write policies migration-049-services-manager-write.sql's own comment already
-- describes as live on staging ("service_categories needs NO DB change — its INSERT/UPDATE/
-- DELETE policies on staging are already permissive (USING true / WITH CHECK true)").
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE POLICY.
--
-- No FK on org_id to organizations(id): this supplemental script runs right after rls.sql,
-- before any migration replays — organizations itself isn't created until migration-009 runs
-- later in the same bootstrap. This is local-bootstrap-only scaffolding (not a source of truth
-- for staging/production's real table), so a plain uuid column without the FK is a safe
-- simplification rather than reordering the whole bootstrap around one constraint.

CREATE TABLE IF NOT EXISTS public.service_categories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  name          text NOT NULL,
  description   text,
  is_active     boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

ALTER TABLE public.service_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read service_categories" ON public.service_categories;
CREATE POLICY "Anyone can read service_categories"
  ON public.service_categories FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Anonymous users can read service_categories" ON public.service_categories;
CREATE POLICY "Anonymous users can read service_categories"
  ON public.service_categories FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "Manager and admin can create service_categories" ON public.service_categories;
CREATE POLICY "Manager and admin can create service_categories"
  ON public.service_categories FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Manager and admin can update service_categories" ON public.service_categories;
CREATE POLICY "Manager and admin can update service_categories"
  ON public.service_categories FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Manager and admin can delete service_categories" ON public.service_categories;
CREATE POLICY "Manager and admin can delete service_categories"
  ON public.service_categories FOR DELETE
  TO authenticated
  USING (true);
