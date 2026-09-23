-- Migration 212: product_branch_stock (additive, REVERSIBLE)
--
-- Splits product stock from a single org-wide number (products.stock_quantity,
-- migration-188) into one row per (product, branch) — a business with
-- multiple physical locations needs to know what's actually on the shelf
-- at each one, not a pooled number that one branch's sale silently drains
-- for every other branch too.
--
-- Unlike staff (migration-038/039, one therapist at exactly one branch at
-- a time), stock is a quantity split ACROSS branches simultaneously — 5
-- units at Sanepa and 5 at Bhaisepati is a normal, simultaneous state, not
-- a transfer-in-progress. So this is a proper per-location inventory
-- table, not a "current branch" column like therapists.branch_id.
--
-- No row for a given (product, branch) means that branch has never
-- received this product — treated as 0 available, not "unlimited" or
-- "inherit some default." Confirmed product decision: a branch that's
-- never been given stock genuinely has none: the safer default, and it
-- makes a 0 self-explanatory (this hasn't been stocked here yet) rather
-- than an ambiguous missing number.
--
-- No direct INSERT/UPDATE/DELETE policy — every write goes through
-- transfer_product_stock() (migration-214), the same "catalog table with
-- normal RLS, but the actual balance-changing table is RPC-only" shape
-- migration-189 (product_sales) and this codebase's vouchers/packages
-- already use, so two staff can never race an update to the same row
-- outside the function's FOR UPDATE lock.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE
-- POLICY. Portable: no hardcoded UUIDs.
--
-- Reversible (manual):
--   DROP TABLE IF EXISTS public.product_branch_stock;

CREATE TABLE IF NOT EXISTS public.product_branch_stock (
  product_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  branch_id   uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  quantity    integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_product_branch_stock_branch ON public.product_branch_stock(branch_id);

ALTER TABLE public.product_branch_stock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own org product_branch_stock" ON public.product_branch_stock;
CREATE POLICY "Users can read own org product_branch_stock"
  ON public.product_branch_stock FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_id AND p.org_id = get_user_org_id())
  );

INSERT INTO public.schema_migrations (version, name)
VALUES ('212', 'product-branch-stock')
ON CONFLICT (version) DO NOTHING;
