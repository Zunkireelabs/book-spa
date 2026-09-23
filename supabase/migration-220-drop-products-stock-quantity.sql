-- Migration 220: drop products.stock_quantity (additive*, REVERSIBLE)
--
-- *Additive in spirit (nothing else depends on this column anymore) but
-- technically a DROP COLUMN — the last step of the multi-branch stock
-- rework (migration-214 through 219). Every reader/writer of stock now
-- goes through product_branch_stock (per-branch) or products_with_stock
-- (the all-branches total) instead — sell_product (migration-217) and
-- refund_product_sale (migration-218) were already moved off this column
-- in the migrations immediately before this one, so nothing references it
-- by the time this runs.
--
-- Confirmed decision: no backfill needed. The only existing data on
-- staging at the time of this migration is test/seed data, not real
-- inventory — there's no real branch to attribute it to, so this
-- deliberately does not attempt to invent one. Every product simply
-- starts at 0 stock everywhere (product_branch_stock's own "no row = 0"
-- rule) until stock is explicitly received via transfer_product_stock.
--
-- track_stock is NOT dropped — it's still the correct place for "does
-- this product track stock at all," an org-wide catalog property, not a
-- per-branch one.
--
-- Idempotent: DROP COLUMN IF EXISTS. Portable: no hardcoded UUIDs, no data
-- assumptions.
--
-- Reversible (manual):
--   ALTER TABLE products ADD COLUMN stock_quantity integer CHECK (stock_quantity IS NULL OR stock_quantity >= 0);
--   (starts NULL for every row — pre-drop values are not recoverable from this migration alone)

ALTER TABLE public.products DROP COLUMN IF EXISTS stock_quantity;

INSERT INTO public.schema_migrations (version, name)
VALUES ('220', 'drop-products-stock-quantity')
ON CONFLICT (version) DO NOTHING;
