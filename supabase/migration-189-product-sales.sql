-- Migration 189: product_sales (additive, REVERSIBLE)
--
-- One row per product sale — a standalone transaction record, not a line
-- item on a booking. `bookings` is rigid by design (exactly one service_id
-- per row, with a CHECK constraint assuming a single line item, no
-- line-items concept anywhere in the schema — confirmed by reading
-- createBooking/schema.sql before writing this). Bolting products onto
-- bookings would mean rewriting that constraint and the
-- compute_final_amount trigger, a large invasive change for a first
-- version. Instead this mirrors the already-proven pattern this codebase
-- uses for exactly this class of problem — vouchers (migration-072) and
-- service packages (migration-141): a catalog table (migration-188,
-- normal RLS, direct CRUD) plus a separate sale/transaction table written
-- only through a SECURITY DEFINER RPC (migration-190) — no direct
-- INSERT/UPDATE/DELETE policies here, matching packages/vouchers exactly.
--
-- product_name/unit_price_npr are snapshotted at sale time (same
-- reasoning as booking snapshot fields) so a sale's history stays correct
-- even if the product is later renamed, repriced, or deleted.
--
-- customer_id is nullable — walk-in sales need no customer record, same
-- as the product needing no linked booking (deliberately deferred, see
-- migration-190's header).
--
-- payment_mode is plain text with a loose sanity CHECK, matching
-- payments.payment_mode's actual current shape — migration-042 originally
-- converted it from a fixed enum to text+CHECK, then migration-052 relaxed
-- that CHECK further once payment methods became admin-configurable per
-- org (organizations.settings.paymentMethods). The org's configured list
-- is the source of truth for what's offered in the UI; the DB just guards
-- against garbage values here too, not a specific vocabulary.
--
-- RLS: SELECT org-scoped only, matching packages/vouchers — every write
-- goes through sell_product() (migration-190).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE
-- POLICY. Portable: no hardcoded UUIDs.
--
-- Reversible (manual):
--   DROP TABLE IF EXISTS public.product_sales;

CREATE TABLE IF NOT EXISTS public.product_sales (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(id),
  branch_id      uuid NOT NULL REFERENCES public.branches(id),
  product_id     uuid NOT NULL REFERENCES public.products(id),
  product_name   text NOT NULL,
  quantity       integer NOT NULL CHECK (quantity > 0),
  unit_price_npr numeric(10, 2) NOT NULL,
  total_amount   numeric(10, 2) NOT NULL,
  payment_mode   text NOT NULL CHECK (
    payment_mode IS NOT NULL
    AND length(trim(payment_mode)) > 0
    AND length(payment_mode) <= 40
  ),
  customer_id    uuid REFERENCES public.customers(id),
  sold_by        uuid NOT NULL REFERENCES public.users(id),
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_sales_org ON public.product_sales(org_id);
CREATE INDEX IF NOT EXISTS idx_product_sales_branch ON public.product_sales(branch_id);
CREATE INDEX IF NOT EXISTS idx_product_sales_product ON public.product_sales(product_id);
CREATE INDEX IF NOT EXISTS idx_product_sales_customer ON public.product_sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_product_sales_created_at ON public.product_sales(created_at);

ALTER TABLE public.product_sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own org product_sales" ON public.product_sales;
CREATE POLICY "Users can read own org product_sales"
  ON public.product_sales FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id());

INSERT INTO public.schema_migrations (version, name)
VALUES ('189', 'product-sales')
ON CONFLICT (version) DO NOTHING;
