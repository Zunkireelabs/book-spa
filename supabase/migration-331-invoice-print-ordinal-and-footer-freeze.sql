-- Two fixes on top of migration-328/329/330:
--
-- 1. ORIGINAL/COPY race: recordInvoicePrint's count-then-insert lets two
--    concurrent prints (e.g. a double-click) both read count=0 and both
--    print ORIGINAL. Same shape of problem as invoice numbering — fixed the
--    same way, with an atomic per-invoice counter table + a SECURITY
--    DEFINER function doing ON CONFLICT ... DO UPDATE ... RETURNING.
--
-- 2. footer_text was read live at print time. Settings panel labels it
--    "receipt footer text... and any terms" — terms are part of the issued
--    document, not safe to show differently on a reprint than what the
--    customer was handed. Frozen onto invoices now, same as every other
--    printed field.

BEGIN;

CREATE TABLE IF NOT EXISTS public.invoice_print_counters (
  invoice_id   uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  next_ordinal int NOT NULL DEFAULT 1 CHECK (next_ordinal > 0),
  PRIMARY KEY (invoice_id)
);

ALTER TABLE public.invoice_print_counters ENABLE ROW LEVEL SECURITY;
-- No policies — internal bookkeeping only touched by record_invoice_print(),
-- same posture as invoice_counters.

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS footer_text text;

-- Atomic ordinal allocation — ordinal 1 is ORIGINAL, every ordinal after is
-- COPY. Mirrors issue_invoice()'s own counter pattern.
CREATE OR REPLACE FUNCTION public.record_invoice_print(p_invoice_id uuid, p_print_type text)
RETURNS TABLE (ordinal int, copy_label text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id  uuid := get_user_org_id();
  v_invoice public.invoices;
  v_ordinal int;
BEGIN
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'record_invoice_print: no organization context';
  END IF;
  IF p_print_type NOT IN ('a4', 'thermal') THEN
    RAISE EXCEPTION 'record_invoice_print: invalid print type %', p_print_type;
  END IF;

  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id;
  IF v_invoice.id IS NULL OR v_invoice.org_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'record_invoice_print: invoice not found';
  END IF;

  INSERT INTO public.invoice_print_counters (invoice_id, next_ordinal)
  VALUES (p_invoice_id, 2)
  ON CONFLICT (invoice_id)
    DO UPDATE SET next_ordinal = public.invoice_print_counters.next_ordinal + 1
  RETURNING next_ordinal - 1 INTO v_ordinal;

  INSERT INTO public.invoice_prints (invoice_id, print_type, printed_by)
  VALUES (p_invoice_id, p_print_type, auth.uid());

  RETURN QUERY SELECT v_ordinal, (CASE WHEN v_ordinal = 1 THEN 'ORIGINAL' ELSE 'COPY' END);
END;
$function$;

REVOKE ALL ON FUNCTION public.record_invoice_print(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_invoice_print(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_invoice_print(uuid, text) TO authenticated;

-- issue_invoice(): freeze footer_text onto the snapshot alongside everything
-- else. Only change from migration-330's body is reading+storing this field.
CREATE OR REPLACE FUNCTION public.issue_invoice(p_booking_id uuid)
RETURNS public.invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id          uuid := get_user_org_id();
  v_can_view_prices boolean;
  v_existing        public.invoices;
  v_booking         public.bookings;
  v_branch          public.branches;
  v_org             public.organizations;
  v_settings        jsonb;
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
  v_row             public.invoices;
BEGIN
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'issue_invoice: no organization context';
  END IF;

  SELECT can_view_prices INTO v_can_view_prices FROM public.users WHERE id = auth.uid();
  IF v_can_view_prices IS FALSE THEN
    RAISE EXCEPTION 'issue_invoice: this account cannot view prices';
  END IF;

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

  IF v_tax_mode = 'inclusive' THEN
    v_vat := round(v_booking.final_amount * v_vat_rate / (100 + v_vat_rate), 2);
    v_taxable := v_booking.final_amount - v_vat;
    v_total := v_booking.final_amount;
  ELSIF v_tax_mode = 'addon' THEN
    v_taxable := v_booking.final_amount;
    v_vat := round(v_booking.final_amount * v_vat_rate / 100, 2);
    v_total := v_booking.final_amount + v_vat;
  ELSE -- 'none'
    v_vat := 0;
    v_taxable := v_booking.final_amount;
    v_total := v_booking.final_amount;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_collected FROM public.payments WHERE booking_id = p_booking_id;
  IF v_total IS DISTINCT FROM v_collected THEN
    RAISE EXCEPTION 'issue_invoice: computed total (%) does not match the amount actually collected (%) for this booking — difference of % — cannot issue an invoice until the payment records for this booking are corrected', v_total, v_collected, (v_total - v_collected);
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

  SELECT string_agg(DISTINCT payment_mode::text, ', ' ORDER BY payment_mode::text) INTO v_payment_mode
  FROM public.payments WHERE booking_id = p_booking_id;

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
    v_booking.base_amount, v_booking.discount_amount, v_taxable, v_vat, v_total,
    COALESCE(v_payment_mode, 'Unknown')
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_invoice(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_invoice(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.issue_invoice(uuid) TO authenticated;

INSERT INTO public.schema_migrations (version, name) VALUES ('331', 'invoice-print-ordinal-and-footer-freeze') ON CONFLICT (version) DO NOTHING;

COMMIT;
