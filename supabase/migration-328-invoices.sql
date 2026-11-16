-- migration-328-invoices.sql
--
-- Full VAT tax invoice (not a plain receipt), printable as A4 or 80mm thermal.
-- The user: "when customer ask for invoice I can simple print it in pdf or in
-- thermal reciept," then, on the tax question: "let admin set the VAT number,
-- VAT included or excluded or extra, company's information and other things
-- that are needed." So unlike the first draft of this migration, the tax
-- treatment is an admin setting (migration-329), not a hardcoded formula —
-- this file only adds the invoice tables and the issuance function that reads
-- that setting. See migration-329 for the three tax modes and why "excluded"
-- became three unambiguous, behaviour-named options instead.
--
-- ── Snapshot, not a live re-render ───────────────────────────────────────────
-- A tax invoice frozen at issue time. Reprinting after a later discount edit
-- must produce the identical document under the same number — so every
-- printed field (seller identity, buyer identity, line items, amounts, which
-- tax mode and rate applied) is copied onto the row, never re-derived from
-- `bookings`/`services`/org settings at print time. Line items come from the
-- booking's OWN recorded amounts (booking_combo_items.base_share_amount, or
-- the booking's own base_amount for a non-combo), not re-derived from
-- services.price_npr — tiered pricing and combos mean the service's current
-- price is not necessarily what this customer was charged.
--
-- ── Insert-only ───────────────────────────────────────────────────────────────
-- Same posture as waitlist_entries' no-DELETE and payments' RESTRICT: a tax
-- invoice that can be edited after issue is not a tax invoice. No UPDATE, no
-- DELETE policy on `invoices`. A correction is a credit note — out of scope
-- for v1, deliberately not precluded by this schema.
--
-- ── Numbering: gapless, race-safe ────────────────────────────────────────────
-- Allocated inside issue_invoice() via an atomic UPDATE...RETURNING against a
-- per-(org, fiscal_year) counter row — same shape as issue_voucher()
-- (migration-100) and voucher_code_counters. A client-side `max(number)+1`
-- would duplicate numbers under concurrent issue.
--
-- ── Fiscal year: stored data, not a BS/AD converter ──────────────────────────
-- Nepal's fiscal year runs Shrawan-to-Ashad (~mid-July to ~mid-July), and
-- there is no Bikram Sambat calendar library in this repo (date-fns is
-- Gregorian only). `fiscal_years` is a small lookup table of label +
-- Gregorian start/end date, so the boundary is auditable/correctable data,
-- not arithmetic nobody can verify. Seeded with APPROXIMATE boundaries below
-- (mid-July each year) — flagged here and in the handoff report as needing a
-- real accountant's confirmation of the exact Shrawan 1 date before go-live;
-- BS month lengths vary year to year, so "mid-July" is not authoritative to
-- the day.
--
-- ── Reprints ──────────────────────────────────────────────────────────────────
-- `invoice_prints` is a second insert-only log, not a mutable print_count on
-- `invoices` (which would break the insert-only property). First print for an
-- invoice_id is ORIGINAL; a row already existing means COPY. Determined by
-- the caller querying this table before printing, not stored as a label.

BEGIN;

-- ── 1. Fiscal years — stored data, see the note above ────────────────────────
CREATE TABLE IF NOT EXISTS public.fiscal_years (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label      text NOT NULL UNIQUE,  -- e.g. '2082/83'
  start_date date NOT NULL,
  end_date   date NOT NULL,
  CONSTRAINT fiscal_years_range_chk CHECK (end_date > start_date)
);

COMMENT ON TABLE public.fiscal_years IS
  'Nepali fiscal year boundaries as verifiable Gregorian dates, not computed '
  'from a BS/AD converter. Dates seeded here are APPROXIMATE (mid-July) and '
  'need confirmation against the official calendar before go-live. Global '
  'reference data — not org-scoped, not user-editable through the app.';

ALTER TABLE public.fiscal_years ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read fiscal years" ON public.fiscal_years;
CREATE POLICY "Authenticated can read fiscal years"
  ON public.fiscal_years FOR SELECT TO authenticated USING (true);

-- No INSERT/UPDATE/DELETE policy — shared national calendar data, corrected
-- by a future migration if a seeded boundary turns out wrong, not editable
-- per-tenant.

-- Approximate boundaries bracketing today (2026-11-15, which falls in
-- 2083/84) plus one year either side. CONFIRM THE EXACT SHRAWAN 1 DATE before
-- relying on these for real invoices — see the file header.
INSERT INTO public.fiscal_years (label, start_date, end_date) VALUES
  ('2081/82', '2024-07-16', '2025-07-15'),
  ('2082/83', '2025-07-16', '2026-07-15'),
  ('2083/84', '2026-07-16', '2027-07-15'),
  ('2084/85', '2027-07-16', '2028-07-15')
ON CONFLICT (label) DO NOTHING;

-- ── 2. Invoice numbering counter (internal bookkeeping) ──────────────────────
CREATE TABLE IF NOT EXISTS public.invoice_counters (
  org_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  fiscal_year_id uuid NOT NULL REFERENCES public.fiscal_years(id) ON DELETE RESTRICT,
  next_number    int  NOT NULL DEFAULT 1 CHECK (next_number > 0),
  PRIMARY KEY (org_id, fiscal_year_id)
);

ALTER TABLE public.invoice_counters ENABLE ROW LEVEL SECURITY;
-- No policies at all — only issue_invoice() (SECURITY DEFINER) touches this,
-- same posture as voucher_code_counters (migration-072).

-- ── 3. Invoices — the frozen snapshot, insert-only ───────────────────────────
CREATE TABLE IF NOT EXISTS public.invoices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id      uuid NOT NULL REFERENCES public.branches(id),
  booking_id     uuid NOT NULL UNIQUE REFERENCES public.bookings(id) ON DELETE RESTRICT,
  invoice_number text NOT NULL,
  fiscal_year    text NOT NULL,
  issued_at      timestamptz NOT NULL DEFAULT now(),
  issued_by      uuid REFERENCES public.users(id),

  -- Frozen seller identity — company-level (from org billing settings,
  -- migration-329) AND the issuing branch's own address/phone, not one
  -- replacing the other.
  seller_name    text NOT NULL,
  seller_pan     text NOT NULL,
  seller_address text,
  seller_phone   text,
  seller_email   text,
  branch_name    text,
  branch_address text,
  branch_phone   text,

  -- Frozen buyer identity. buyer_pan stays NULL in v1 — no capture UI yet,
  -- kept nullable so a B2B invoice can be amended-by-credit-note later
  -- without a schema change.
  buyer_name     text NOT NULL,
  buyer_phone    text,
  buyer_pan      text,

  -- [{ description, amount }, ...] — one row per combo component, or one row
  -- for a non-combo booking. Quantity is always 1 in this domain.
  line_items     jsonb NOT NULL,

  -- Which tax treatment produced the figures below, frozen per-invoice so a
  -- past invoice can always be explained even after the org setting changes
  -- later (migration-329: 'inclusive' | 'addon' | 'none').
  tax_mode       text NOT NULL,
  vat_rate       numeric(5,2) NOT NULL,

  subtotal        numeric(10,2) NOT NULL,
  discount_amount numeric(10,2) NOT NULL DEFAULT 0,
  taxable_amount  numeric(10,2) NOT NULL,
  vat_amount      numeric(10,2) NOT NULL,
  total_amount    numeric(10,2) NOT NULL,
  payment_mode    text,

  CONSTRAINT invoices_org_number_uniq UNIQUE (org_id, invoice_number),
  CONSTRAINT invoices_total_chk CHECK (total_amount = taxable_amount + vat_amount)
);

CREATE INDEX IF NOT EXISTS invoices_org_fy_idx ON public.invoices(org_id, fiscal_year);

COMMENT ON TABLE public.invoices IS
  'Frozen tax invoice snapshots. Insert-only: no UPDATE/DELETE policy. One '
  'invoice per booking (booking_id UNIQUE) — issue_invoice() returns the '
  'existing row on a repeat call rather than minting a second invoice number '
  'for the same sale. tax_mode/vat_rate are frozen per row so a past invoice '
  'stays explicable after the org setting changes. See migration-328/329.';

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

-- Read: org-scoped, and only an account allowed to see prices at all —
-- an invoice IS prices. Mirrors can_view_prices the same way bookings'
-- own redaction does in application code; enforced here too since this
-- table has no other gate once SELECT is granted.
DROP POLICY IF EXISTS "Staff with price access can read org invoices" ON public.invoices;
CREATE POLICY "Staff with price access can read org invoices"
  ON public.invoices FOR SELECT TO authenticated
  USING (
    org_id = (SELECT public.get_user_org_id())
    AND (
      (SELECT role FROM public.users WHERE id = (SELECT auth.uid())) IN ('manager', 'admin', 'admin_viewer')
      OR (SELECT can_view_prices FROM public.users WHERE id = (SELECT auth.uid())) IS NOT FALSE
    )
  );

-- No INSERT/UPDATE/DELETE policy for `authenticated` — every row is written
-- by issue_invoice() (SECURITY DEFINER), which bypasses RLS as its owner.
-- A client cannot insert, edit, or delete an invoice directly.

-- ── 4. Reprint log — insert-only, never a mutable counter on invoices ────────
CREATE TABLE IF NOT EXISTS public.invoice_prints (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  print_type text NOT NULL CHECK (print_type IN ('a4', 'thermal')),
  printed_at timestamptz NOT NULL DEFAULT now(),
  printed_by uuid REFERENCES public.users(id)
);

CREATE INDEX IF NOT EXISTS invoice_prints_invoice_idx ON public.invoice_prints(invoice_id);

COMMENT ON TABLE public.invoice_prints IS
  'One row per time an invoice was actually printed. ORIGINAL vs COPY is '
  'determined by whether a row already exists for this invoice_id, checked '
  'by the caller before rendering — not a print_count column on invoices, '
  'which would break that table''s insert-only property. See migration-328.';

ALTER TABLE public.invoice_prints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff with price access can read org invoice prints" ON public.invoice_prints;
CREATE POLICY "Staff with price access can read org invoice prints"
  ON public.invoice_prints FOR SELECT TO authenticated
  USING (
    invoice_id IN (
      SELECT id FROM public.invoices WHERE org_id = (SELECT public.get_user_org_id())
    )
  );

DROP POLICY IF EXISTS "Staff with price access can log an invoice print" ON public.invoice_prints;
CREATE POLICY "Staff with price access can log an invoice print"
  ON public.invoice_prints FOR INSERT TO authenticated
  WITH CHECK (
    printed_by = (SELECT auth.uid())
    AND invoice_id IN (
      SELECT id FROM public.invoices WHERE org_id = (SELECT public.get_user_org_id())
    )
  );
-- No UPDATE/DELETE — a print record is a fact, not a toggle.

-- ── 5. issue_invoice(): the whole domain operation, one SECURITY DEFINER fn ──
-- Mirrors issue_voucher() (migration-100): validates, computes, allocates the
-- sequence number atomically, inserts, returns the row. Idempotent per
-- booking — a second call for the same booking_id returns the existing
-- invoice rather than minting a new number.
--
-- Reads billing settings from organizations.settings (migration-329's keys)
-- rather than a dedicated table — same jsonb + update_org_profile_settings()
-- pattern every other org-level setting in this app already uses.
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
  -- document that disagrees with the cash drawer.
  SELECT COALESCE(SUM(amount), 0) INTO v_collected FROM public.payments WHERE booking_id = p_booking_id;
  IF v_total IS DISTINCT FROM v_collected THEN
    RAISE EXCEPTION 'issue_invoice: computed total (%) does not match the amount actually collected (%) for this booking — cannot issue an invoice that disagrees with what was paid', v_total, v_collected;
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

INSERT INTO public.schema_migrations (version, name)
VALUES ('328', 'invoices')
ON CONFLICT (version) DO NOTHING;

COMMIT;
