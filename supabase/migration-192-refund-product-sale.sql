-- Migration 192: refund tracking for product_sales (additive, REVERSIBLE)
--
-- Adds the ability to mark a product sale as refunded — without deleting
-- it, same principle as bookings/payments never being deleted, only
-- status-changed. A refunded sale stays fully visible in the sales list
-- (nothing hidden), but is excluded from revenue totals in the report
-- (migration adds no report-side SQL — the report computes this client-
-- side by filtering rows where refunded_at IS NULL).
--
-- refunded_at/refunded_by/refund_reason are nullable columns added
-- directly to product_sales rather than a separate ledger table (unlike
-- packages' append-only redemption ledger) — a sale can only be refunded
-- once, so there's no need for a growing history of refund events per
-- sale, just "was this refunded, and if so by whom/when/why."
--
-- refund_product_sale() is manager/admin only — refunding is a
-- higher-trust action than selling (which staff can do), same reasoning
-- issue_package uses for the "undo money" side of a transaction vs.
-- redeem_package_session's broader staff access on the "use it" side.
--
-- If the sold product has stock tracking on, refunding restores the
-- refunded quantity back to stock_quantity (locking the product row first,
-- same FOR UPDATE discipline sell_product uses) — keeps the count honest
-- instead of a refunded item staying "sold" from stock's perspective.
-- products.id has no ON DELETE clause on product_sales.product_id
-- (default RESTRICT), so a product with any sale history can never
-- actually be deleted — this lookup will always find the row.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION.
-- Portable: no hardcoded UUIDs.
--
-- Reversible (manual):
--   DROP FUNCTION IF EXISTS public.refund_product_sale(uuid, text);
--   ALTER TABLE product_sales DROP COLUMN IF EXISTS refunded_at;
--   ALTER TABLE product_sales DROP COLUMN IF EXISTS refunded_by;
--   ALTER TABLE product_sales DROP COLUMN IF EXISTS refund_reason;

ALTER TABLE public.product_sales
  ADD COLUMN IF NOT EXISTS refunded_at   timestamptz,
  ADD COLUMN IF NOT EXISTS refunded_by   uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS refund_reason text;

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
  v_role  user_role := get_user_role();
  v_org   uuid       := get_user_org_id();
  v_sale  public.product_sales;
  v_row   public.product_sales;
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

  UPDATE public.products
  SET stock_quantity = stock_quantity + v_sale.quantity
  WHERE id = v_sale.product_id AND track_stock = true;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.refund_product_sale(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refund_product_sale(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.refund_product_sale(uuid, text) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('192', 'refund-product-sale')
ON CONFLICT (version) DO NOTHING;
