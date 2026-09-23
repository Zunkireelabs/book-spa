-- Migration 191: product_categories (additive, REVERSIBLE)
--
-- Closes a real gap introduced by migration-188/190's Products UI: Category
-- there is a dropdown (not free text, to avoid typo'd duplicates), but
-- until now the dropdown could only offer a fixed starter list plus
-- whatever categories happened to already be in use — there was no way to
-- add a genuinely new category at all. This table + its management UI
-- (ProductCategoryManagementPanel) gives staff a real place to create/
-- rename/deactivate/delete product categories, same shape as Services'
-- own Categories page.
--
-- RLS: strict org-scoped (get_user_org_id()/get_user_role()), matching
-- products (migration-188), campaigns, and vouchers — NOT the legacy
-- permissive USING(true) pattern service_categories carries (that
-- predates org multi-tenancy and was the subject of a real cross-org leak
-- fix, migration-093-fix-cross-org-rls-leak.sql).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE
-- POLICY. Portable: no hardcoded UUIDs.
--
-- Reversible (manual):
--   DROP TABLE IF EXISTS public.product_categories;

CREATE TABLE IF NOT EXISTS public.product_categories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id),
  name          text NOT NULL,
  description   text,
  is_active     boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_product_categories_org ON public.product_categories(org_id);

ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own org product_categories" ON public.product_categories;
CREATE POLICY "Users can read own org product_categories"
  ON public.product_categories FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id());

DROP POLICY IF EXISTS "Manager and admin can create org product_categories" ON public.product_categories;
CREATE POLICY "Manager and admin can create org product_categories"
  ON public.product_categories FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
    AND org_id = get_user_org_id()
  );

DROP POLICY IF EXISTS "Manager and admin can update org product_categories" ON public.product_categories;
CREATE POLICY "Manager and admin can update org product_categories"
  ON public.product_categories FOR UPDATE
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
    AND org_id = get_user_org_id()
  )
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
    AND org_id = get_user_org_id()
  );

DROP POLICY IF EXISTS "Manager and admin can delete org product_categories" ON public.product_categories;
CREATE POLICY "Manager and admin can delete org product_categories"
  ON public.product_categories FOR DELETE
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
    AND org_id = get_user_org_id()
  );

INSERT INTO public.schema_migrations (version, name)
VALUES ('191', 'product-categories')
ON CONFLICT (version) DO NOTHING;
