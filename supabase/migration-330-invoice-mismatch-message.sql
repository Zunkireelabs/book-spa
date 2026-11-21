-- Names the gap in issue_invoice()'s collected-vs-total mismatch error so
-- whoever hits it knows what to go fix, instead of just that something
-- doesn't match. No behaviour change — same hard fail, same two figures,
-- now with their difference and a pointer to what to correct. Full function
-- body re-emitted (CREATE OR REPLACE) since only this one RAISE EXCEPTION
-- line changed from migration-328.

BEGIN;

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

  -- An account that cannot see prices cannot print a document that is
  -- entirely prices. Checked here, not just hidden in the UI.
  SELECT can_view_prices INTO v_can_view_prices FROM public.users WHERE id = auth.uid();
  IF v_can_view_prices IS FALSE THEN
    RAISE EXCEPTION 'issue_invoice: this account cannot view prices';
  END IF;

  -- Idempotent: a repeat call for the same booking returns the invoice
  -- already issued, never a second invoice number for one sale.
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

  -- Fail closed on incomplete billing configuration. Never defaulted — a
  -- defaulted tax mode silently picks what the customer gets charged.
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

  SELECT * INTO v_fy FROM public.fiscal_years
  WHERE (now() AT TIME ZONE 'Asia/Kathmandu')::date BETWEEN start_date AND end_date
  LIMIT 1;
  IF v_fy.id IS NULL THEN
    RAISE EXCEPTION 'issue_invoice: no fiscal year configured for today''s date';
  END IF;

  -- Atomic, race-safe allocation — see migration-100's issue_voucher for the
  -- identical pattern. Bucketed by fiscal year regardless of the printed
  -- prefix, so a custom prefix doesn't change the underlying sequence.
  INSERT INTO public.invoice_counters (org_id, fiscal_year_id, next_number)
  VALUES (v_org_id, v_fy.id, 2)
  ON CONFLICT (org_id, fiscal_year_id)
    DO UPDATE SET next_number = public.invoice_counters.next_number + 1
  RETURNING next_number - 1 INTO v_seq;

  v_invoice_number := COALESCE(v_invoice_prefix, v_fy.label) || '-' || lpad(v_seq::text, 5, '0');

  -- Three tax treatments (migration-329). vat computed first in every mode,
  -- the other figure derived by subtraction/addition from ONE rounding, so
  -- the printed lines always sum to the printed total.
  IF v_tax_mode = 'inclusive' THEN
    -- Existing price already includes VAT — extracted, not added.
    v_vat := round(v_booking.final_amount * v_vat_rate / (100 + v_vat_rate), 2);
    v_taxable := v_booking.final_amount - v_vat;
    v_total := v_booking.final_amount;
  ELSIF v_tax_mode = 'addon' THEN
    -- VAT added on top of the existing price — the customer owes more than
    -- final_amount. See the collected-amount check below: this mode cannot
    -- issue for a booking that only collected the pre-VAT amount, which is
    -- every booking today (quoting doesn't add VAT at booking time — that is
    -- separate, larger work, not built here).
    v_taxable := v_booking.final_amount;
    v_vat := round(v_booking.final_amount * v_vat_rate / 100, 2);
    v_total := v_booking.final_amount + v_vat;
  ELSE -- 'none'
    v_vat := 0;
    v_taxable := v_booking.final_amount;
    v_total := v_booking.final_amount;
  END IF;

  -- The printed total must equal what was actually collected
  -- (cash-based reconciliation, CLAUDE.md) — fail loudly rather than print a
  -- document that disagrees with the cash drawer. Names the gap so whoever
  -- hits it (most likely on a split-paid booking) knows what to go fix.
  SELECT COALESCE(SUM(amount), 0) INTO v_collected FROM public.payments WHERE booking_id = p_booking_id;
  IF v_total IS DISTINCT FROM v_collected THEN
    RAISE EXCEPTION 'issue_invoice: computed total (%) does not match the amount actually collected (%) for this booking — difference of % — cannot issue an invoice until the payment records for this booking are corrected', v_total, v_collected, (v_total - v_collected);
  END IF;

  -- Line items from the booking's OWN recorded amounts — a combo booking's
  -- components already carry their real per-line charge
  -- (booking_combo_items.base_share_amount, migration-326); a non-combo
  -- booking is a single line at its own base_amount. Never re-derived from
  -- services.price_npr, which may have changed since.
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

  -- payment_mode is a plain list, not a UNIQUE-constrained single tender —
  -- payments.booking_id lost its UNIQUE constraint in migration-042 to
  -- support split payments, so a booking can have more than one payments row.
  SELECT string_agg(DISTINCT payment_mode::text, ', ' ORDER BY payment_mode::text) INTO v_payment_mode
  FROM public.payments WHERE booking_id = p_booking_id;

  INSERT INTO public.invoices (
    org_id, branch_id, booking_id, invoice_number, fiscal_year, issued_by,
    seller_name, seller_pan, seller_address, seller_phone, seller_email,
    branch_name, branch_address, branch_phone,
    buyer_name, buyer_phone, buyer_pan,
    line_items, tax_mode, vat_rate,
    subtotal, discount_amount, taxable_amount, vat_amount, total_amount, payment_mode
  ) VALUES (
    v_org_id, v_booking.branch_id, p_booking_id, v_invoice_number, v_fy.label, auth.uid(),
    v_legal_name, v_pan,
    NULLIF(btrim(v_settings->>'billing_address'), ''),
    NULLIF(btrim(v_settings->>'billing_phone'), ''),
    NULLIF(btrim(v_settings->>'billing_email'), ''),
    v_branch.name, v_branch.address, v_branch.phone,
    v_booking.customer_name, v_booking.customer_phone, NULL,
    v_line_items, v_tax_mode, v_vat_rate,
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

INSERT INTO public.schema_migrations (version, name) VALUES ('330', 'invoice-mismatch-message') ON CONFLICT (version) DO NOTHING;

COMMIT;
