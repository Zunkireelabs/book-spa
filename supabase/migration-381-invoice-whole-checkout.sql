-- Migration 381 (ZNLY-207, board B3): the invoice is the whole checkout.
-- issue_invoice() v6 (from 334): the services of the booking (combo parts as before) PLUS every product sold at that checkout
-- (product_sales.booking_id, not refunded) are lines; subtotal = services before discount + products; the booking discount is the
-- "Discount" row before tax; VAT is worked on (services after discount + products) in each tax mode. A tip is never a line.
-- "Paid via" lists every method that paid any part (Voucher / Membership / Package / wallets included). The collected-amount check
-- now covers booking payments + product payments. The products/tips rule lives in ONE constant (c_products_on_invoice) so ZNLY-214 is a
-- one-line change. An issued invoice never changes: UPDATE / DELETE / TRUNCATE are refused by trigger (there was only "no policy").
-- Rollback (manual): re-run the issue_invoice definition from migration-334 and drop the triggers below.
-- Applied: stage - / prod HELD.

BEGIN;

CREATE OR REPLACE FUNCTION public.issue_invoice(p_booking_id uuid)
 RETURNS invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id          uuid := get_user_org_id();
  v_can_view_prices boolean;
  v_can_view_customer_details boolean;
  v_role            public.user_role;
  v_existing        public.invoices;
  v_booking         public.bookings;
  v_branch          public.branches;
  v_org             public.organizations;
  v_settings        jsonb;
  v_billing_enabled boolean;
  v_legal_name      text;
  v_pan             text;
  v_tax_mode        text;
  v_vat_rate        numeric(5,2);
  v_invoice_prefix  text;
  v_footer_text     text;
  v_fy              public.fiscal_years;
  v_seq             int;
  v_invoice_number  text;
  v_vat             numeric(10,2);
  v_taxable         numeric(10,2);
  v_total           numeric(10,2);
  v_collected       numeric(10,2);
  v_line_items      jsonb;
  v_payment_mode    text;
  v_lines_sum       numeric(10,2);
  v_row             public.invoices;
  -- ZNLY-207: THE rule for what rides on the invoice. Products sold at this checkout are lines (true); a tip is never a line
  -- (it is not company revenue). ZNLY-214 may change either after the accountant answers: flip the constants, nothing else.
  c_products_on_invoice constant boolean := true;
  v_products        numeric(10,2) := 0;     -- products sold at this checkout (not refunded)
  v_products_paid   numeric(10,2) := 0;     -- what the customer paid for them (any method, wallets included)
  v_grand           numeric(10,2);          -- services after discount + products: the amount VAT is worked on
  v_subtotal        numeric(10,2);          -- services before discount + products
BEGIN
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'issue_invoice: no organization context';
  END IF;

  SELECT can_view_prices INTO v_can_view_prices FROM public.users WHERE id = auth.uid();
  IF v_can_view_prices IS FALSE THEN
    RAISE EXCEPTION 'issue_invoice: this account cannot view prices';
  END IF;

  -- An invoice carries the buyer's real name and phone number. An account
  -- with customer details hidden cannot be allowed to mint or re-fetch one —
  -- except manager/admin/admin_viewer, which bypass this column entirely
  -- (same privileged bypass as resolveVisibility() in api.js and the read
  -- policy below; this column has no write-side guarantee it stays true on
  -- a privileged role after a promotion that didn't touch it).
  SELECT role, can_view_customer_details INTO v_role, v_can_view_customer_details
  FROM public.users WHERE id = auth.uid();
  IF v_can_view_customer_details IS FALSE AND v_role NOT IN ('manager', 'admin', 'admin_viewer') THEN
    RAISE EXCEPTION 'issue_invoice: this account cannot view customer details';
  END IF;

  -- Idempotent: a repeat call for the same booking returns the invoice
  -- already issued, never a second invoice number for one sale. This also
  -- means a disabled tenant can still "re-issue" (i.e. fetch) a PAST
  -- invoice for reprinting — the billing_enabled gate below only ever
  -- blocks the path that would mint a NEW invoice number.
  SELECT * INTO v_existing FROM public.invoices WHERE booking_id = p_booking_id;
  IF v_existing.id IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF v_booking.id IS NULL THEN
    RAISE EXCEPTION 'issue_invoice: booking % not found', p_booking_id;
  END IF;

  SELECT * INTO v_branch FROM public.branches WHERE id = v_booking.branch_id;
  IF v_branch.org_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'issue_invoice: booking is not in your organization';
  END IF;

  IF v_booking.payment_status IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'issue_invoice: booking is not fully paid';
  END IF;

  SELECT * INTO v_org FROM public.organizations WHERE id = v_org_id;
  v_settings := COALESCE(v_org.settings, '{}'::jsonb);
  v_billing_enabled := COALESCE((v_settings->>'billing_enabled')::boolean, false);

  IF NOT v_billing_enabled THEN
    RAISE EXCEPTION 'issue_invoice: billing is turned off for this organization — enable it in Setup → Billing before issuing invoices';
  END IF;

  v_legal_name := NULLIF(btrim(v_settings->>'billing_legal_name'), '');
  v_pan := NULLIF(btrim(v_settings->>'billing_pan'), '');
  v_tax_mode := NULLIF(btrim(v_settings->>'billing_tax_mode'), '');

  IF v_legal_name IS NULL THEN
    RAISE EXCEPTION 'issue_invoice: company legal name is not set — add it in Setup → Billing before issuing invoices';
  END IF;
  IF v_pan IS NULL THEN
    RAISE EXCEPTION 'issue_invoice: PAN/VAT number is not set — add it in Setup → Billing before issuing invoices';
  END IF;
  IF v_tax_mode IS NULL THEN
    RAISE EXCEPTION 'issue_invoice: tax mode is not set — choose one in Setup → Billing before issuing invoices';
  END IF;
  IF v_tax_mode NOT IN ('inclusive', 'addon', 'none') THEN
    RAISE EXCEPTION 'issue_invoice: unknown tax mode %', v_tax_mode;
  END IF;

  v_vat_rate := COALESCE((v_settings->>'billing_vat_rate')::numeric, 13);
  v_invoice_prefix := COALESCE(NULLIF(btrim(v_settings->>'billing_invoice_prefix'), ''), NULL);
  v_footer_text := NULLIF(btrim(v_settings->>'billing_footer_text'), '');

  SELECT * INTO v_fy FROM public.fiscal_years
  WHERE (now() AT TIME ZONE 'Asia/Kathmandu')::date BETWEEN start_date AND end_date
  LIMIT 1;
  IF v_fy.id IS NULL THEN
    RAISE EXCEPTION 'issue_invoice: no fiscal year configured for today''s date';
  END IF;

  INSERT INTO public.invoice_counters (org_id, fiscal_year_id, next_number)
  VALUES (v_org_id, v_fy.id, 2)
  ON CONFLICT (org_id, fiscal_year_id)
    DO UPDATE SET next_number = public.invoice_counters.next_number + 1
  RETURNING next_number - 1 INTO v_seq;

  v_invoice_number := COALESCE(v_invoice_prefix, v_fy.label) || '-' || lpad(v_seq::text, 5, '0');

  IF c_products_on_invoice THEN
    SELECT COALESCE(SUM(ps.total_amount), 0) INTO v_products
      FROM public.product_sales ps WHERE ps.booking_id = p_booking_id AND ps.refunded_at IS NULL;
    SELECT COALESCE(SUM(pp.amount), 0) INTO v_products_paid
      FROM public.product_sale_payments pp JOIN public.product_sales ps ON ps.id = pp.sale_id
     WHERE ps.booking_id = p_booking_id AND ps.refunded_at IS NULL;
  END IF;
  v_grand := v_booking.final_amount + v_products;
  v_subtotal := v_booking.base_amount + v_products;

  IF v_tax_mode = 'inclusive' THEN
    v_vat := round(v_grand * v_vat_rate / (100 + v_vat_rate), 2);
    v_taxable := v_grand - v_vat;
    v_total := v_grand;
  ELSIF v_tax_mode = 'addon' THEN
    v_taxable := v_grand;
    v_vat := round(v_grand * v_vat_rate / 100, 2);
    v_total := v_grand + v_vat;
  ELSE -- 'none'
    v_vat := 0;
    v_taxable := v_grand;
    v_total := v_grand;
  END IF;

  SELECT COALESCE(SUM(amount), 0) + v_products_paid INTO v_collected FROM public.payments WHERE booking_id = p_booking_id;
  IF v_total IS DISTINCT FROM v_collected THEN
    RAISE EXCEPTION 'issue_invoice: computed total (%) does not match the amount actually collected for the booking and its products (%) for this booking — difference of % — cannot issue an invoice until the payment records for this booking are corrected', v_total, v_collected, (v_total - v_collected);
  END IF;

  SELECT jsonb_agg(jsonb_build_object('description', s.name, 'amount', bci.base_share_amount) ORDER BY bci.display_order)
    INTO v_line_items
  FROM public.booking_combo_items bci
  JOIN public.services s ON s.id = bci.service_id
  WHERE bci.booking_id = p_booking_id;

  IF v_line_items IS NULL THEN
    v_line_items := jsonb_build_array(
      jsonb_build_object('description', COALESCE(v_booking.service_name_snapshot, 'Service'), 'amount', v_booking.base_amount)
    );
  END IF;

  SELECT COALESCE(SUM((elem->>'amount')::numeric), 0) INTO v_lines_sum
  FROM jsonb_array_elements(v_line_items) elem;
  IF v_lines_sum IS DISTINCT FROM v_booking.base_amount THEN
    RAISE EXCEPTION 'issue_invoice: invoice line items total (%) does not match this booking''s recorded subtotal (%) — difference of % — fix booking_combo_items.base_share_amount for this booking before it can be invoiced', v_lines_sum, v_booking.base_amount, (v_booking.base_amount - v_lines_sum);
  END IF;

  -- product lines, in the order they were sold
  IF c_products_on_invoice THEN
    SELECT v_line_items || COALESCE(jsonb_agg(jsonb_build_object('description', ps.product_name || CASE WHEN ps.quantity > 1 THEN ' × ' || ps.quantity ELSE '' END,
                                                                 'amount', ps.total_amount, 'kind', 'product') ORDER BY ps.created_at, ps.id), '[]'::jsonb)
      INTO v_line_items
      FROM public.product_sales ps WHERE ps.booking_id = p_booking_id AND ps.refunded_at IS NULL;
  END IF;

  -- "Paid via": every method that paid any part of the checkout, in plain words (voucher, wallet, package, membership included)
  SELECT string_agg(DISTINCT label, ', ' ORDER BY label) INTO v_payment_mode FROM (
    SELECT CASE m WHEN 'VoucherWallet' THEN 'Voucher' WHEN 'ReferralWallet' THEN 'Referral wallet' WHEN 'ReferralVoucher' THEN 'Referral voucher'
                  WHEN 'SessionPackage' THEN 'Package' ELSE m END AS label
      FROM (SELECT payment_mode::text AS m FROM public.payments WHERE booking_id = p_booking_id AND amount > 0
            UNION ALL
            SELECT pp.payment_mode FROM public.product_sale_payments pp JOIN public.product_sales ps ON ps.id = pp.sale_id
             WHERE c_products_on_invoice AND ps.booking_id = p_booking_id AND ps.refunded_at IS NULL) x
  ) y;

  INSERT INTO public.invoices (
    org_id, branch_id, booking_id, invoice_number, fiscal_year, issued_by,
    seller_name, seller_pan, seller_address, seller_phone, seller_email,
    branch_name, branch_address, branch_phone,
    buyer_name, buyer_phone, buyer_pan,
    line_items, tax_mode, vat_rate, footer_text,
    subtotal, discount_amount, taxable_amount, vat_amount, total_amount, payment_mode
  ) VALUES (
    v_org_id, v_booking.branch_id, p_booking_id, v_invoice_number, v_fy.label, auth.uid(),
    v_legal_name, v_pan,
    NULLIF(btrim(v_settings->>'billing_address'), ''),
    NULLIF(btrim(v_settings->>'billing_phone'), ''),
    NULLIF(btrim(v_settings->>'billing_email'), ''),
    v_branch.name, v_branch.address, v_branch.phone,
    v_booking.customer_name, v_booking.customer_phone, NULL,
    v_line_items, v_tax_mode, v_vat_rate, v_footer_text,
    v_subtotal, v_booking.discount_amount, v_taxable, v_vat, v_total,
    COALESCE(v_payment_mode, 'Unknown')
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_invoice(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_invoice(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.issue_invoice(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.invoices_never_change() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'an issued invoice never changes (invoices is append-only)' USING ERRCODE = 'P0001';
END $$;
DROP TRIGGER IF EXISTS trg_invoices_never_change ON public.invoices;
CREATE TRIGGER trg_invoices_never_change BEFORE UPDATE OR DELETE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.invoices_never_change();
DROP TRIGGER IF EXISTS trg_invoices_no_truncate ON public.invoices;
CREATE TRIGGER trg_invoices_no_truncate BEFORE TRUNCATE ON public.invoices FOR EACH STATEMENT EXECUTE FUNCTION public.invoices_never_change();

INSERT INTO public.schema_migrations (version, name)
VALUES ('381', 'invoice-whole-checkout')
ON CONFLICT (version) DO NOTHING;

COMMIT;
