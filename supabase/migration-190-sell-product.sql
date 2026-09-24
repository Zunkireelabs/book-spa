-- Migration 190: sell_product() (additive, REVERSIBLE)
--
-- The one write path onto product_sales (migration-189) — no direct
-- INSERT policy exists on that table. Mirrors issue_package's validation
-- shape (org/branch/customer scoping) exactly, but the role check includes
-- 'staff' in addition to manager/admin, the same deliberate divergence
-- redeem_package_session makes: selling a product at the front desk is an
-- everyday staff-facing action, not a higher-trust catalog-management one
-- (catalog writes on `products` itself stay manager/admin-only, per
-- migration-188).
--
-- Snapshots product_name/unit_price_npr from the live products row at
-- sale time and computes total_amount server-side (quantity * unit
-- price) — the client never sends a total, so it can't be tampered with
-- or drift from what the product actually costs. Requires the product to
-- be is_active = true (deactivating a product blocks new sales without
-- deleting it or affecting past product_sales rows, which are protected
-- by the snapshot).
--
-- payment_mode is plain text, matching product_sales' column type
-- (migration-189) and payments.payment_mode's actual current shape — the
-- payment_mode enum type was dropped in migration-042, org payment
-- methods are admin-configurable text since migration-052.
--
-- Stock (when track_stock = true): the product row is locked with FOR
-- UPDATE before checking stock_quantity, so two concurrent sales of the
-- last item can't both pass the check — the second sale blocks until the
-- first's transaction commits (decrementing the count), then correctly
-- sees the reduced number and fails if it's no longer enough. This is the
-- same class of guard redeem_package_session uses (FOR UPDATE on the
-- parent package) to stop two concurrent redemptions over-spending a
-- shared balance.
--
-- Idempotent: CREATE OR REPLACE FUNCTION, REVOKE/GRANT re-runnable.
-- Portable: no hardcoded UUIDs.
--
-- Reversible (manual):
--   DROP FUNCTION IF EXISTS public.sell_product(uuid, integer, text, uuid, uuid, text);

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

  IF v_product.track_stock AND COALESCE(v_product.stock_quantity, 0) < p_quantity THEN
    RAISE EXCEPTION 'sell_product: insufficient stock (% available)', COALESCE(v_product.stock_quantity, 0);
  END IF;

  IF v_product.track_stock THEN
    UPDATE public.products
    SET stock_quantity = stock_quantity - p_quantity
    WHERE id = p_product_id;
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
VALUES ('190', 'sell-product')
ON CONFLICT (version) DO NOTHING;
