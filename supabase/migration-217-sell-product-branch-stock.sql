-- Migration 217: sell_product() reads/decrements branch-scoped stock
-- (additive, REVERSIBLE)
--
-- Part of the multi-branch stock rework (migration-214/216): sell_product
-- (migration-190) used to lock and decrement products.stock_quantity — a
-- single org-wide number a sale at any branch drained regardless of which
-- branch actually made the sale. Now locks and decrements the specific
-- (product_id, p_branch_id) row in product_branch_stock instead, so a
-- sale only ever affects the stock of the branch that made it.
--
-- Missing row (this branch has never received the product) is treated as
-- 0 available, same "no row = none here" rule product_branch_stock itself
-- documents — sale blocked with the same insufficient-stock error as
-- before, not a different code path.
--
-- Same signature, same overall shape (role check, quantity/payment_mode
-- validation, branch/customer org checks, snapshot pricing, insert into
-- product_sales) as migration-190 — only the stock-locking block changes,
-- so a plain CREATE OR REPLACE FUNCTION is enough, no DROP needed.
--
-- Idempotent: CREATE OR REPLACE FUNCTION, REVOKE/GRANT re-runnable.
-- Portable: no hardcoded UUIDs.
--
-- Reversible (manual): re-apply migration-190's CREATE OR REPLACE
-- FUNCTION body verbatim to go back to org-wide stock.

CREATE OR REPLACE FUNCTION public.sell_product(
  p_product_id   uuid,
  p_quantity     integer,
  p_payment_mode text,
  p_branch_id    uuid,
  p_customer_id  uuid DEFAULT NULL,
  p_notes        text DEFAULT NULL
)
RETURNS public.product_sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role          user_role := get_user_role();
  v_org           uuid      := get_user_org_id();
  v_branch_org    uuid;
  v_customer_org  uuid;
  v_product       record;
  v_branch_qty    integer;
  v_row           public.product_sales;
BEGIN
  IF v_role NOT IN ('staff', 'manager', 'admin') THEN
    RAISE EXCEPTION 'sell_product: staff, manager, or admin role required';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'sell_product: quantity must be greater than zero';
  END IF;

  IF p_payment_mode IS NULL OR length(trim(p_payment_mode)) = 0 OR length(p_payment_mode) > 40 THEN
    RAISE EXCEPTION 'sell_product: payment_mode is required and must be 40 characters or fewer';
  END IF;

  SELECT org_id INTO v_branch_org FROM public.branches WHERE id = p_branch_id;
  IF v_branch_org IS NULL OR v_branch_org IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'sell_product: branch is not in your organization';
  END IF;

  IF p_customer_id IS NOT NULL THEN
    SELECT org_id INTO v_customer_org FROM public.customers WHERE id = p_customer_id;
    IF v_customer_org IS NULL OR v_customer_org IS DISTINCT FROM v_org THEN
      RAISE EXCEPTION 'sell_product: customer is not in your organization';
    END IF;
  END IF;

  SELECT * INTO v_product FROM public.products
  WHERE id = p_product_id AND org_id = v_org
  FOR UPDATE;
  IF v_product IS NULL THEN
    RAISE EXCEPTION 'sell_product: product not found in your organization';
  END IF;
  IF NOT v_product.is_active THEN
    RAISE EXCEPTION 'sell_product: product is not active';
  END IF;

  IF v_product.track_stock THEN
    SELECT quantity INTO v_branch_qty
    FROM public.product_branch_stock
    WHERE product_id = p_product_id AND branch_id = p_branch_id
    FOR UPDATE;

    IF COALESCE(v_branch_qty, 0) < p_quantity THEN
      RAISE EXCEPTION 'sell_product: insufficient stock (% available)', COALESCE(v_branch_qty, 0);
    END IF;

    UPDATE public.product_branch_stock
    SET quantity = quantity - p_quantity, updated_at = now()
    WHERE product_id = p_product_id AND branch_id = p_branch_id;
  END IF;

  INSERT INTO public.product_sales (
    org_id, branch_id, product_id, product_name, quantity,
    unit_price_npr, total_amount, payment_mode, customer_id, sold_by, notes
  )
  VALUES (
    v_org, p_branch_id, p_product_id, v_product.name, p_quantity,
    v_product.price_npr, v_product.price_npr * p_quantity, p_payment_mode,
    p_customer_id, auth.uid(), p_notes
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.sell_product(uuid, integer, text, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sell_product(uuid, integer, text, uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.sell_product(uuid, integer, text, uuid, uuid, text) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('217', 'sell-product-branch-stock')
ON CONFLICT (version) DO NOTHING;
