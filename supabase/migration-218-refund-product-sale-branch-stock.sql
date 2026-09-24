-- Migration 218: refund_product_sale() restores branch-scoped stock
-- (additive, REVERSIBLE)
--
-- Part of the multi-branch stock rework (migration-214/217):
-- refund_product_sale (migration-192) used to restore the refunded
-- quantity to products.stock_quantity — the single org-wide number. Now
-- restores it to the specific branch the original sale was made at
-- (product_sales.branch_id, already recorded on every sale), so a refund
-- puts the stock back where it actually left from, not into a pooled
-- number that could credit the wrong branch.
--
-- Upsert (INSERT ... ON CONFLICT DO UPDATE) rather than a plain UPDATE:
-- covers the edge case where track_stock was off at sale time (no branch
-- row required) and got turned on before the refund — without this, a
-- plain UPDATE would silently do nothing since no row would exist yet.
--
-- Same signature, same overall shape as migration-192 — only the
-- stock-restoring block changes, so a plain CREATE OR REPLACE FUNCTION is
-- enough, no DROP needed.
--
-- Idempotent: CREATE OR REPLACE FUNCTION, REVOKE/GRANT re-runnable.
-- Portable: no hardcoded UUIDs.
--
-- Reversible (manual): re-apply migration-192's CREATE OR REPLACE
-- FUNCTION body verbatim to go back to org-wide stock.

CREATE OR REPLACE FUNCTION public.refund_product_sale(
  p_sale_id uuid,
  p_reason  text DEFAULT NULL
)
RETURNS public.product_sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role        user_role := get_user_role();
  v_org         uuid       := get_user_org_id();
  v_sale        public.product_sales;
  v_row         public.product_sales;
  v_track_stock boolean;
BEGIN
  IF v_role NOT IN ('manager', 'admin') THEN
    RAISE EXCEPTION 'refund_product_sale: manager or admin role required';
  END IF;

  SELECT * INTO v_sale FROM public.product_sales
  WHERE id = p_sale_id AND org_id = v_org
  FOR UPDATE;

  IF v_sale IS NULL THEN
    RAISE EXCEPTION 'refund_product_sale: sale not found in your organization';
  END IF;

  IF v_sale.refunded_at IS NOT NULL THEN
    RAISE EXCEPTION 'refund_product_sale: this sale has already been refunded';
  END IF;

  UPDATE public.product_sales
  SET refunded_at = now(), refunded_by = auth.uid(), refund_reason = p_reason
  WHERE id = p_sale_id
  RETURNING * INTO v_row;

  SELECT track_stock INTO v_track_stock FROM public.products WHERE id = v_sale.product_id;

  IF v_track_stock THEN
    INSERT INTO public.product_branch_stock (product_id, branch_id, quantity)
    VALUES (v_sale.product_id, v_sale.branch_id, v_sale.quantity)
    ON CONFLICT (product_id, branch_id)
    DO UPDATE SET quantity = public.product_branch_stock.quantity + v_sale.quantity, updated_at = now();
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.refund_product_sale(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refund_product_sale(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.refund_product_sale(uuid, text) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('218', 'refund-product-sale-branch-stock')
ON CONFLICT (version) DO NOTHING;
