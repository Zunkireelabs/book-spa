-- Fixes from an independent audit of the staff-access/tiered-pricing/billing
-- branch. Two findings, both latent today (nothing is exposed with the
-- current data), bundled into one migration per the usual convention.
--
-- F-1: `invoices` bypassed both staff-access restrictions added earlier on
--   this branch.
--   a) No RESTRICTIVE own-bookings policy — migration-322 added one to
--      `bookings` so a calendar_visibility='own' account can't read other
--      people's rows, but `invoices` never got the equivalent. An
--      own-bookings-only account could read every invoice in the org.
--   b) can_view_customer_details was never checked, on either the read
--      policy or issue_invoice() itself — an account with customer details
--      hidden could still issue/read an invoice carrying the real buyer_name
--      and buyer_phone. Masking the read is the wrong fix here (an invoice
--      is a document handed to the customer; printing "A***** T******" on a
--      tax invoice is worse than refusing) — this makes it an access
--      decision instead: producing or reading a customer's invoice now
--      requires can_view_customer_details, same shape as the existing
--      can_view_prices gate.
--   c) No branch scoping for plain staff — manager/admin/admin_viewer keep
--      org-wide reads (reports depend on it), but a plain staff account is
--      now scoped to invoices for its own branch(es), matching how
--      `bookings` already scopes staff via get_user_branch_ids().
--
-- F-2: `services_with_offer_pricing` is granted to `anon`, has no
--   security_invoker (so it runs as the view owner and bypasses RLS
--   entirely), and doesn't null calendar_only prices the way
--   public_get_bookable_services was fixed to in migration-333. Measured
--   against staging: 273 services, all active, none currently calendar_only
--   — so nothing leaks today, but the exposure appears the moment someone
--   marks a service calendar_only, via a direct REST call to the view
--   (bypassing the app code entirely, which never queries it as anon).
--   Fixed by nulling the same three price columns migration-333 nulled on
--   the RPC, and setting security_invoker so the view is subject to the
--   same RLS as the base table for whichever role queries it. Checked all
--   four `services_with_offer_pricing` call sites in api.js first — all are
--   authenticated, and already add their own .eq('org_id', ...) and/or
--   .eq('is_active', true) filters independent of RLS, so none depend on
--   definer-rights bypassing those checks.

BEGIN;

-- ── F-1b: issue_invoice() gains the can_view_customer_details gate ──────────
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

-- ── F-1b/c: rewrite the read policy — can_view_customer_details gate added,
-- branch scoping added for plain staff. manager/admin/admin_viewer keep
-- org-wide reads AND bypass the can_view_customer_details column outright —
-- mirroring resolveVisibility() (api.js): `privileged || can_view_customer_details
-- !== false`. That bypass is load-bearing, not cosmetic: the column has no
-- write-side guarantee that it stays true for a privileged role (migration-321's
-- UPDATE policy on `users` places no constraint on it, and updateStaffAccess()
-- only normalises it when the caller's payload explicitly touches the
-- visibility fields — promoting a restricted staff account to manager without
-- touching them leaves can_view_customer_details=false on a manager row).
-- Without this bypass that account would get an invoice-print button (the UI
-- gate already uses the privileged bypass) that always refused to read.
DROP POLICY IF EXISTS "Staff with price access can read org invoices" ON public.invoices;
CREATE POLICY "Staff with price access can read org invoices"
  ON public.invoices FOR SELECT TO authenticated
  USING (
    org_id = (SELECT public.get_user_org_id())
    AND (
      (SELECT role FROM public.users WHERE id = (SELECT auth.uid())) IN ('manager', 'admin', 'admin_viewer')
      OR (SELECT can_view_customer_details FROM public.users WHERE id = (SELECT auth.uid())) IS NOT FALSE
    )
    AND (
      (SELECT role FROM public.users WHERE id = (SELECT auth.uid())) IN ('manager', 'admin', 'admin_viewer')
      OR (
        (SELECT can_view_prices FROM public.users WHERE id = (SELECT auth.uid())) IS NOT FALSE
        AND branch_id = ANY ((SELECT public.get_user_branch_ids())::uuid[])
      )
    )
  );

-- ── F-1a: RESTRICTIVE own-bookings policy, mirroring migration-322 ──────────
-- Resolves through invoices.booking_id to the SAME booking a restricted
-- account would already be allowed to see on the calendar — checking both
-- bookings.therapist_id and the booking_therapists junction, for the same
-- reason 322 checks both (older rows predate the junction).
DROP POLICY IF EXISTS "Own bookings only when restricted" ON public.invoices;
CREATE POLICY "Own bookings only when restricted"
  ON public.invoices
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (
    NOT (SELECT public.is_own_bookings_only())
    OR (
      (SELECT public.current_therapist_id()) IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.bookings b
        WHERE b.id = invoices.booking_id
          AND (
            b.therapist_id = (SELECT public.current_therapist_id())
            OR EXISTS (
              SELECT 1 FROM public.booking_therapists bt
              WHERE bt.booking_id = b.id
                AND bt.therapist_id = (SELECT public.current_therapist_id())
            )
          )
      )
    )
  );

-- ── F-2: null calendar_only prices + lock the view to invoker rights ────────
CREATE OR REPLACE VIEW public.services_with_offer_pricing AS
  SELECT s.id,
     s.name,
     s.duration_minutes,
     CASE WHEN s.price_type = 'calendar_only' THEN NULL::numeric(10,2) ELSE s.price_npr END AS price_npr,
     s.description,
     s.is_active,
     s.created_at,
     s.org_id,
     s.category,
     s.image_url,
     s.is_couple,
     s.offer_enabled,
     s.offer_type,
     s.offer_value,
     sc.offer_enabled AS category_offer_enabled,
     sc.offer_percent AS category_offer_percent,
         CASE
             WHEN s.price_type = 'calendar_only' THEN NULL::numeric
             WHEN camp.discount_percent IS NOT NULL THEN round(s.price_npr * (1::numeric - camp.discount_percent / 100.0), 2)
             ELSE p.effective_price_npr
         END AS effective_price_npr,
     camp.discount_percent IS NOT NULL OR p.is_on_offer AS is_on_offer,
         CASE
             WHEN s.price_type = 'calendar_only' THEN NULL::numeric
             WHEN camp.discount_percent IS NOT NULL THEN s.price_npr
             ELSE p.original_price_npr
         END AS original_price_npr,
     camp.campaign_name AS active_campaign_name,
     s.is_combo,
     s.bookable_online,
     s.is_addon,
     s.padding_before_minutes,
     s.padding_after_minutes,
     s.padding_after_type,
     s.requires_therapist,
     s.price_type
    FROM services s
      LEFT JOIN service_categories sc ON sc.org_id = s.org_id AND sc.name = s.category
      CROSS JOIN LATERAL compute_service_offer_pricing(s.price_npr, s.offer_enabled, s.offer_type, s.offer_value, COALESCE(sc.offer_enabled, false), sc.offer_percent) p(effective_price_npr, is_on_offer, original_price_npr)
      LEFT JOIN LATERAL get_active_campaign_discount_percent(s.id, sc.id, s.org_id) camp(discount_percent, campaign_name) ON true;

-- Without this, the view runs as its owner (postgres, which bypasses RLS)
-- regardless of who queries it — the calendar_only CASE above would be the
-- only gate left, with the base table's RLS never applying at all. With it,
-- an anon caller gets the base table's "Anonymous can read active services"
-- policy (is_active = true, no org filter — same as querying `services`
-- directly today) and an authenticated caller gets "Users can read own org
-- services" (org_id = get_user_org_id(), no active filter — so admin panels
-- still see inactive services, matching fetchServicesForManagement's needs).
ALTER VIEW public.services_with_offer_pricing SET (security_invoker = true);

INSERT INTO public.schema_migrations (version, name)
VALUES ('334', 'invoice-rls-and-service-view-fix')
ON CONFLICT (version) DO NOTHING;

COMMIT;
