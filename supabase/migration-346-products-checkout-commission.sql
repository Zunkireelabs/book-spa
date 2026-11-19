-- Migration 346: products in booking checkout + product commission
-- Idempotent: safe to re-run in either database. (346 is the local number; the lead renumbers it before the PR.)
--
-- WHY
--   Products could only be sold from the Products page as a stand-alone sale (V25), never on the bill, and nobody earned a
--   commission on them. Daily close, the operational report and the revenue reports also left product money out entirely (only
--   Today's Insights counted it), so a day with product sales did not reconcile with the drawer.
--
-- WHAT
--   product_sales            + booking_id (the visit it was added to), + sold_by_therapist_id (who earns the commission; NULL = no one).
--   product_sale_payments    new, append-only (like the stock ledger). One row per method that paid a sale: every sale has >= 1 row and
--                            the rows add up to total_amount. Backfilled one row per existing sale from its payment_mode.
--                            product_sales.payment_mode stays: the single method, or 'Split' when 2+ rows.
--   products                 + earns_commission (default true). save_product reads it (a key that is absent keeps the value).
--   staff_compensation       + product_commission_rate 0..100 (same admin-only RLS as the other pay columns).
--   payroll_items            + product_revenue, product_commission_rate, product_commission (earned), product_commission_deduction.
--   daily_reports            + product_revenue (product money collected that day; it is also inside net_revenue and the method totals,
--                            exactly like voucher sales, so the drawer reconciles).
--
--   RPCs (SECURITY DEFINER, search_path public, EXECUTE for authenticated only; role / org / branch checked inside):
--     sell_product v3                    adds p_sold_by_therapist_id, p_booking_id, p_payments (per-method split). Refuses a closed day.
--                                        The v2 signature is dropped (same deploy-together rule as 345).
--     checkout_booking_with_products     ONE transaction: the product sales (server prices, stock, ledger, per-method payments) AND the
--                                        treatment payment. Why a wrapper and not a bigger record_group_payment: the treatment part
--                                        is delegated to record_group_payment untouched (membership / voucher / package maths, due
--                                        holder, locked booking, referral credit all stay in one place); this function only adds the
--                                        product half and the allocation rule below.
--     save_product                       re-declared with earns_commission.
--     record_group_payment               re-declared with ONE changed line: fixes a live bug since migration-178 (the amount still owing
--                                        always came out 0 because the SessionPackage residual was added even with no package tender).
--   Private helpers (EXECUTE revoked from everyone): _sell_product_line, _checkout_membership_deduct, _inv_day_locked, _is_treatment_only_mode.
--
-- ALLOCATION RULE (enforced here, not trusted from the client)
--   * Treatment-only credits (VoucherWallet, ReferralVoucher, SessionPackage, ReferralWallet) can only pay the treatment.
--   * PLAIN money methods (cash, card, digital wallet, mobile banking, any other org method) fill the PRODUCTS FIRST, in the order
--     they are listed. The Membership wallet only covers what the plain methods leave unpaid on the products, so by default the
--     wallet goes to the treatment. The treatment gets whatever is left.
--   * Products must be covered in full: if the money methods listed do not cover the products total, nothing is written.
--     "Leave as due" therefore only ever applies to the treatment.
--   * Prices are read from product_variants.retail_price; the client only sends variant_id, qty and the seller.
--   * A Membership amount that falls on products is a wallet deduction (membership_transactions, no `payments` row). `payments` and
--     bookings.final_amount stay treatment-only, so the payment-status trigger and the treatment money model are unchanged.
--
-- DECISIONS to confirm in review
--   * ReferralWallet is treated as treatment-only (its balance maths lives in record_referral_wallet_payment, which writes a
--     treatment `payments` row; duplicating it for products was not worth it).
--   * A product with a retail price of 0 cannot be sold (a sale needs >= 1 payment row of > 0).
--   * A sale that was refunded stays in product_sale_payments (history), like the ledger.
--
-- ROLLBACK (loses the commission settings and the per-method rows)
--   Restore sell_product from migration-345; DROP FUNCTION checkout_booking_with_products, _sell_product_line, _checkout_membership_deduct,
--   _inv_day_locked, _is_treatment_only_mode; DROP TABLE product_sale_payments; drop the columns above;
--   DELETE FROM public.schema_migrations WHERE version = '346'.

BEGIN;

-- ============================================================
-- 1. Columns
-- ============================================================
ALTER TABLE public.product_sales
  ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES public.bookings(id),
  ADD COLUMN IF NOT EXISTS sold_by_therapist_id uuid REFERENCES public.therapists(id);
CREATE INDEX IF NOT EXISTS idx_product_sales_booking ON public.product_sales (booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_product_sales_sold_by_therapist ON public.product_sales (sold_by_therapist_id, created_at) WHERE sold_by_therapist_id IS NOT NULL;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS earns_commission boolean NOT NULL DEFAULT true;

ALTER TABLE public.staff_compensation
  ADD COLUMN IF NOT EXISTS product_commission_rate numeric NOT NULL DEFAULT 0;
ALTER TABLE public.staff_compensation DROP CONSTRAINT IF EXISTS staff_compensation_product_commission_rate_check;
ALTER TABLE public.staff_compensation ADD CONSTRAINT staff_compensation_product_commission_rate_check
  CHECK (product_commission_rate >= 0 AND product_commission_rate <= 100);

ALTER TABLE public.payroll_items
  ADD COLUMN IF NOT EXISTS product_revenue numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS product_commission_rate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS product_commission numeric NOT NULL DEFAULT 0,            -- earned this month (before the deduction below)
  ADD COLUMN IF NOT EXISTS product_commission_deduction numeric NOT NULL DEFAULT 0;  -- refunds of earlier, already-paid months

ALTER TABLE public.daily_reports ADD COLUMN IF NOT EXISTS product_revenue numeric(12,2) NOT NULL DEFAULT 0;

-- ============================================================
-- 2. product_sale_payments (append-only)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.product_sale_payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id      uuid NOT NULL REFERENCES public.product_sales(id),
  org_id       uuid NOT NULL REFERENCES public.organizations(id),
  payment_mode text NOT NULL CHECK (length(btrim(payment_mode)) > 0 AND length(payment_mode) <= 40),
  amount       numeric(10,2) NOT NULL CHECK (amount > 0),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_psp_sale ON public.product_sale_payments (sale_id);
CREATE INDEX IF NOT EXISTS idx_psp_org_created ON public.product_sale_payments (org_id, created_at);
ALTER TABLE public.product_sale_payments ENABLE ROW LEVEL SECURITY;

-- Anyone who can read product_sales today (any role of the org) can read how it was paid. No write policies: the RPCs write it.
DROP POLICY IF EXISTS product_sale_payments_select ON public.product_sale_payments;
CREATE POLICY product_sale_payments_select ON public.product_sale_payments FOR SELECT TO authenticated
  USING (org_id = (SELECT get_user_org_id()));
REVOKE ALL ON public.product_sale_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.product_sale_payments TO authenticated;

CREATE OR REPLACE FUNCTION public.product_sale_payments_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'product_sale_payments is append-only' USING ERRCODE = 'P0001';
END $$;
DROP TRIGGER IF EXISTS trg_psp_append_only ON public.product_sale_payments;
CREATE TRIGGER trg_psp_append_only BEFORE UPDATE OR DELETE ON public.product_sale_payments
  FOR EACH ROW EXECUTE FUNCTION public.product_sale_payments_append_only();
DROP TRIGGER IF EXISTS trg_psp_no_truncate ON public.product_sale_payments;
CREATE TRIGGER trg_psp_no_truncate BEFORE TRUNCATE ON public.product_sale_payments
  FOR EACH STATEMENT EXECUTE FUNCTION public.product_sale_payments_append_only();

-- Backfill (first run only): one row per existing sale, from its single payment_mode.
DO $$
DECLARE n integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.product_sale_payments) THEN
    RAISE NOTICE '346 backfill: skipped (product_sale_payments already has rows)';
    RETURN;
  END IF;
  INSERT INTO public.product_sale_payments (sale_id, org_id, payment_mode, amount, created_at)
  SELECT s.id, s.org_id, s.payment_mode, s.total_amount, s.created_at FROM public.product_sales s WHERE s.total_amount > 0;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '346 backfill: % product_sale_payments rows created for existing sales (% sales have no total and get none)', n,
    (SELECT count(*) FROM public.product_sales WHERE total_amount <= 0);
END $$;

-- ============================================================
-- 3. Private helpers
-- ============================================================
-- Credits that can only pay the treatment, never a product.
CREATE OR REPLACE FUNCTION public._is_treatment_only_mode(p_mode text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT p_mode IN ('VoucherWallet', 'ReferralVoucher', 'SessionPackage', 'ReferralWallet');
$$;

-- Has the branch closed today (Nepal)? Closing writes a daily_reports row; sales and checkouts are refused after that, like bookings.
CREATE OR REPLACE FUNCTION public._inv_day_locked(p_branch_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.daily_reports d
                  WHERE d.branch_id = p_branch_id AND d.report_date = (now() AT TIME ZONE 'Asia/Kathmandu')::date AND d.is_locked);
$$;

-- Take money for products out of the guest's membership wallet. Same lookup and balance check as record_membership_payment, but it
-- writes ONLY the wallet transaction (no `payments` row: that table is treatment-only). The balance itself is kept by the trigger on
-- membership_transactions, as everywhere else.
CREATE OR REPLACE FUNCTION public._checkout_membership_deduct(p_booking_id uuid, p_amount numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid := get_user_org_id(); v_customer uuid; v_branch uuid; v_mem uuid; v_balance numeric(12,2);
BEGIN
  SELECT b.customer_id, b.branch_id INTO v_customer, v_branch FROM public.bookings b WHERE b.id = p_booking_id;
  IF v_customer IS NULL THEN
    RAISE EXCEPTION 'The membership wallet needs a guest profile on the booking (walk-ins cannot use a wallet).';
  END IF;
  SELECT id, balance INTO v_mem, v_balance FROM public.memberships
   WHERE org_id = v_org AND customer_id = v_customer ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF v_mem IS NULL THEN RAISE EXCEPTION 'This guest has no membership wallet.'; END IF;
  IF v_balance < p_amount THEN
    RAISE EXCEPTION 'Not enough in the membership wallet (have NPR %, need NPR %).', v_balance, p_amount;
  END IF;
  INSERT INTO public.membership_transactions (membership_id, org_id, kind, amount, payment_mode, booking_id, payment_id, performed_by, notes, branch_id)
  VALUES (v_mem, v_org, 'deduction', -p_amount, NULL, p_booking_id, NULL, auth.uid(), 'Products at checkout', v_branch);
END $$;

-- One product line: validate, check stock under lock, price from the DB, write the sale + its per-method payment rows + the ledger.
-- p_payments = [{ payment_mode, amount }] adding up to the total; NULL = one row { p_fallback_mode, total }.
-- The caller has already checked who may sell, the branch / customer / booking, and the locked day.
CREATE OR REPLACE FUNCTION public._sell_product_line(
  p_variant_id uuid, p_qty integer, p_branch_id uuid, p_customer_id uuid, p_booking_id uuid, p_sold_by_therapist_id uuid,
  p_payments jsonb, p_fallback_mode text, p_notes text)
RETURNS public.product_sales LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid := get_user_org_id(); v_var public.product_variants; v_prod public.products; v_branch text; v_avail integer;
  v_total numeric(10,2); v_label text; v_pay jsonb; v_payments jsonb; v_sum numeric(10,2) := 0; v_mode text; v_amt numeric(10,2);
  v_n integer; v_sale public.product_sales; v_cost numeric;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be greater than zero.'; END IF;
  SELECT * INTO v_var FROM public.product_variants WHERE id = p_variant_id AND org_id = v_org;
  IF v_var.id IS NULL THEN RAISE EXCEPTION 'That product was not found in your organization.'; END IF;
  SELECT * INTO v_prod FROM public.products WHERE id = v_var.product_id FOR UPDATE;
  v_label := btrim(v_prod.name || ' ' || COALESCE(v_var.name, ''));
  IF NOT v_prod.is_active OR NOT v_var.is_active THEN RAISE EXCEPTION '%: this product is not active.', v_label; END IF;
  IF NOT v_prod.sell_at_checkout THEN RAISE EXCEPTION '%: this product is not for sale.', v_label; END IF;
  IF v_var.retail_price <= 0 THEN RAISE EXCEPTION '%: this product has no price yet.', v_label; END IF;

  IF p_sold_by_therapist_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.therapists t WHERE t.id = p_sold_by_therapist_id AND t.org_id = v_org AND t.is_active IS NOT FALSE) THEN
    RAISE EXCEPTION 'The seller was not found in your organization.';
  END IF;

  IF v_prod.track_stock THEN
    INSERT INTO public.product_branch_stock (product_id, variant_id, branch_id, quantity)
    VALUES (v_prod.id, p_variant_id, p_branch_id, 0) ON CONFLICT (variant_id, branch_id) DO NOTHING;
    SELECT quantity INTO v_avail FROM public.product_branch_stock WHERE variant_id = p_variant_id AND branch_id = p_branch_id FOR UPDATE;
    IF COALESCE(v_avail, 0) < p_qty THEN
      SELECT name INTO v_branch FROM public.branches WHERE id = p_branch_id;
      -- HINT lets the checkout screen mark exactly this line ("STOCK:<variant>:<left>").
      RAISE EXCEPTION '%: only % left at %', v_label, COALESCE(v_avail, 0), v_branch
        USING ERRCODE = 'P0001', HINT = 'STOCK:' || p_variant_id || ':' || COALESCE(v_avail, 0);
    END IF;
  END IF;

  v_total := round(v_var.retail_price * p_qty, 2);
  v_payments := COALESCE(p_payments, jsonb_build_array(jsonb_build_object('payment_mode', p_fallback_mode, 'amount', v_total)));
  IF jsonb_typeof(v_payments) <> 'array' OR jsonb_array_length(v_payments) = 0 THEN RAISE EXCEPTION '%: no payment given.', v_label; END IF;
  FOR v_pay IN SELECT * FROM jsonb_array_elements(v_payments) LOOP
    v_mode := v_pay->>'payment_mode'; v_amt := (v_pay->>'amount')::numeric;
    IF v_mode IS NULL OR length(btrim(v_mode)) = 0 OR length(v_mode) > 40 THEN RAISE EXCEPTION 'A payment method is required (40 characters or fewer).'; END IF;
    IF v_amt IS NULL OR v_amt <= 0 THEN RAISE EXCEPTION 'Each payment amount must be greater than zero.'; END IF;
    v_sum := round(v_sum + v_amt, 2);
  END LOOP;
  IF v_sum <> v_total THEN RAISE EXCEPTION '%: payments (NPR %) must add up to the price (NPR %).', v_label, v_sum, v_total; END IF;
  v_n := jsonb_array_length(v_payments);

  INSERT INTO public.product_sales (org_id, branch_id, product_id, variant_id, variant_name, product_name, quantity, unit_price_npr, total_amount,
                                    payment_mode, customer_id, sold_by, notes, booking_id, sold_by_therapist_id)
  VALUES (v_org, p_branch_id, v_prod.id, p_variant_id, NULLIF(btrim(v_var.name), ''), v_prod.name, p_qty, v_var.retail_price, v_total,
          CASE WHEN v_n = 1 THEN v_payments->0->>'payment_mode' ELSE 'Split' END, p_customer_id, auth.uid(), p_notes, p_booking_id, p_sold_by_therapist_id)
  RETURNING * INTO v_sale;

  INSERT INTO public.product_sale_payments (sale_id, org_id, payment_mode, amount)
  SELECT v_sale.id, v_org, e->>'payment_mode', (e->>'amount')::numeric FROM jsonb_array_elements(v_payments) e;

  IF v_prod.track_stock THEN
    v_cost := public._inv_unit_cost(p_variant_id);
    PERFORM public._inv_apply(p_variant_id, p_branch_id, -p_qty, 'sale', v_cost, NULL, v_sale.id, NULL, NULL);
  END IF;
  RETURN v_sale;
END $$;

REVOKE ALL ON FUNCTION public._is_treatment_only_mode(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._inv_day_locked(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._checkout_membership_deduct(uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._sell_product_line(uuid, integer, uuid, uuid, uuid, uuid, jsonb, text, text) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 4. sell_product v3 (stand-alone sale from the Products page; can be attached to a visit)
-- ============================================================
DROP FUNCTION IF EXISTS public.sell_product(uuid, integer, text, uuid, uuid, text);
CREATE OR REPLACE FUNCTION public.sell_product(
  p_variant_id uuid, p_quantity integer, p_payment_mode text, p_branch_id uuid,
  p_customer_id uuid DEFAULT NULL, p_notes text DEFAULT NULL,
  p_sold_by_therapist_id uuid DEFAULT NULL, p_booking_id uuid DEFAULT NULL, p_payments jsonb DEFAULT NULL)
RETURNS public.product_sales LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role user_role := get_user_role(); v_org uuid := get_user_org_id(); v_branch_org uuid; v_customer_org uuid; v_b record; v_pay jsonb; v_customer uuid := p_customer_id;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('staff', 'manager', 'admin') THEN RAISE EXCEPTION 'sell_product: staff, manager, or admin role required'; END IF;

  SELECT org_id INTO v_branch_org FROM public.branches WHERE id = p_branch_id;
  IF v_branch_org IS NULL OR v_branch_org IS DISTINCT FROM v_org THEN RAISE EXCEPTION 'sell_product: branch is not in your organization'; END IF;
  IF public._inv_day_locked(p_branch_id) THEN RAISE EXCEPTION 'sell_product: today has been closed at this branch'; END IF;

  IF p_customer_id IS NOT NULL THEN
    SELECT org_id INTO v_customer_org FROM public.customers WHERE id = p_customer_id;
    IF v_customer_org IS NULL OR v_customer_org IS DISTINCT FROM v_org THEN RAISE EXCEPTION 'sell_product: customer is not in your organization'; END IF;
  END IF;

  IF p_booking_id IS NOT NULL THEN
    SELECT b.branch_id, b.customer_id, b.status, br.org_id AS org INTO v_b
      FROM public.bookings b JOIN public.branches br ON br.id = b.branch_id WHERE b.id = p_booking_id;
    IF v_b.org IS NULL OR v_b.org IS DISTINCT FROM v_org THEN RAISE EXCEPTION 'sell_product: booking is not in your organization'; END IF;
    IF v_b.branch_id IS DISTINCT FROM p_branch_id THEN RAISE EXCEPTION 'sell_product: that booking is at another branch'; END IF;
    IF v_b.status IN ('Cancelled', 'No Show') THEN RAISE EXCEPTION 'sell_product: that booking was %', lower(v_b.status); END IF;
    IF p_customer_id IS NOT NULL AND v_b.customer_id IS NOT NULL AND v_b.customer_id IS DISTINCT FROM p_customer_id THEN
      RAISE EXCEPTION 'sell_product: that booking belongs to another guest';
    END IF;
    v_customer := COALESCE(p_customer_id, v_b.customer_id);   -- the sale follows the visit's guest when none was picked
  END IF;

  -- A stand-alone sale is paid with money methods; wallets and vouchers are taken at checkout.
  IF p_payments IS NOT NULL THEN
    IF jsonb_typeof(p_payments) = 'array' THEN
      FOR v_pay IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
        IF v_pay->>'payment_mode' IN ('Membership', 'ReferralWallet', 'VoucherWallet', 'ReferralVoucher', 'SessionPackage') THEN
          RAISE EXCEPTION 'sell_product: wallets, vouchers and packages are used at checkout, not on a stand-alone sale';
        END IF;
      END LOOP;
    END IF;
  ELSIF p_payment_mode IS NULL OR length(trim(p_payment_mode)) = 0 OR length(p_payment_mode) > 40 THEN
    RAISE EXCEPTION 'sell_product: payment_mode is required and must be 40 characters or fewer';
  ELSIF p_payment_mode IN ('Membership', 'ReferralWallet', 'VoucherWallet', 'ReferralVoucher', 'SessionPackage') THEN
    RAISE EXCEPTION 'sell_product: wallets, vouchers and packages are used at checkout, not on a stand-alone sale';
  END IF;

  RETURN public._sell_product_line(p_variant_id, p_quantity, p_branch_id, v_customer, p_booking_id,
                                   p_sold_by_therapist_id, p_payments, p_payment_mode, p_notes);
END $$;

-- ============================================================
-- 5. The atomic checkout
-- ============================================================
-- p_tenders  : every method the guest pays with, for the main booking, in the order shown: [{ payment_mode, amount, voucher_id?, package_id?, referral_id? }]
--              (what record_group_payment takes as `tenders`, products money included)
-- p_products : [{ variant_id, qty, sold_by_therapist_id | null }]   (one line per size)
-- p_additional: more bookings paid in the same go (group / earlier dues), exactly record_group_payment entries; products never go there.
-- Returns { payments: <record_group_payment result>, sales: [{ id, variant_id, product_name, variant_name, quantity, unit_price, total_amount,
--           stock_before, stock_after }], products_total, product_payments: [{ payment_mode, amount }] }.
-- Everything happens in this one call: any failure (stock, locked day, validation, wallet) writes nothing.
CREATE OR REPLACE FUNCTION public.checkout_booking_with_products(
  p_booking_id uuid, p_tenders jsonb, p_products jsonb,
  p_notes text DEFAULT NULL, p_due_holder_name text DEFAULT NULL, p_additional jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role user_role := get_user_role(); v_org uuid := get_user_org_id();
  v_b record; v_line jsonb; v_lines jsonb := '[]'::jsonb; v_price numeric(10,2); v_var record;
  v_total numeric(10,2) := 0; v_need numeric(10,2); v_t jsonb; v_mode text; v_amt numeric(10,2); v_take numeric(10,2);
  v_treat jsonb := '[]'::jsonb; v_sl_mode text[] := '{}'; v_sl_amt numeric[] := '{}'; v_seen uuid[] := '{}';
  v_line_total numeric(10,2); v_pays jsonb; v_i integer; v_left numeric(10,2); v_member numeric(10,2) := 0;
  v_sale public.product_sales; v_sales jsonb := '[]'::jsonb; v_pay_result jsonb; v_entry jsonb; v_before integer; v_after integer;
  v_prod_pays jsonb := '[]'::jsonb; v_given numeric(10,2) := 0;
  v_tm text[]; v_ta numeric[]; v_tj jsonb[]; v_pass integer; v_i2 integer;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('staff', 'manager', 'admin') THEN
    RAISE EXCEPTION 'checkout_booking_with_products: staff, manager, or admin role required';
  END IF;

  SELECT b.id, b.branch_id, b.customer_id, b.status, b.is_locked, br.org_id AS org INTO v_b
    FROM public.bookings b JOIN public.branches br ON br.id = b.branch_id WHERE b.id = p_booking_id FOR UPDATE OF b;
  IF v_b.id IS NULL THEN RAISE EXCEPTION 'checkout_booking_with_products: booking not found'; END IF;
  IF v_b.org IS DISTINCT FROM v_org THEN RAISE EXCEPTION 'checkout_booking_with_products: booking is not in your organization'; END IF;
  IF jsonb_typeof(COALESCE(p_tenders, '[]'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'checkout_booking_with_products: tenders must be a list'; END IF;
  IF p_products IS NOT NULL AND jsonb_typeof(p_products) <> 'array' THEN RAISE EXCEPTION 'checkout_booking_with_products: products must be a list'; END IF;

  -- 1. Price every line from the database (never from the client). Sorted by size so two checkouts lock in the same order.
  FOR v_line IN SELECT e FROM jsonb_array_elements(COALESCE(p_products, '[]'::jsonb)) e ORDER BY e->>'variant_id' LOOP
    IF (v_line->>'variant_id') IS NULL OR COALESCE((v_line->>'qty')::integer, 0) <= 0 THEN
      RAISE EXCEPTION 'Each product line needs a size and a quantity above zero.';
    END IF;
    IF (v_line->>'variant_id')::uuid = ANY (v_seen) THEN RAISE EXCEPTION 'The same product appears twice; use the quantity instead.'; END IF;
    v_seen := v_seen || (v_line->>'variant_id')::uuid;
    SELECT pv.id, pv.retail_price, p.name INTO v_var FROM public.product_variants pv JOIN public.products p ON p.id = pv.product_id
     WHERE pv.id = (v_line->>'variant_id')::uuid AND pv.org_id = v_org;
    IF v_var.id IS NULL THEN RAISE EXCEPTION 'That product was not found in your organization.'; END IF;
    v_price := round(v_var.retail_price * (v_line->>'qty')::integer, 2);
    v_total := round(v_total + v_price, 2);
    v_lines := v_lines || jsonb_build_array(v_line || jsonb_build_object('line_total', v_price));
  END LOOP;

  -- 2. Allocate the tenders. Treatment-only credits never pay products. PLAIN money methods (cash, card, wallets of the org's list...)
  --    fill the products first, in the order listed; the Membership wallet only covers what they leave unpaid; the treatment gets
  --    whatever is left, in the original order (so by default the wallet goes to the treatment).
  v_need := v_total;
  SELECT array_agg(x.e->>'payment_mode' ORDER BY x.o), array_agg(round(COALESCE((x.e->>'amount')::numeric, 0), 2) ORDER BY x.o), array_agg(x.e ORDER BY x.o)
    INTO v_tm, v_ta, v_tj
    FROM jsonb_array_elements(COALESCE(p_tenders, '[]'::jsonb)) WITH ORDINALITY AS x(e, o);
  FOR v_pass IN 1 .. 2 LOOP                      -- pass 1: plain money, pass 2: the Membership wallet
    FOR v_i IN 1 .. COALESCE(array_length(v_tm, 1), 0) LOOP
      CONTINUE WHEN v_need <= 0 OR v_ta[v_i] <= 0 OR public._is_treatment_only_mode(v_tm[v_i]);
      CONTINUE WHEN (v_pass = 1) = (v_tm[v_i] = 'Membership');
      v_take := least(v_ta[v_i], v_need);
      v_sl_mode := v_sl_mode || v_tm[v_i]; v_sl_amt := v_sl_amt || v_take;
      v_prod_pays := v_prod_pays || jsonb_build_array(jsonb_build_object('payment_mode', v_tm[v_i], 'amount', v_take));
      v_ta[v_i] := round(v_ta[v_i] - v_take, 2);
      v_need := round(v_need - v_take, 2);
    END LOOP;
  END LOOP;
  FOR v_i IN 1 .. COALESCE(array_length(v_tm, 1), 0) LOOP
    IF v_ta[v_i] > 0 THEN v_treat := v_treat || jsonb_set(v_tj[v_i], '{amount}', to_jsonb(v_ta[v_i])); END IF;
  END LOOP;
  IF v_need > 0 THEN
    SELECT COALESCE(SUM(round((e->>'amount')::numeric, 2)), 0) INTO v_given FROM jsonb_array_elements(COALESCE(p_tenders, '[]'::jsonb)) e
     WHERE NOT public._is_treatment_only_mode(e->>'payment_mode');
    RAISE EXCEPTION 'Products are paid in full today: they come to NPR %, but cash, card, wallets and the membership wallet only cover NPR %. Vouchers and packages pay the treatment only.', v_total, v_given
      USING ERRCODE = 'P0001', HINT = 'PRODUCTS_UNDERPAID';
  END IF;

  -- 3. Products (only when there are some)
  IF v_total > 0 THEN
    IF public._inv_day_locked(v_b.branch_id) THEN RAISE EXCEPTION 'Today has been closed at this branch, so products cannot be sold.'; END IF;
    IF v_b.status IN ('Cancelled', 'No Show') THEN RAISE EXCEPTION 'This booking was %.', lower(v_b.status); END IF;

    SELECT COALESCE(SUM(a), 0) INTO v_member FROM unnest(v_sl_mode, v_sl_amt) AS s(m, a) WHERE m = 'Membership';
    IF v_member > 0 THEN PERFORM public._checkout_membership_deduct(p_booking_id, v_member); END IF;

    FOR v_line IN SELECT e FROM jsonb_array_elements(v_lines) e LOOP
      -- take this line's share from the product slices, in order
      v_line_total := (v_line->>'line_total')::numeric; v_left := v_line_total; v_pays := '[]'::jsonb;
      FOR v_i IN 1 .. COALESCE(array_length(v_sl_mode, 1), 0) LOOP
        EXIT WHEN v_left <= 0;
        CONTINUE WHEN v_sl_amt[v_i] <= 0;
        v_take := least(v_sl_amt[v_i], v_left);
        v_pays := v_pays || jsonb_build_array(jsonb_build_object('payment_mode', v_sl_mode[v_i], 'amount', v_take));
        v_sl_amt[v_i] := round(v_sl_amt[v_i] - v_take, 2); v_left := round(v_left - v_take, 2);
      END LOOP;

      v_before := COALESCE((SELECT quantity FROM public.product_branch_stock
                             WHERE variant_id = (v_line->>'variant_id')::uuid AND branch_id = v_b.branch_id), 0);
      v_sale := public._sell_product_line((v_line->>'variant_id')::uuid, (v_line->>'qty')::integer, v_b.branch_id, v_b.customer_id, p_booking_id,
                                          NULLIF(v_line->>'sold_by_therapist_id', '')::uuid, v_pays, NULL, NULL);
      v_after := COALESCE((SELECT quantity FROM public.product_branch_stock WHERE variant_id = v_sale.variant_id AND branch_id = v_b.branch_id), 0);
      v_sales := v_sales || jsonb_build_array(jsonb_build_object(
        'id', v_sale.id, 'variant_id', v_sale.variant_id, 'product_name', v_sale.product_name, 'variant_name', v_sale.variant_name,
        'quantity', v_sale.quantity, 'unit_price', v_sale.unit_price_npr, 'total_amount', v_sale.total_amount,
        'stock_before', v_before, 'stock_after', v_after, 'sold_by_therapist_id', v_sale.sold_by_therapist_id));
    END LOOP;
  END IF;

  -- 4. The treatment: exactly the existing group payment, with what the products left over.
  v_entry := jsonb_build_object('booking_id', p_booking_id, 'tenders', v_treat, 'notes', p_notes);
  IF NULLIF(btrim(COALESCE(p_due_holder_name, '')), '') IS NOT NULL THEN v_entry := v_entry || jsonb_build_object('due_holder_name', p_due_holder_name); END IF;
  v_pay_result := public.record_group_payment(jsonb_build_array(v_entry) || COALESCE(p_additional, '[]'::jsonb));

  RETURN jsonb_build_object('payments', v_pay_result, 'sales', v_sales, 'products_total', v_total, 'product_payments', v_prod_pays);
END $$;

-- ============================================================
-- 6. save_product: earns_commission (a key that is absent keeps the value)
-- ============================================================
CREATE OR REPLACE FUNCTION public.save_product(
  p_product_id uuid, p_product jsonb, p_variants jsonb, p_opening jsonb DEFAULT '[]'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid := get_user_org_id(); v_id uuid := p_product_id; v_track boolean; v_i integer := 0; v_el jsonb; v_vid uuid;
  v_ids uuid[] := '{}'; v_has_cost boolean; v_min numeric; v_name text; v_sku text; v_cost numeric; v_o jsonb; v_names text[] := '{}';
BEGIN
  IF get_user_role() IS NULL OR get_user_role() NOT IN ('manager', 'admin') THEN RAISE EXCEPTION 'save_product: manager or admin role required'; END IF;
  IF jsonb_typeof(p_variants) IS DISTINCT FROM 'array' OR jsonb_array_length(p_variants) = 0 THEN
    RAISE EXCEPTION 'save_product: a product needs at least one size';
  END IF;
  IF NULLIF(btrim(p_product->>'name'), '') IS NULL AND p_product_id IS NULL THEN RAISE EXCEPTION 'save_product: name is required'; END IF;
  IF p_product ? 'supplier_id' AND NULLIF(p_product->>'supplier_id', '') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.suppliers s WHERE s.id = (p_product->>'supplier_id')::uuid AND s.org_id = v_org) THEN
    RAISE EXCEPTION 'save_product: supplier not found in your organization';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.products (org_id, name, description, brand, category, supplier_id, image_url, option_label, pro_use,
                                 sell_at_checkout, track_stock, notify_low, is_active, earns_commission, price_npr)
    VALUES (v_org, btrim(p_product->>'name'), NULLIF(p_product->>'description', ''), NULLIF(btrim(p_product->>'brand'), ''),
            NULLIF(btrim(p_product->>'category'), ''), NULLIF(p_product->>'supplier_id', '')::uuid, NULLIF(p_product->>'image_url', ''),
            NULLIF(btrim(p_product->>'option_label'), ''), COALESCE((p_product->>'pro_use')::boolean, false),
            COALESCE((p_product->>'sell_at_checkout')::boolean, true), COALESCE((p_product->>'track_stock')::boolean, false),
            COALESCE((p_product->>'notify_low')::boolean, true), COALESCE((p_product->>'is_active')::boolean, true),
            COALESCE((p_product->>'earns_commission')::boolean, true), 0)
    RETURNING id INTO v_id;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = v_id AND org_id = v_org) THEN
      RAISE EXCEPTION 'save_product: product not found in your organization';
    END IF;
    UPDATE public.products p SET
      name = COALESCE(NULLIF(btrim(p_product->>'name'), ''), p.name),
      description = CASE WHEN p_product ? 'description' THEN NULLIF(p_product->>'description', '') ELSE p.description END,
      brand = CASE WHEN p_product ? 'brand' THEN NULLIF(btrim(p_product->>'brand'), '') ELSE p.brand END,
      category = CASE WHEN p_product ? 'category' THEN NULLIF(btrim(p_product->>'category'), '') ELSE p.category END,
      supplier_id = CASE WHEN p_product ? 'supplier_id' THEN NULLIF(p_product->>'supplier_id', '')::uuid ELSE p.supplier_id END,
      image_url = CASE WHEN p_product ? 'image_url' THEN NULLIF(p_product->>'image_url', '') ELSE p.image_url END,
      option_label = CASE WHEN p_product ? 'option_label' THEN NULLIF(btrim(p_product->>'option_label'), '') ELSE p.option_label END,
      pro_use = COALESCE((p_product->>'pro_use')::boolean, p.pro_use),
      sell_at_checkout = COALESCE((p_product->>'sell_at_checkout')::boolean, p.sell_at_checkout),
      track_stock = COALESCE((p_product->>'track_stock')::boolean, p.track_stock),
      notify_low = COALESCE((p_product->>'notify_low')::boolean, p.notify_low),
      is_active = COALESCE((p_product->>'is_active')::boolean, p.is_active),
      earns_commission = COALESCE((p_product->>'earns_commission')::boolean, p.earns_commission)
    WHERE p.id = v_id;
  END IF;

  FOR v_el IN SELECT * FROM jsonb_array_elements(p_variants) LOOP
    v_i := v_i + 1;
    v_name := NULLIF(btrim(v_el->>'name'), '');
    v_sku  := NULLIF(btrim(v_el->>'sku'), '');
    IF jsonb_array_length(p_variants) > 1 AND v_name IS NULL THEN RAISE EXCEPTION 'save_product: every size needs a name'; END IF;
    IF lower(COALESCE(v_name, '')) = ANY (v_names) THEN RAISE EXCEPTION 'save_product: two sizes are both called "%"', v_name; END IF;
    v_names := v_names || lower(COALESCE(v_name, ''));
    v_cost := NULLIF(v_el->>'cost_price', '')::numeric;
    v_has_cost := (v_el ? 'cost_price');   -- an absent key keeps the stored supply price; a present key (even null) sets it
    v_vid := NULLIF(v_el->>'id', '')::uuid;

    IF v_vid IS NOT NULL THEN
      UPDATE public.product_variants SET name = v_name, sku = v_sku, barcode = NULLIF(btrim(v_el->>'barcode'), ''),
             retail_price = COALESCE(NULLIF(v_el->>'retail_price', '')::numeric, 0),
             low_stock_level = NULLIF(v_el->>'low_stock_level', '')::integer, reorder_qty = NULLIF(v_el->>'reorder_qty', '')::integer,
             sort_order = v_i, is_active = COALESCE((v_el->>'is_active')::boolean, true)
       WHERE id = v_vid AND product_id = v_id AND org_id = v_org;
      IF NOT FOUND THEN RAISE EXCEPTION 'save_product: size not found on this product'; END IF;
    ELSE
      INSERT INTO public.product_variants (org_id, product_id, name, sku, barcode, retail_price, low_stock_level, reorder_qty, sort_order, is_active)
      VALUES (v_org, v_id, v_name, v_sku, NULLIF(btrim(v_el->>'barcode'), ''), COALESCE(NULLIF(v_el->>'retail_price', '')::numeric, 0),
              NULLIF(v_el->>'low_stock_level', '')::integer, NULLIF(v_el->>'reorder_qty', '')::integer, v_i,
              COALESCE((v_el->>'is_active')::boolean, true))
      RETURNING id INTO v_vid;
    END IF;
    v_ids := v_ids || v_vid;

    -- cost_price is the last/standard supply price. A brand-new size starts its average at that price, and a size whose average is
    -- still unknown (0) takes it as its average too. A known average is never overwritten here (only receives move it).
    INSERT INTO public.product_variant_costs (variant_id, org_id, cost_price, avg_cost)
    VALUES (v_vid, v_org, v_cost, COALESCE(v_cost, 0))
    ON CONFLICT (variant_id) DO UPDATE SET
      cost_price = CASE WHEN v_has_cost THEN EXCLUDED.cost_price ELSE product_variant_costs.cost_price END,
      avg_cost = CASE WHEN product_variant_costs.avg_cost = 0 AND v_has_cost AND EXCLUDED.cost_price IS NOT NULL
                      THEN EXCLUDED.cost_price ELSE product_variant_costs.avg_cost END;
  END LOOP;

  -- Sizes that were left out.
  DELETE FROM public.product_variants v
   WHERE v.product_id = v_id AND v.id <> ALL (v_ids)
     AND NOT EXISTS (SELECT 1 FROM public.product_sales s WHERE s.variant_id = v.id)
     AND NOT EXISTS (SELECT 1 FROM public.product_stock_movements m WHERE m.variant_id = v.id)
     AND NOT EXISTS (SELECT 1 FROM public.product_stock_transfers t WHERE t.variant_id = v.id);
  UPDATE public.product_variants SET is_active = false WHERE product_id = v_id AND id <> ALL (v_ids);

  SELECT MIN(retail_price) FILTER (WHERE is_active), MIN(retail_price) INTO v_min, v_cost FROM public.product_variants WHERE product_id = v_id;
  UPDATE public.products SET price_npr = COALESCE(v_min, v_cost, 0) WHERE id = v_id;

  -- Opening stock (create only): goes through the same receive path, so the ledger and the average cost agree.
  IF p_product_id IS NULL AND jsonb_typeof(p_opening) = 'array' THEN
    SELECT track_stock INTO v_track FROM public.products WHERE id = v_id;
    FOR v_o IN SELECT * FROM jsonb_array_elements(p_opening) LOOP
      CONTINUE WHEN COALESCE((v_o->>'qty')::integer, 0) <= 0;
      IF NOT v_track THEN RAISE EXCEPTION 'save_product: turn on "Count stock" to set opening stock'; END IF;
      IF NOT public._inv_branch_ok((v_o->>'branch_id')::uuid) THEN RAISE EXCEPTION 'save_product: you do not have access to that branch'; END IF;
      v_vid := v_ids[(v_o->>'idx')::integer];
      IF v_vid IS NULL THEN RAISE EXCEPTION 'save_product: opening stock refers to a size that does not exist'; END IF;
      PERFORM public._inv_receive(v_vid, (v_o->>'branch_id')::uuid, (v_o->>'qty')::integer,
        (SELECT cost_price FROM public.product_variant_costs WHERE variant_id = v_vid), NULLIF(p_product->>'supplier_id', '')::uuid,
        'Opening stock', 'received');
    END LOOP;
  END IF;
  RETURN v_id;
END $$;

-- ============================================================
-- 6b. record_group_payment (migration-178): fixes a live bug since migration-178
-- ============================================================
-- Identical to the migration-178 function except the one marked line: v_tender_total only adds the SessionPackage residual when
-- there is a SessionPackage tender. Effects of the fix: amount_due / fully_paid in the result are now true, a part payment now needs
-- a due holder name (server-side), and credit_pending_referral_for_booking is only reached for a settled booking.
CREATE OR REPLACE FUNCTION public.record_group_payment(p_payments jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role                user_role := get_user_role();
  v_org                 uuid      := get_user_org_id();
  v_entry                jsonb;
  v_tender                jsonb;
  v_booking_id            uuid;
  v_booking               record;
  v_branch_org            uuid;
  v_collected             numeric(10,2);
  v_remaining             numeric(10,2);
  v_notes                 text;
  v_due_holder            text;
  v_npr_tender_total      numeric(10,2);
  v_tender_amt            numeric(10,2);
  v_tender_mode           text;
  v_session_package_count int;
  v_session_package_residual numeric(10,2);
  v_session_package_share numeric(10,2);
  v_session_package_idx   int;
  v_session_package_distributed numeric(10,2);
  v_tender_total          numeric(10,2);
  v_leftover              numeric(10,2);
  v_other_count           int;
  v_membership_total      numeric(10,2);
  v_referral_wallet_total numeric(10,2);
  v_voucher_pool_total    numeric(10,2);
  v_any_prior             boolean;
  v_row_notes             text;
  v_payment_id            uuid;
  v_results               jsonb := '[]'::jsonb;
BEGIN
  IF v_role NOT IN ('staff','manager','admin') THEN
    RAISE EXCEPTION 'record_group_payment: staff, manager, or admin role required';
  END IF;

  IF p_payments IS NULL OR jsonb_typeof(p_payments) != 'array' OR jsonb_array_length(p_payments) = 0 THEN
    RAISE EXCEPTION 'record_group_payment: p_payments must be a non-empty JSON array';
  END IF;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_payments)
  LOOP
    v_booking_id := (v_entry->>'booking_id')::uuid;
    v_notes := v_entry->>'notes';

    IF v_booking_id IS NULL THEN
      RAISE EXCEPTION 'record_group_payment: each entry requires a booking_id';
    END IF;

    -- Lock the row for the duration of this transaction — prevents two
    -- concurrent calls to THIS RPC from racing each other on the same
    -- booking. Does not protect against a concurrent plain recordPayment()
    -- call (src/services/api.js), which takes no lock — that race
    -- pre-exists this migration and isn't introduced or closed by it.
    SELECT b.id, b.branch_id, b.status, b.payment_status, b.final_amount,
           b.is_locked, b.due_holder_name
      INTO v_booking
      FROM public.bookings b
      WHERE b.id = v_booking_id
      FOR UPDATE;

    IF v_booking IS NULL THEN
      RAISE EXCEPTION 'record_group_payment: booking % not found', v_booking_id;
    END IF;

    SELECT org_id INTO v_branch_org FROM public.branches WHERE id = v_booking.branch_id;
    IF v_branch_org IS NULL OR v_branch_org IS DISTINCT FROM v_org THEN
      RAISE EXCEPTION 'record_group_payment: booking % is not in your organization', v_booking_id;
    END IF;

    IF v_booking.is_locked THEN
      RAISE EXCEPTION 'record_group_payment: booking % — this day has been closed', v_booking_id;
    END IF;

    IF v_booking.payment_status = 'paid' THEN
      RAISE EXCEPTION 'record_group_payment: booking % has already been paid', v_booking_id;
    END IF;

    IF v_booking.status NOT IN ('Confirmed','In-Progress','Completed') THEN
      RAISE EXCEPTION 'record_group_payment: booking % is not in a payable state (%)', v_booking_id, v_booking.status;
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_collected
    FROM public.payments WHERE booking_id = v_booking_id;
    v_remaining := round((v_booking.final_amount - v_collected)::numeric, 2);

    -- Nothing left to collect (e.g. a 100%-discounted booking) but
    -- payment_status isn't 'paid' yet since no payments row exists — settle
    -- with a $0 row (same trigger-firing path recordPayment's own
    -- zero-balance branch uses) and move to the next booking.
    IF v_remaining <= 0 THEN
      INSERT INTO public.payments (booking_id, amount, payment_mode, recorded_by, notes)
      VALUES (v_booking_id, 0, 'No Charge', auth.uid(), v_notes);

      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'booking_id', v_booking_id, 'amount_paid', 0, 'amount_due', 0, 'fully_paid', true
      ));
      CONTINUE;
    END IF;

    -- Validate every non-SessionPackage tender (basic shape + required refs),
    -- mirroring recordPayment()'s per-tender validation loop.
    v_npr_tender_total := 0;
    FOR v_tender IN SELECT * FROM jsonb_array_elements(COALESCE(v_entry->'tenders', '[]'::jsonb))
      WHERE (value->>'payment_mode') IS DISTINCT FROM 'SessionPackage'
    LOOP
      v_tender_amt := (v_tender->>'amount')::numeric;
      v_tender_mode := v_tender->>'payment_mode';

      IF v_tender_amt IS NULL OR v_tender_amt <= 0 THEN
        RAISE EXCEPTION 'record_group_payment: booking % — each tender amount must be greater than zero', v_booking_id;
      END IF;
      IF v_tender_mode IS NULL OR length(btrim(v_tender_mode)) = 0 OR length(v_tender_mode) > 40 THEN
        RAISE EXCEPTION 'record_group_payment: booking % — invalid payment method %', v_booking_id, v_tender_mode;
      END IF;
      IF v_tender_mode = 'ReferralVoucher' AND (v_tender->>'referral_id') IS NULL THEN
        RAISE EXCEPTION 'record_group_payment: booking % — missing referral reference for referral voucher tender', v_booking_id;
      END IF;

      v_npr_tender_total := round((v_npr_tender_total + v_tender_amt)::numeric, 2);
    END LOOP;

    -- SessionPackage shape validation (package_id required) runs BEFORE the
    -- overpayment check below, same order recordPayment() validates in —
    -- so a submission with both a missing package_id AND an overpaying
    -- non-package total gets the same "missing package reference" error
    -- either path would give, not a misleading OVERPAYMENT instead.
    SELECT count(*) INTO v_session_package_count
    FROM jsonb_array_elements(COALESCE(v_entry->'tenders', '[]'::jsonb))
    WHERE value->>'payment_mode' = 'SessionPackage';

    FOR v_tender IN SELECT * FROM jsonb_array_elements(COALESCE(v_entry->'tenders', '[]'::jsonb))
      WHERE value->>'payment_mode' = 'SessionPackage'
    LOOP
      IF (v_tender->>'package_id') IS NULL THEN
        RAISE EXCEPTION 'record_group_payment: booking % — missing package reference for session package tender', v_booking_id;
      END IF;
    END LOOP;

    IF v_npr_tender_total > v_remaining THEN
      RAISE EXCEPTION 'record_group_payment: booking % — payment (NPR %) exceeds remaining balance (NPR %)', v_booking_id, v_npr_tender_total, v_remaining;
    END IF;

    -- SessionPackage tenders settle whatever balance is left after every
    -- other tender above, split evenly (remainder to the last one) — same
    -- residual logic as recordPayment()'s sessionPackageAmounts.
    v_session_package_residual := round((v_remaining - v_npr_tender_total)::numeric, 2);
    v_session_package_share := 0;
    IF v_session_package_count > 0 THEN
      v_session_package_share := floor((v_session_package_residual / v_session_package_count) * 100) / 100;
    END IF;

    -- v_session_package_residual already IS remaining - npr_total (by
    -- construction, never more), so tenderTotal is exactly npr + residual —
    -- any rounding remainder is folded into the LAST session-package
    -- tender's row (handled per-row below), not into this running total.
    -- FIX (migration-346): the residual belongs to SessionPackage tenders only. It used to be added even with none, which made
    -- v_tender_total = the whole remaining balance and v_leftover always 0 (so a part payment reported amount_due 0 /
    -- fully_paid true and the due-holder check below never fired).
    v_tender_total := CASE WHEN v_session_package_count > 0
                           THEN round((v_npr_tender_total + v_session_package_residual)::numeric, 2)
                           ELSE round(v_npr_tender_total::numeric, 2) END;

    v_leftover := round((v_remaining - v_tender_total)::numeric, 2);
    v_due_holder := COALESCE(NULLIF(btrim(v_entry->>'due_holder_name'), ''), v_booking.due_holder_name);

    IF v_leftover > 0 AND v_due_holder IS NULL THEN
      RAISE EXCEPTION 'record_group_payment: booking % — a due holder name is required to leave a balance unpaid', v_booking_id;
    END IF;

    -- ---- Insert/redeem, one category at a time, exactly mirroring
    -- ---- recordPayment()'s step 9. `notes` is attached to whichever row
    -- ---- ends up first, tracked via v_any_prior.
    v_any_prior := false;

    -- "Other" (standard) tenders — plain payments rows.
    v_other_count := 0;
    FOR v_tender IN SELECT * FROM jsonb_array_elements(COALESCE(v_entry->'tenders', '[]'::jsonb))
      WHERE value->>'payment_mode' NOT IN ('Membership','ReferralWallet','ReferralVoucher','VoucherWallet','SessionPackage')
    LOOP
      v_row_notes := CASE WHEN NOT v_any_prior THEN v_notes ELSE NULL END;
      INSERT INTO public.payments (booking_id, amount, payment_mode, recorded_by, notes)
      VALUES (v_booking_id, (v_tender->>'amount')::numeric, v_tender->>'payment_mode', auth.uid(), v_row_notes);
      v_any_prior := true;
      v_other_count := v_other_count + 1;
    END LOOP;

    -- Membership — single pooled deduction.
    SELECT COALESCE(SUM((value->>'amount')::numeric), 0) INTO v_membership_total
    FROM jsonb_array_elements(COALESCE(v_entry->'tenders', '[]'::jsonb))
    WHERE value->>'payment_mode' = 'Membership';

    IF v_membership_total > 0 THEN
      v_row_notes := CASE WHEN NOT v_any_prior THEN v_notes ELSE NULL END;
      PERFORM public.record_membership_payment(v_booking_id, v_membership_total, v_row_notes);
      v_any_prior := true;
    END IF;

    -- ReferralWallet — single pooled deduction.
    SELECT COALESCE(SUM((value->>'amount')::numeric), 0) INTO v_referral_wallet_total
    FROM jsonb_array_elements(COALESCE(v_entry->'tenders', '[]'::jsonb))
    WHERE value->>'payment_mode' = 'ReferralWallet';

    IF v_referral_wallet_total > 0 THEN
      v_row_notes := CASE WHEN NOT v_any_prior THEN v_notes ELSE NULL END;
      PERFORM public.record_referral_wallet_payment(v_booking_id, v_referral_wallet_total, v_row_notes);
      v_any_prior := true;
    END IF;

    -- ReferralVoucher — one discrete redemption per tender (not poolable).
    FOR v_tender IN SELECT * FROM jsonb_array_elements(COALESCE(v_entry->'tenders', '[]'::jsonb))
      WHERE value->>'payment_mode' = 'ReferralVoucher'
    LOOP
      PERFORM public.redeem_referral_voucher((v_tender->>'referral_id')::uuid, v_booking_id);
      v_any_prior := true;
    END LOOP;

    -- VoucherWallet with a voucher_id — one redemption per specific voucher.
    FOR v_tender IN SELECT * FROM jsonb_array_elements(COALESCE(v_entry->'tenders', '[]'::jsonb))
      WHERE value->>'payment_mode' = 'VoucherWallet' AND (value->>'voucher_id') IS NOT NULL
    LOOP
      PERFORM public.record_voucher_wallet_payment(v_booking_id, (v_tender->>'voucher_id')::uuid, (v_tender->>'amount')::numeric, v_notes);
      v_any_prior := true;
    END LOOP;

    -- VoucherWallet with no voucher_id — pooled draw across the customer's vouchers.
    SELECT COALESCE(SUM((value->>'amount')::numeric), 0) INTO v_voucher_pool_total
    FROM jsonb_array_elements(COALESCE(v_entry->'tenders', '[]'::jsonb))
    WHERE value->>'payment_mode' = 'VoucherWallet' AND (value->>'voucher_id') IS NULL;

    IF v_voucher_pool_total > 0 THEN
      v_row_notes := CASE WHEN NOT v_any_prior THEN v_notes ELSE NULL END;
      PERFORM public.record_voucher_wallet_payment_pooled(v_booking_id, v_voucher_pool_total, v_row_notes);
      v_any_prior := true;
    END IF;

    -- SessionPackage — one redemption per tender, each posting its own
    -- payments row (redeem_package_session itself inserts no payments row).
    v_session_package_idx := 0;
    v_session_package_distributed := 0;
    FOR v_tender IN SELECT * FROM jsonb_array_elements(COALESCE(v_entry->'tenders', '[]'::jsonb))
      WHERE value->>'payment_mode' = 'SessionPackage'
    LOOP
      v_session_package_idx := v_session_package_idx + 1;
      PERFORM public.redeem_package_session(
        p_package_id := (v_tender->>'package_id')::uuid,
        p_booking_id := v_booking_id,
        p_branch_claimed_id := v_booking.branch_id
      );

      v_row_notes := CASE WHEN NOT v_any_prior THEN v_notes ELSE NULL END;
      IF v_session_package_idx = v_session_package_count THEN
        -- Last one absorbs any rounding remainder, same as recordPayment().
        INSERT INTO public.payments (booking_id, amount, payment_mode, recorded_by, notes)
        VALUES (v_booking_id, v_session_package_residual - v_session_package_distributed, 'SessionPackage', auth.uid(), v_row_notes);
      ELSE
        INSERT INTO public.payments (booking_id, amount, payment_mode, recorded_by, notes)
        VALUES (v_booking_id, v_session_package_share, 'SessionPackage', auth.uid(), v_row_notes);
        v_session_package_distributed := round((v_session_package_distributed + v_session_package_share)::numeric, 2);
      END IF;
      v_any_prior := true;
    END LOOP;

    IF v_due_holder IS DISTINCT FROM v_booking.due_holder_name THEN
      UPDATE public.bookings SET due_holder_name = v_due_holder WHERE id = v_booking_id;
    END IF;

    -- Non-blocking referral credit, matching recordPayment()'s step 10 —
    -- a crediting failure must never abort the payment itself.
    IF v_leftover = 0 THEN
      BEGIN
        PERFORM public.credit_pending_referral_for_booking(v_booking_id);
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'booking_id', v_booking_id,
      'amount_paid', v_tender_total,
      'amount_due', v_leftover,
      'fully_paid', v_leftover = 0
    ));
  END LOOP;

  RETURN v_results;
END;
$function$;

-- ============================================================
-- 7. Grants: authenticated only
-- ============================================================
REVOKE ALL ON FUNCTION public.sell_product(uuid, integer, text, uuid, uuid, text, uuid, uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.checkout_booking_with_products(uuid, jsonb, jsonb, text, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_product(uuid, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_group_payment(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_group_payment(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sell_product(uuid, integer, text, uuid, uuid, text, uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.checkout_booking_with_products(uuid, jsonb, jsonb, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_product(uuid, jsonb, jsonb, jsonb) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('346', 'products-checkout-commission')
ON CONFLICT (version) DO NOTHING;

COMMIT;
