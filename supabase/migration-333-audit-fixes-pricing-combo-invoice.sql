-- Fixes from an independent end-to-end audit of the billing/tiered-pricing
-- branch (23 commits, 15 migrations). Four DB-side findings, bundled into one
-- migration per the usual convention:
--
-- F-2 (MODERATE): public_get_bookable_services returned real price_npr/
--   effective_price_npr/original_price_npr/min_price/max_price for
--   calendar_only services to anon callers — the user asked for these to be
--   hidden completely; previously only the UI hid them. Nulled server-side.
--   no_default is left alone (it already has no real price to leak — the
--   "no default price set" case, not a hidden one).
--
-- F-3 (MODERATE): public_create_combo_booking_items had no replay guard.
--   booking_combo_items has no unique constraint, so calling it twice for the
--   same booking appended duplicate lines and pushed base_amount up each
--   time. Now refuses once the booking already has combo items, and once the
--   booking is already paid.
--
-- F-4 (MODERATE): issue_invoice() took subtotal from bookings.base_amount
--   but built line items from booking_combo_items.base_share_amount, with
--   nothing enforcing the two agree. A combo priced 7,000 whose components
--   sum to 6,800 would print lines totalling 6,800 under a 7,000 subtotal.
--   Added an explicit SUM(lines) = subtotal assertion that fails loudly and
--   names the gap, same style as the existing cash-collected check — a paid
--   booking with inconsistent combo data cannot be invoiced until the
--   underlying data is fixed. Deliberately NOT fixed by deriving subtotal
--   from the lines instead: that would silently disagree with the booking's
--   own recorded base_amount and with the cash-collected check.
--
-- F-6 (LOW): migration-331 moved invoice print logging into
--   record_invoice_print() (SECURITY DEFINER, atomic ordinal), but left the
--   old client-side INSERT policy on invoice_prints in place — a row could
--   still be inserted directly, bypassing the atomic counter. Dropped; the
--   function doesn't need it (SECURITY DEFINER bypasses RLS as its owner).

BEGIN;

-- F-2: hide calendar_only prices from anon/public service list
CREATE OR REPLACE FUNCTION public.public_get_bookable_services(p_org_slug text)
RETURNS TABLE(id uuid, name text, duration_minutes integer, price_npr numeric, description text, image_url text, category_name text, category_id uuid, category_display_order integer, effective_price_npr numeric, is_on_offer boolean, original_price_npr numeric, active_campaign_name text, is_combo boolean, price_type text, min_price numeric, max_price numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    s.id,
    s.name,
    s.duration_minutes,
    CASE WHEN s.price_type = 'calendar_only' THEN NULL ELSE s.price_npr END AS price_npr,
    s.description,
    s.image_url,
    s.category AS category_name,
    sc.id      AS category_id,
    COALESCE(sc.display_order, 2147483647) AS category_display_order,
    CASE
      WHEN s.price_type = 'calendar_only' THEN NULL
      WHEN camp.discount_percent IS NOT NULL THEN ROUND(s.price_npr * (1 - camp.discount_percent / 100.0), 2)
      ELSE p.effective_price_npr
    END AS effective_price_npr,
    (camp.discount_percent IS NOT NULL OR p.is_on_offer) AS is_on_offer,
    CASE
      WHEN s.price_type = 'calendar_only' THEN NULL
      WHEN camp.discount_percent IS NOT NULL THEN s.price_npr
      ELSE p.original_price_npr
    END AS original_price_npr,
    camp.campaign_name AS active_campaign_name,
    s.is_combo,
    s.price_type,
    CASE WHEN s.price_type = 'calendar_only' THEN NULL ELSE range.min_price END AS min_price,
    CASE WHEN s.price_type = 'calendar_only' THEN NULL ELSE range.max_price END AS max_price
  FROM public.services s
  JOIN public.organizations o ON o.id = s.org_id
  LEFT JOIN public.service_categories sc
    ON sc.org_id = s.org_id
   AND sc.name = s.category
  CROSS JOIN LATERAL public.compute_service_offer_pricing(
    s.price_npr, s.offer_enabled, s.offer_type, s.offer_value,
    COALESCE(sc.offer_enabled, false), sc.offer_percent
  ) p
  LEFT JOIN LATERAL public.get_active_campaign_discount_percent(s.id, sc.id, s.org_id) camp ON true
  CROSS JOIN LATERAL public.service_price_range(s.id) range
  WHERE o.slug = p_org_slug
    AND o.is_active = true
    AND s.is_active = true
  ORDER BY category_display_order, s.category, s.name;
$function$;

-- F-3: replay guard on anonymous combo-item write
CREATE OR REPLACE FUNCTION public.public_create_combo_booking_items(p_booking_id uuid, p_items jsonb)
RETURNS SETOF booking_combo_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.bookings WHERE id = p_booking_id) THEN
    RAISE EXCEPTION 'public_create_combo_booking_items: booking % not found', p_booking_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.bookings WHERE id = p_booking_id AND created_by IS NOT NULL) THEN
    RAISE EXCEPTION 'public_create_combo_booking_items: booking % was not created anonymously', p_booking_id;
  END IF;

  -- No replay guard existed: calling this twice for the same booking appended
  -- duplicate lines (booking_combo_items has no unique constraint) and
  -- recomputed base_amount upward each time. Refuse once lines already exist
  -- for this booking, and refuse once it's paid — a paid booking's amount is
  -- settled and must not move under it.
  IF EXISTS (SELECT 1 FROM public.booking_combo_items WHERE booking_id = p_booking_id) THEN
    RAISE EXCEPTION 'public_create_combo_booking_items: booking % already has combo items', p_booking_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.bookings WHERE id = p_booking_id AND payment_status = 'paid') THEN
    RAISE EXCEPTION 'public_create_combo_booking_items: booking % is already paid', p_booking_id;
  END IF;

  INSERT INTO public.booking_combo_items (
    booking_id, component_id, service_id, therapist_id, room_id,
    display_order, date, start_time, commission_weight, base_share_amount
  )
  SELECT
    p_booking_id,
    NULLIF(item->>'component_id', '')::uuid,
    (item->>'service_id')::uuid,
    NULLIF(item->>'therapist_id', '')::uuid,
    NULLIF(item->>'room_id', '')::uuid,
    (item->>'display_order')::int,
    (item->>'date')::date,
    (item->>'start_time')::time,
    1,
    public.service_price_for_therapist(
      (item->>'service_id')::uuid,
      NULLIF(item->>'therapist_id', '')::uuid
    )
  FROM jsonb_array_elements(p_items) AS item;

  UPDATE public.bookings
  SET base_amount = (
    SELECT COALESCE(SUM(base_share_amount), 0)
    FROM public.booking_combo_items
    WHERE booking_id = p_booking_id
  )
  WHERE id = p_booking_id;

  RETURN QUERY
  SELECT * FROM public.booking_combo_items WHERE booking_id = p_booking_id ORDER BY display_order;
END;
$function$;

-- F-4: subtotal/line-items agreement check in issue_invoice()
CREATE OR REPLACE FUNCTION public.issue_invoice(p_booking_id uuid)
 RETURNS invoices
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
BEGIN
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'issue_invoice: no organization context';
  END IF;

  SELECT can_view_prices INTO v_can_view_prices FROM public.users WHERE id = auth.uid();
  IF v_can_view_prices IS FALSE THEN
    RAISE EXCEPTION 'issue_invoice: this account cannot view prices';
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

  -- The lines and the subtotal come from different sources (booking_combo_items
  -- vs bookings.base_amount) with nothing else enforcing they agree — a combo
  -- priced 7,000 whose components sum to 6,800 would otherwise print lines
  -- totalling 6,800 under a 7,000 subtotal. Fail loudly naming the gap, same
  -- style as the cash-collected check above, rather than silently deriving
  -- one figure from the other (which would disagree with the booking's own
  -- recorded amount, or with the cash check).
  SELECT COALESCE(SUM((elem->>'amount')::numeric), 0) INTO v_lines_sum
  FROM jsonb_array_elements(v_line_items) elem;
  IF v_lines_sum IS DISTINCT FROM v_booking.base_amount THEN
    RAISE EXCEPTION 'issue_invoice: invoice line items total (%) does not match this booking''s recorded subtotal (%) — difference of % — fix booking_combo_items.base_share_amount for this booking before it can be invoiced', v_lines_sum, v_booking.base_amount, (v_booking.base_amount - v_lines_sum);
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

-- F-6: drop stale client-side INSERT policy on invoice_prints

DROP POLICY IF EXISTS "Staff with price access can log an invoice print" ON public.invoice_prints;

INSERT INTO public.schema_migrations (version, name) VALUES ('333', 'audit-fixes-pricing-combo-invoice') ON CONFLICT (version) DO NOTHING;

COMMIT;
