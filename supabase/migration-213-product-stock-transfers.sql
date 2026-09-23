-- Migration 213: product_stock_transfers (additive, REVERSIBLE)
--
-- Permanent audit ledger for every product_branch_stock change (migration-212)
-- — mirrors staff_transfers' shape (migration-038) for the same reason:
-- moving stock between branches is a real business event both the sending
-- and receiving branch need to be able to look back on, not just a net
-- number that changed with no trace of how it got there. Confirmed
-- decision: no approval workflow (unlike discount requests elsewhere in
-- this codebase) — a transfer is immediate, but always fully recorded on
-- both sides.
--
-- from_branch_id is nullable: NULL means new stock arriving from outside
-- the business (e.g. a supplier delivery), not a move from another
-- branch — same row shape either way, just no "source" side to decrement.
-- A row with from_branch_id set is a genuine transfer; one with it NULL
-- is a stock-in. Querying "this branch's history" is
-- `from_branch_id = X OR to_branch_id = X` either way.
--
-- No direct INSERT policy — every row is written by
-- transfer_product_stock() (migration-214) in the same transaction as the
-- balance change it records, so the ledger can never drift from the
-- actual stock numbers.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE
-- POLICY. Portable: no hardcoded UUIDs.
--
-- Reversible (manual):
--   DROP TABLE IF EXISTS public.product_stock_transfers;

CREATE TABLE IF NOT EXISTS public.product_stock_transfers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(id),
  product_id     uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  from_branch_id uuid REFERENCES public.branches(id),
  to_branch_id   uuid NOT NULL REFERENCES public.branches(id),
  quantity       integer NOT NULL CHECK (quantity > 0),
  note           text,
  transferred_by uuid NOT NULL REFERENCES public.users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_stock_transfers_product ON public.product_stock_transfers(product_id);
CREATE INDEX IF NOT EXISTS idx_product_stock_transfers_from_branch ON public.product_stock_transfers(from_branch_id);
CREATE INDEX IF NOT EXISTS idx_product_stock_transfers_to_branch ON public.product_stock_transfers(to_branch_id);
CREATE INDEX IF NOT EXISTS idx_product_stock_transfers_created_at ON public.product_stock_transfers(created_at);

ALTER TABLE public.product_stock_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own org product_stock_transfers" ON public.product_stock_transfers;
CREATE POLICY "Users can read own org product_stock_transfers"
  ON public.product_stock_transfers FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id());

INSERT INTO public.schema_migrations (version, name)
VALUES ('213', 'product-stock-transfers')
ON CONFLICT (version) DO NOTHING;
