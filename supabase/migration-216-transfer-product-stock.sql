-- Migration 216: transfer_product_stock() (additive, REVERSIBLE)
--
-- The one write path onto product_branch_stock (migration-214) — no
-- direct table write policy exists, matching migration-190's
-- (sell_product) relationship to product_sales. Handles both cases with
-- one function: a transfer between two branches (p_from_branch_id set) or
-- new stock arriving from outside the business, e.g. a supplier delivery
-- (p_from_branch_id NULL) — same balance-changing logic either way, just
-- skips the "decrement source" step when there's no source. Every call
-- writes exactly one row to product_stock_transfers (migration-215) in
-- the same transaction, so the ledger can never drift from the actual
-- stock numbers.
--
-- Manager/admin only (unlike sell_product, which also allows staff) —
-- moving inventory between branches is a higher-trust catalog/stock
-- action, same trust level as writing to products itself
-- (migration-188), not an everyday front-desk action.
--
-- Requires the product to have track_stock = true — branch-level stock
-- only makes sense for a product that's opted into stock tracking at all;
-- attempting this on an untracked product is almost certainly a mistake
-- (raises a clear error pointing at the real fix: enable stock tracking
-- on the product first).
--
-- Race safety: ensures both branches' rows exist first (INSERT ... ON
-- CONFLICT DO NOTHING, so there's always something to lock even the very
-- first time a branch receives this product), then locks both rows in a
-- stable order (ORDER BY branch_id) before reading/adjusting quantities —
-- stops two concurrent opposite-direction transfers between the same
-- pair of branches from deadlocking each other, the same class of guard
-- sell_product's single-row FOR UPDATE uses, extended to two rows.
--
-- Idempotent: CREATE OR REPLACE FUNCTION, REVOKE/GRANT re-runnable.
-- Portable: no hardcoded UUIDs.
--
-- Reversible (manual):
--   DROP FUNCTION IF EXISTS public.transfer_product_stock(uuid, uuid, integer, uuid, text);

CREATE OR REPLACE FUNCTION public.transfer_product_stock(
  p_product_id     uuid,
  p_to_branch_id   uuid,
  p_quantity       integer,
  p_from_branch_id uuid DEFAULT NULL,
  p_note           text DEFAULT NULL
)
RETURNS public.product_stock_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role           user_role := get_user_role();
  v_org            uuid      := get_user_org_id();
  v_product_org    uuid;
  v_track_stock    boolean;
  v_to_branch_org  uuid;
  v_from_branch_org uuid;
  v_from_qty       integer;
  v_row            public.product_stock_transfers;
BEGIN
  IF v_role NOT IN ('manager', 'admin') THEN
    RAISE EXCEPTION 'transfer_product_stock: manager or admin role required';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'transfer_product_stock: quantity must be greater than zero';
  END IF;

  IF p_from_branch_id IS NOT NULL AND p_from_branch_id = p_to_branch_id THEN
    RAISE EXCEPTION 'transfer_product_stock: source and destination branch must be different';
  END IF;

  SELECT org_id, track_stock INTO v_product_org, v_track_stock
  FROM public.products
  WHERE id = p_product_id;
  IF v_product_org IS NULL OR v_product_org IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'transfer_product_stock: product not found in your organization';
  END IF;
  IF NOT v_track_stock THEN
    RAISE EXCEPTION 'transfer_product_stock: this product does not have stock tracking enabled';
  END IF;

  SELECT org_id INTO v_to_branch_org FROM public.branches WHERE id = p_to_branch_id;
  IF v_to_branch_org IS NULL OR v_to_branch_org IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'transfer_product_stock: destination branch is not in your organization';
  END IF;

  IF p_from_branch_id IS NOT NULL THEN
    SELECT org_id INTO v_from_branch_org FROM public.branches WHERE id = p_from_branch_id;
    IF v_from_branch_org IS NULL OR v_from_branch_org IS DISTINCT FROM v_org THEN
      RAISE EXCEPTION 'transfer_product_stock: source branch is not in your organization';
    END IF;
  END IF;

  -- Ensure both rows exist (idempotent) so there's always something to lock,
  -- even the first time a branch receives this product.
  INSERT INTO public.product_branch_stock (product_id, branch_id, quantity)
  VALUES (p_product_id, p_to_branch_id, 0)
  ON CONFLICT (product_id, branch_id) DO NOTHING;

  IF p_from_branch_id IS NOT NULL THEN
    INSERT INTO public.product_branch_stock (product_id, branch_id, quantity)
    VALUES (p_product_id, p_from_branch_id, 0)
    ON CONFLICT (product_id, branch_id) DO NOTHING;
  END IF;

  -- Lock both rows in a stable order to avoid deadlocking against a
  -- concurrent opposite-direction transfer between the same two branches.
  PERFORM 1 FROM public.product_branch_stock
  WHERE product_id = p_product_id
    AND branch_id IN (p_to_branch_id, COALESCE(p_from_branch_id, p_to_branch_id))
  ORDER BY branch_id
  FOR UPDATE;

  IF p_from_branch_id IS NOT NULL THEN
    SELECT quantity INTO v_from_qty
    FROM public.product_branch_stock
    WHERE product_id = p_product_id AND branch_id = p_from_branch_id;

    IF v_from_qty < p_quantity THEN
      RAISE EXCEPTION 'transfer_product_stock: insufficient stock at source branch (% available)', v_from_qty;
    END IF;

    UPDATE public.product_branch_stock
    SET quantity = quantity - p_quantity, updated_at = now()
    WHERE product_id = p_product_id AND branch_id = p_from_branch_id;
  END IF;

  UPDATE public.product_branch_stock
  SET quantity = quantity + p_quantity, updated_at = now()
  WHERE product_id = p_product_id AND branch_id = p_to_branch_id;

  INSERT INTO public.product_stock_transfers (
    org_id, product_id, from_branch_id, to_branch_id, quantity, note, transferred_by
  )
  VALUES (
    v_org, p_product_id, p_from_branch_id, p_to_branch_id, p_quantity, p_note, auth.uid()
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_product_stock(uuid, uuid, integer, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transfer_product_stock(uuid, uuid, integer, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.transfer_product_stock(uuid, uuid, integer, uuid, text) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('216', 'transfer-product-stock')
ON CONFLICT (version) DO NOTHING;
