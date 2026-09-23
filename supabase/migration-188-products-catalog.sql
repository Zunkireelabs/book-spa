-- Migration 188: products catalog (additive, REVERSIBLE)
--
-- A retail product catalog — oils, skincare, gift items — distinct from
-- bookable Services. Deliberately trimmed down (no supplier, barcode/SKU,
-- commission, or tax; category is free text, same as services' original
-- shape before service_categories existed) per the client's explicit
-- "simple first, leave room for the full thing later" decision.
--
-- track_stock/stock_quantity: optional per-product stock tracking, off by
-- default so existing products stay unlimited/untracked unless a staff
-- member opts a product in. When on, sell_product() (migration-190) locks
-- the row, blocks the sale if stock_quantity < requested quantity, and
-- decrements it atomically within the same transaction — no separate
-- "check stock" step that could race with another sale. When off,
-- stock_quantity is ignored entirely (may be NULL or stale, sell_product
-- never reads it).
--
-- RLS: SELECT org-scoped for authenticated (staff need to browse the
-- catalog to sell from it, migration-190); INSERT/UPDATE/DELETE restricted
-- to manager/admin — exact mirror of services' policy shape
-- (migration-049-services-manager-write.sql), not the legacy permissive
-- service_categories pattern.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE
-- POLICY. Portable: no hardcoded UUIDs.
--
-- Reversible (manual):
--   DROP TABLE IF EXISTS public.products;

CREATE TABLE IF NOT EXISTS public.products (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id),
  name         text NOT NULL,
  description  text,
  category     text,
  price_npr    numeric(10, 2) NOT NULL CHECK (price_npr > 0),
  image_url    text,
  is_active    boolean NOT NULL DEFAULT true,
  track_stock    boolean NOT NULL DEFAULT false,
  stock_quantity integer CHECK (stock_quantity IS NULL OR stock_quantity >= 0),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_org ON public.products(org_id);
CREATE INDEX IF NOT EXISTS idx_products_org_active ON public.products(org_id, is_active) WHERE is_active = true;

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own org products" ON public.products;
CREATE POLICY "Users can read own org products"
  ON public.products FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id());

DROP POLICY IF EXISTS "Manager and admin can create org products" ON public.products;
CREATE POLICY "Manager and admin can create org products"
  ON public.products FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
    AND org_id = get_user_org_id()
  );

DROP POLICY IF EXISTS "Manager and admin can update org products" ON public.products;
CREATE POLICY "Manager and admin can update org products"
  ON public.products FOR UPDATE
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
    AND org_id = get_user_org_id()
  )
  WITH CHECK (
    get_user_role() IN ('manager', 'admin')
    AND org_id = get_user_org_id()
  );

DROP POLICY IF EXISTS "Manager and admin can delete org products" ON public.products;
CREATE POLICY "Manager and admin can delete org products"
  ON public.products FOR DELETE
  TO authenticated
  USING (
    get_user_role() IN ('manager', 'admin')
    AND org_id = get_user_org_id()
  );

INSERT INTO public.schema_migrations (version, name)
VALUES ('188', 'products-catalog')
ON CONFLICT (version) DO NOTHING;
