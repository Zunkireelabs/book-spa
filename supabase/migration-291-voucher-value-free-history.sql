-- Migration 291: vouchers keep their value; sold vs given free; buyer; % coupons; voucher history
-- Idempotent: safe to re-run in either database. (291 is the local number; check the next free one on origin/stage before the PR.)
--
-- WHY (prod, nuad-thai-spa, 2026-10-19)
--   issue_voucher stored total_amount_issued = price after discount, so "what the guest paid" and "what the voucher is worth"
--   were one column. 104/175 vouchers were given free (100% discount) and so are worth NPR 0 and can't be redeemed; 13 sold
--   at a discount lost part of their value. Cash is not affected by splitting the two: income already comes from
--   voucher_payments, never from total_amount_issued.
--
-- WHAT
--   vouchers: total_amount_issued now means VALUE (what the holder can spend). New amount_paid (what was collected),
--     issue_kind ('sold' | 'free') + free_reason/free_note, the Bought by person (buyer_name / buyer_phone /
--     buyer_customer_id), percent_off (a "% off one visit" coupon; value 0), needs_check (old free/coupon vouchers that
--     staff must confirm as used or still valid), last_reminded_at.
--   voucher_types: default_issue_kind ("usually given free") and percent_off (the type is a coupon).
--   voucher_claims.is_legacy: a claim written by check_legacy_voucher; reduces the remaining value but is never counted
--     as redeemed (reports exclude it).
--   voucher_events: extended / reminded / contact_changed / linked / coupon_used / legacy_checked_* history. Read by
--     manager/admin/admin_viewer of the org; written only by the RPCs below (no write policies).
--   issue_voucher: new signature (old 12-arg one dropped; nothing else in the DB calls it; the old named-arg call from the
--     current frontend still resolves because every new argument has a default).
--     * value  = p_actual_price, else the type's standard_price; a coupon type (percent_off) has value 0.
--     * sold   : amount_paid = round(price − price × discount / 100, 2) where price is the value (for a coupon type, its
--                price); it must be > 0 (paid 0 = a free voucher: use free); tenders must equal amount_paid. Staff can sell.
--     * free   : manager/admin only; free_reason required; discount forced to 0; amount_paid 0; no tenders; no
--                voucher_payments row.
--     * A Membership tender is taken from the payer's wallet: the Bought by customer when given, otherwise the For customer
--       (the member discount follows whoever pays).
--     * buyer_customer_id / customer_id must be in the caller's org. Manual-code + counter race handling unchanged
--       (migrations 139/140/174).
--   RPCs (SECURITY DEFINER, search_path public, EXECUTE for authenticated only, role + org checked inside):
--     extend_voucher            admin       new expiry ≥ Nepal today and > current expiry; reason required; 'extended' event
--     update_voucher_contact    manager+    replaces For / Bought by fields; 'linked' when customer_id goes null → set,
--                                           otherwise 'contact_changed'; note lists what changed; no-op if nothing changed
--     log_voucher_reminder      manager+    last_reminded_at = now(); 'reminded' event (optional note, e.g. who was messaged)
--     mark_coupon_used          manager+    coupon only, checked (not needs_check), not expired, not already used;
--                                           booking must be in the org
--     check_legacy_voucher      manager+    needs_check vouchers only. used: value voucher → one voucher_claims row for the
--                                           whole remaining value, is_legacy (bypasses claim_voucher's expiry check), coupon →
--                                           'coupon_used' event; then needs_check = false + legacy_checked_used|valid event
--     undo_legacy_check         manager+    same Nepal day as the check only; removes what the check created; needs_check back
--     voucher_customer_matches  (INVOKER)   unlinked vouchers whose phone equals exactly one org customer's phone
--   Backfill (first run only, see the guard below), with RAISE NOTICE counts:
--     1. amount_paid = sum(voucher_payments), else the old total (before migration-100); issue_kind 'free' where
--        discount_percent = 100 or the total is 0 (nothing was collected either way).
--     2. '25% Discount Voucher' / '40% Discount Voucher' types with standard_price 0 → coupons (percent_off 25/40, usually
--        free); their vouchers stored at 0 get percent_off; the still-valid ones get needs_check.
--     3. Free value vouchers stored at 0 → value = actual_price (or the type's standard_price when that is 0); the still-valid
--        ones get needs_check.
--     4. Discounted (0 < discount < 100) vouchers with value left → value = actual_price (amount_paid already = old total).
--     5. Types whose vouchers (≥ 3) were all given free → default_issue_kind 'free'.
--
-- DB READERS CHECKED (all already treat total_amount_issued as the value, so they are right after this):
--   search_vouchers_for_payment, list_vouchers_for_customer (remaining > 0 keeps excluding coupons: value 0),
--   record_voucher_wallet_payment(_pooled), claim_voucher, admin_correct_voucher_balance. platform_get_org_voucher_sales
--   uses actual_price: unchanged.
--
-- ROLLBACK (loses the restored values: total_amount_issued would have to be set back to amount_paid first)
--   UPDATE public.vouchers SET total_amount_issued = amount_paid WHERE percent_off IS NULL;  -- only if nothing was redeemed since
--   DROP FUNCTION IF EXISTS public.voucher_customer_matches(), public.undo_legacy_check(uuid),
--     public.check_legacy_voucher(uuid, boolean), public.mark_coupon_used(uuid, uuid, text),
--     public.log_voucher_reminder(uuid, text), public.update_voucher_contact(uuid, text, text, uuid, text, text, uuid),
--     public.extend_voucher(uuid, date, text);
--   DROP TABLE IF EXISTS public.voucher_events; ALTER TABLE public.voucher_claims DROP COLUMN IF EXISTS is_legacy;
--   then re-create the 12-arg issue_voucher from migration-174 and drop the new columns.
--   DELETE FROM public.schema_migrations WHERE version = '291';

BEGIN;

-- First run = the vouchers.amount_paid column doesn't exist yet. Remembered for this transaction only, so the backfill
-- below runs exactly once (it is not naturally idempotent: step 1 copies a column that steps 3/4 then change).
DO $$
BEGIN
  PERFORM set_config('zenly.m291_first_run',
    (NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'vouchers' AND column_name = 'amount_paid'))::text,
    true);
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.vouchers ADD COLUMN IF NOT EXISTS issue_kind        text          NOT NULL DEFAULT 'sold';
ALTER TABLE public.vouchers ADD COLUMN IF NOT EXISTS amount_paid       numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE public.vouchers ADD COLUMN IF NOT EXISTS free_reason       text;
ALTER TABLE public.vouchers ADD COLUMN IF NOT EXISTS free_note         text;
ALTER TABLE public.vouchers ADD COLUMN IF NOT EXISTS buyer_name        text;
ALTER TABLE public.vouchers ADD COLUMN IF NOT EXISTS buyer_phone       text;
ALTER TABLE public.vouchers ADD COLUMN IF NOT EXISTS buyer_customer_id uuid REFERENCES public.customers(id);
ALTER TABLE public.vouchers ADD COLUMN IF NOT EXISTS percent_off       numeric(5,2);
ALTER TABLE public.vouchers ADD COLUMN IF NOT EXISTS needs_check       boolean       NOT NULL DEFAULT false;
ALTER TABLE public.vouchers ADD COLUMN IF NOT EXISTS last_reminded_at  timestamptz;

ALTER TABLE public.voucher_types ADD COLUMN IF NOT EXISTS default_issue_kind text NOT NULL DEFAULT 'sold';
ALTER TABLE public.voucher_types ADD COLUMN IF NOT EXISTS percent_off        numeric(5,2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vouchers_issue_kind_check' AND conrelid = 'public.vouchers'::regclass) THEN
    ALTER TABLE public.vouchers ADD CONSTRAINT vouchers_issue_kind_check CHECK (issue_kind IN ('sold', 'free'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vouchers_amount_paid_check' AND conrelid = 'public.vouchers'::regclass) THEN
    ALTER TABLE public.vouchers ADD CONSTRAINT vouchers_amount_paid_check CHECK (amount_paid >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vouchers_free_reason_check' AND conrelid = 'public.vouchers'::regclass) THEN
    ALTER TABLE public.vouchers ADD CONSTRAINT vouchers_free_reason_check
      CHECK (free_reason IN ('promotion', 'apology', 'corporate', 'staff', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vouchers_percent_off_check' AND conrelid = 'public.vouchers'::regclass) THEN
    ALTER TABLE public.vouchers ADD CONSTRAINT vouchers_percent_off_check CHECK (percent_off IS NULL OR percent_off BETWEEN 1 AND 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'voucher_types_default_issue_kind_check' AND conrelid = 'public.voucher_types'::regclass) THEN
    ALTER TABLE public.voucher_types ADD CONSTRAINT voucher_types_default_issue_kind_check CHECK (default_issue_kind IN ('sold', 'free'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'voucher_types_percent_off_check' AND conrelid = 'public.voucher_types'::regclass) THEN
    ALTER TABLE public.voucher_types ADD CONSTRAINT voucher_types_percent_off_check CHECK (percent_off IS NULL OR percent_off BETWEEN 1 AND 100);
  END IF;
END $$;

ALTER TABLE public.voucher_claims ADD COLUMN IF NOT EXISTS is_legacy boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.voucher_claims.is_legacy IS
  'V23: written by check_legacy_voucher ("used before the app tracked it"). Counts against the remaining value, never as redeemed.';

CREATE INDEX IF NOT EXISTS idx_vouchers_buyer_customer ON public.vouchers (buyer_customer_id);

COMMENT ON COLUMN public.vouchers.total_amount_issued IS
  'V23: the VALUE of the voucher (what the holder can spend; remaining = this − sum(voucher_claims)). 0 for a % coupon. What was collected is amount_paid.';
COMMENT ON COLUMN public.vouchers.amount_paid IS
  'V23: what the buyer paid (0 when given free). Cash itself is recorded in voucher_payments.';
COMMENT ON COLUMN public.vouchers.needs_check IS
  'V23: an old free/coupon voucher (from before values were kept) that staff must confirm as already used or still valid.';
COMMENT ON COLUMN public.voucher_types.percent_off IS
  'V23: set = the type is a coupon ("X% off one visit"); its vouchers have value 0.';

CREATE TABLE IF NOT EXISTS public.voucher_events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  voucher_id   uuid        NOT NULL REFERENCES public.vouchers(id) ON DELETE CASCADE,
  kind         text        NOT NULL,
  old_expiry   date,
  new_expiry   date,
  booking_id   uuid        REFERENCES public.bookings(id) ON DELETE SET NULL,
  note         text,
  performed_by uuid        REFERENCES public.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT voucher_events_kind_check CHECK (kind IN ('extended', 'reminded', 'contact_changed', 'linked', 'coupon_used',
                                                       'legacy_checked_used', 'legacy_checked_valid', 'legacy_check_undone'))
);
CREATE INDEX IF NOT EXISTS idx_voucher_events_org_created ON public.voucher_events (org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_voucher_events_voucher     ON public.voucher_events (voucher_id);

ALTER TABLE public.voucher_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Manager/admin can read own org voucher events" ON public.voucher_events;
CREATE POLICY "Manager/admin can read own org voucher events" ON public.voucher_events
  FOR SELECT TO authenticated
  USING (org_id = (SELECT get_user_org_id())
         AND (SELECT get_user_role()) = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'admin_viewer'::user_role]));

-- ---------------------------------------------------------------------------------------------------------------------
-- issue_voucher (new signature)
-- ---------------------------------------------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.issue_voucher(uuid, uuid, text, text, numeric, numeric, date, date, text, uuid, jsonb, text);

CREATE OR REPLACE FUNCTION public.issue_voucher(
  p_branch_id         uuid,
  p_voucher_type_id   uuid,
  p_guest_name        text,
  p_guest_info        text    DEFAULT NULL,
  p_discount_percent  numeric DEFAULT 0,
  p_actual_price      numeric DEFAULT NULL,
  p_issued_date       date    DEFAULT NULL,
  p_expiry_date       date    DEFAULT NULL,
  p_remarks           text    DEFAULT NULL,
  p_customer_id       uuid    DEFAULT NULL,
  p_tenders           jsonb   DEFAULT NULL,
  p_voucher_code      text    DEFAULT NULL,
  p_issue_kind        text    DEFAULT 'sold',
  p_free_reason       text    DEFAULT NULL,
  p_free_note         text    DEFAULT NULL,
  p_buyer_name        text    DEFAULT NULL,
  p_buyer_phone       text    DEFAULT NULL,
  p_buyer_customer_id uuid    DEFAULT NULL
)
RETURNS public.vouchers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role              user_role := get_user_role();
  v_org               uuid      := get_user_org_id();
  v_branch_org        uuid;
  v_customer_org      uuid;
  v_type              record;
  v_seq               int;
  v_code              text;
  v_kind              text      := COALESCE(p_issue_kind, 'sold');
  v_discount          numeric   := COALESCE(p_discount_percent, 0);
  v_price             numeric(10,2);
  v_value             numeric(10,2);
  v_paid              numeric(10,2);
  v_issued            date := COALESCE(p_issued_date, (now() AT TIME ZONE 'Asia/Kathmandu')::date);
  v_expiry            date := COALESCE(p_expiry_date, v_issued + interval '90 days');
  v_row               public.vouchers;
  v_tender            jsonb;
  v_tender_sum        numeric(10,2) := 0;
  v_tender_amt        numeric(10,2);
  v_tender_mode       text;
  v_payer_id          uuid      := COALESCE(p_buyer_customer_id, p_customer_id);
  v_membership_amt    numeric(10,2) := 0;
  v_membership_id     uuid;
  v_membership_balance numeric(12,2);
  v_voucher_payment_id uuid;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('staff','manager','admin') THEN
    RAISE EXCEPTION 'issue_voucher: staff, manager, or admin role required';
  END IF;

  IF p_guest_name IS NULL OR length(btrim(p_guest_name)) = 0 THEN
    RAISE EXCEPTION 'issue_voucher: guest name is required';
  END IF;

  IF v_kind NOT IN ('sold', 'free') THEN
    RAISE EXCEPTION 'issue_voucher: issue kind must be sold or free';
  END IF;

  IF v_kind = 'free' THEN
    IF v_role IS NULL OR v_role NOT IN ('manager','admin') THEN
      RAISE EXCEPTION 'issue_voucher: only a manager or admin can give a voucher free';
    END IF;
    IF p_free_reason IS NULL OR p_free_reason NOT IN ('promotion', 'apology', 'corporate', 'staff', 'other') THEN
      RAISE EXCEPTION 'issue_voucher: a reason is required to give a voucher free';
    END IF;
    IF p_tenders IS NOT NULL AND jsonb_typeof(p_tenders) = 'array' AND jsonb_array_length(p_tenders) > 0 THEN
      RAISE EXCEPTION 'issue_voucher: a free voucher takes no payment';
    END IF;
    v_discount := 0;
  END IF;

  -- Type check only here — whether a nonempty array is REQUIRED depends on
  -- v_paid, which isn't known until after the voucher type/discount are
  -- resolved below.
  IF p_tenders IS NOT NULL AND jsonb_typeof(p_tenders) != 'array' THEN
    RAISE EXCEPTION 'issue_voucher: p_tenders must be a JSON array';
  END IF;

  SELECT org_id INTO v_branch_org FROM public.branches WHERE id = p_branch_id;
  IF v_branch_org IS NULL OR v_branch_org IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'issue_voucher: branch is not in your organization';
  END IF;

  IF p_customer_id IS NOT NULL THEN
    SELECT org_id INTO v_customer_org FROM public.customers WHERE id = p_customer_id;
    IF v_customer_org IS NULL OR v_customer_org IS DISTINCT FROM v_org THEN
      RAISE EXCEPTION 'issue_voucher: customer is not in your organization';
    END IF;
  END IF;

  IF p_buyer_customer_id IS NOT NULL THEN
    v_customer_org := NULL;
    SELECT org_id INTO v_customer_org FROM public.customers WHERE id = p_buyer_customer_id;
    IF v_customer_org IS NULL OR v_customer_org IS DISTINCT FROM v_org THEN
      RAISE EXCEPTION 'issue_voucher: buyer is not in your organization';
    END IF;
  END IF;

  SELECT * INTO v_type FROM public.voucher_types
  WHERE id = p_voucher_type_id AND org_id = v_org;
  IF v_type IS NULL THEN
    RAISE EXCEPTION 'issue_voucher: voucher type not found in your organization';
  END IF;

  IF v_discount < 0 OR v_discount > 100 THEN
    RAISE EXCEPTION 'issue_voucher: discount_percent must be between 0 and 100';
  END IF;

  IF v_expiry < v_issued THEN
    RAISE EXCEPTION 'issue_voucher: expiry_date cannot be before issued_date';
  END IF;

  -- Issued date: never in the future; back-dating is manager/admin only (staff always issue today, owner item V-4).
  IF v_issued > (now() AT TIME ZONE 'Asia/Kathmandu')::date THEN
    RAISE EXCEPTION 'issue_voucher: issued_date cannot be in the future';
  END IF;
  IF v_issued < (now() AT TIME ZONE 'Asia/Kathmandu')::date AND v_role NOT IN ('manager','admin') THEN
    RAISE EXCEPTION 'issue_voucher: only a manager or admin can back-date a voucher';
  END IF;

  -- price = what the voucher sells for. value = what the holder can spend: the price, or 0 for a % coupon.
  v_price := COALESCE(p_actual_price, v_type.standard_price);
  IF v_price < 0 THEN
    RAISE EXCEPTION 'issue_voucher: price cannot be negative';
  END IF;
  v_value := CASE WHEN v_type.percent_off IS NOT NULL THEN 0 ELSE v_price END;
  v_paid  := CASE WHEN v_kind = 'free' THEN 0 ELSE round(v_price - (v_price * v_discount / 100), 2) END;

  -- A sale must collect something: paid 0 with full value is a free voucher, which only a manager/admin may give.
  IF v_kind = 'sold' AND v_paid <= 0 THEN
    RAISE EXCEPTION 'issue_voucher: nothing to collect, use Given free (manager or admin)';
  END IF;

  -- A sale (v_paid > 0, checked above) needs at least one tender; a free
  -- voucher has nothing to collect.
  IF v_paid > 0 AND (p_tenders IS NULL OR jsonb_array_length(p_tenders) = 0) THEN
    RAISE EXCEPTION 'issue_voucher: at least one payment tender is required';
  END IF;

  -- Validate tenders sum to what is paid before touching any table.
  -- (jsonb_array_elements is STRICT — a NULL p_tenders yields zero rows, so
  -- this loop naturally no-ops for a zero-paid voucher with no tenders.)
  FOR v_tender IN SELECT * FROM jsonb_array_elements(p_tenders)
  LOOP
    v_tender_amt := (v_tender->>'amount')::numeric;
    v_tender_mode := v_tender->>'payment_mode';
    IF v_tender_amt IS NULL OR v_tender_amt <= 0 THEN
      RAISE EXCEPTION 'issue_voucher: each tender amount must be greater than zero';
    END IF;
    IF v_tender_mode IS NULL OR length(btrim(v_tender_mode)) = 0 THEN
      RAISE EXCEPTION 'issue_voucher: each tender must have a payment_mode';
    END IF;
    v_tender_sum := v_tender_sum + v_tender_amt;
    IF v_tender_mode = 'Membership' THEN
      v_membership_amt := v_membership_amt + v_tender_amt;
    END IF;
  END LOOP;

  IF v_tender_sum != v_paid THEN
    RAISE EXCEPTION 'issue_voucher: tenders total % does not match the amount to pay %', v_tender_sum, v_paid;
  END IF;

  -- Membership tender: the payer's wallet (Bought by when given, else the For customer). Resolve + lock it and validate the
  -- balance before touching any table, same lock-then-validate order as record_membership_payment.
  IF v_membership_amt > 0 THEN
    IF v_payer_id IS NULL THEN
      RAISE EXCEPTION 'issue_voucher: a linked customer is required to pay by Membership';
    END IF;

    SELECT id, balance INTO v_membership_id, v_membership_balance
    FROM public.memberships
    WHERE org_id = v_org AND customer_id = v_payer_id
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_membership_id IS NULL THEN
      RAISE EXCEPTION 'issue_voucher: customer has no membership';
    END IF;

    IF v_membership_balance < v_membership_amt THEN
      RAISE EXCEPTION 'issue_voucher: insufficient wallet balance (have %, need %)',
        v_membership_balance, v_membership_amt;
    END IF;
  END IF;

  IF p_voucher_code IS NOT NULL AND length(btrim(p_voucher_code)) > 0 THEN
    -- Manual code from a physical booklet: use as typed, don't touch the
    -- counter so auto-generation stays correct for whenever this reverts.
    v_code := btrim(p_voucher_code);
    IF EXISTS (SELECT 1 FROM public.vouchers WHERE org_id = v_org AND voucher_code = v_code) THEN
      RAISE EXCEPTION 'issue_voucher: voucher code % is already in use', v_code;
    END IF;
  ELSE
    -- Keyed by code_prefix (not voucher_type_id): sibling types that share a
    -- prefix (e.g. the three "Full Body Oil Massage" durations, all "NT 4326")
    -- draw from one shared sequence, matching what the code text depends on.
    INSERT INTO public.voucher_code_counters (org_id, branch_id, code_prefix, next_number)
    VALUES (v_org, p_branch_id, v_type.code_prefix, 2)
    ON CONFLICT (branch_id, code_prefix)
      DO UPDATE SET next_number = public.voucher_code_counters.next_number + 1
    RETURNING next_number - 1 INTO v_seq;

    -- 'A' marker distinguishes an auto-generated code from a manual/booklet
    -- one on sight, so the two can never coincide even by chance.
    v_code := v_type.code_prefix || '-A' || lpad(v_seq::text, 4, '0');
  END IF;

  BEGIN
    INSERT INTO public.vouchers (
      org_id, branch_id, voucher_type_id, voucher_code, issued_date, expiry_date,
      guest_name, guest_info, actual_price, discount_percent, total_amount_issued,
      remarks, issued_by, customer_id,
      issue_kind, amount_paid, free_reason, free_note,
      buyer_name, buyer_phone, buyer_customer_id, percent_off
    )
    VALUES (
      v_org, p_branch_id, p_voucher_type_id, v_code, v_issued, v_expiry,
      btrim(p_guest_name), p_guest_info, v_price, v_discount, v_value,
      p_remarks, auth.uid(), p_customer_id,
      v_kind, v_paid,
      CASE WHEN v_kind = 'free' THEN p_free_reason END,
      CASE WHEN v_kind = 'free' THEN NULLIF(btrim(p_free_note), '') END,
      NULLIF(btrim(p_buyer_name), ''), NULLIF(btrim(p_buyer_phone), ''), p_buyer_customer_id,
      v_type.percent_off
    )
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'issue_voucher: voucher code % is already in use', v_code;
  END;

  FOR v_tender IN SELECT * FROM jsonb_array_elements(p_tenders)
  LOOP
    INSERT INTO public.voucher_payments (voucher_id, org_id, branch_id, amount, payment_mode, recorded_by)
    VALUES (
      v_row.id, v_org, p_branch_id,
      (v_tender->>'amount')::numeric,
      v_tender->>'payment_mode',
      auth.uid()
    )
    RETURNING id INTO v_voucher_payment_id;

    IF v_tender->>'payment_mode' = 'Membership' THEN
      INSERT INTO public.membership_transactions
        (membership_id, org_id, kind, amount, payment_mode, voucher_payment_id, performed_by, notes, branch_id)
      VALUES
        (v_membership_id, v_org, 'deduction', -((v_tender->>'amount')::numeric), NULL,
         v_voucher_payment_id, auth.uid(), 'Voucher purchase: ' || v_code, p_branch_id);
    END IF;
  END LOOP;

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- extend_voucher: admin only
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.extend_voucher(p_voucher_id uuid, p_new_expiry date, p_reason text)
RETURNS public.vouchers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org   uuid := get_user_org_id();
  v_today date := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  v_row   public.vouchers;
  v_old   date;
BEGIN
  IF get_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'extend_voucher: admin role required';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'extend_voucher: a reason is required';
  END IF;

  SELECT * INTO v_row FROM public.vouchers WHERE id = p_voucher_id FOR UPDATE;
  IF v_row.id IS NULL OR v_row.org_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'extend_voucher: voucher not found in your organization';
  END IF;
  IF p_new_expiry IS NULL OR p_new_expiry < v_today THEN
    RAISE EXCEPTION 'extend_voucher: the new date cannot be in the past';
  END IF;
  IF p_new_expiry <= v_row.expiry_date THEN
    RAISE EXCEPTION 'extend_voucher: the new date must be after the current one (%)', v_row.expiry_date;
  END IF;

  v_old := v_row.expiry_date;
  UPDATE public.vouchers SET expiry_date = p_new_expiry WHERE id = p_voucher_id RETURNING * INTO v_row;

  INSERT INTO public.voucher_events (org_id, voucher_id, kind, old_expiry, new_expiry, note, performed_by)
  VALUES (v_org, p_voucher_id, 'extended', v_old, p_new_expiry, btrim(p_reason), auth.uid());

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- update_voucher_contact: manager/admin. Replaces all For / Bought by fields with what is passed.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_voucher_contact(
  p_voucher_id        uuid,
  p_guest_name        text,
  p_guest_info        text,
  p_customer_id       uuid,
  p_buyer_name        text,
  p_buyer_phone       text,
  p_buyer_customer_id uuid
)
RETURNS public.vouchers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org         uuid := get_user_org_id();
  v_row         public.vouchers;
  v_name        text := btrim(p_guest_name);
  v_info        text := NULLIF(btrim(p_guest_info), '');
  v_buyer_name  text := NULLIF(btrim(p_buyer_name), '');
  v_buyer_phone text := NULLIF(btrim(p_buyer_phone), '');
  v_changes     text[] := ARRAY[]::text[];
  v_kind        text;
BEGIN
  IF COALESCE(get_user_role()::text, '') NOT IN ('manager','admin') THEN
    RAISE EXCEPTION 'update_voucher_contact: manager or admin role required';
  END IF;
  IF v_name IS NULL OR length(v_name) = 0 THEN
    RAISE EXCEPTION 'update_voucher_contact: the guest name is required';
  END IF;

  SELECT * INTO v_row FROM public.vouchers WHERE id = p_voucher_id FOR UPDATE;
  IF v_row.id IS NULL OR v_row.org_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'update_voucher_contact: voucher not found in your organization';
  END IF;
  IF p_customer_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id AND org_id = v_org) THEN
    RAISE EXCEPTION 'update_voucher_contact: customer is not in your organization';
  END IF;
  IF p_buyer_customer_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_buyer_customer_id AND org_id = v_org) THEN
    RAISE EXCEPTION 'update_voucher_contact: buyer is not in your organization';
  END IF;

  IF v_name IS DISTINCT FROM v_row.guest_name THEN v_changes := v_changes || ('name: ' || v_row.guest_name || ' → ' || v_name); END IF;
  IF v_info IS DISTINCT FROM v_row.guest_info THEN
    v_changes := v_changes || ('phone: ' || COALESCE(v_row.guest_info, '—') || ' → ' || COALESCE(v_info, '—'));
  END IF;
  IF p_customer_id IS DISTINCT FROM v_row.customer_id THEN
    v_changes := v_changes || CASE WHEN p_customer_id IS NULL THEN 'profile unlinked' ELSE 'linked to a profile' END;
  END IF;
  IF v_buyer_name IS DISTINCT FROM v_row.buyer_name THEN
    v_changes := v_changes || ('bought by: ' || COALESCE(v_row.buyer_name, '—') || ' → ' || COALESCE(v_buyer_name, '—'));
  END IF;
  IF v_buyer_phone IS DISTINCT FROM v_row.buyer_phone THEN
    v_changes := v_changes || ('buyer phone: ' || COALESCE(v_row.buyer_phone, '—') || ' → ' || COALESCE(v_buyer_phone, '—'));
  END IF;
  IF p_buyer_customer_id IS DISTINCT FROM v_row.buyer_customer_id THEN
    v_changes := v_changes || CASE WHEN p_buyer_customer_id IS NULL THEN 'buyer profile unlinked' ELSE 'buyer linked to a profile' END;
  END IF;

  IF cardinality(v_changes) = 0 THEN
    RETURN v_row;
  END IF;

  v_kind := CASE WHEN v_row.customer_id IS NULL AND p_customer_id IS NOT NULL THEN 'linked' ELSE 'contact_changed' END;

  UPDATE public.vouchers
     SET guest_name = v_name, guest_info = v_info, customer_id = p_customer_id,
         buyer_name = v_buyer_name, buyer_phone = v_buyer_phone, buyer_customer_id = p_buyer_customer_id
   WHERE id = p_voucher_id
  RETURNING * INTO v_row;

  INSERT INTO public.voucher_events (org_id, voucher_id, kind, note, performed_by)
  VALUES (v_org, p_voucher_id, v_kind, array_to_string(v_changes, '; '), auth.uid());

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- log_voucher_reminder: manager/admin
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_voucher_reminder(p_voucher_id uuid, p_note text DEFAULT NULL)
RETURNS public.vouchers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := get_user_org_id();
  v_row public.vouchers;
BEGIN
  IF COALESCE(get_user_role()::text, '') NOT IN ('manager','admin') THEN
    RAISE EXCEPTION 'log_voucher_reminder: manager or admin role required';
  END IF;

  UPDATE public.vouchers SET last_reminded_at = now()
   WHERE id = p_voucher_id AND org_id = v_org
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'log_voucher_reminder: voucher not found in your organization';
  END IF;

  INSERT INTO public.voucher_events (org_id, voucher_id, kind, note, performed_by)
  VALUES (v_org, p_voucher_id, 'reminded', NULLIF(btrim(p_note), ''), auth.uid());

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- mark_coupon_used: manager/admin. Applying the % at checkout is the V24 follow-up; this records it by hand.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_coupon_used(p_voucher_id uuid, p_booking_id uuid DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := get_user_org_id();
  v_row public.vouchers;
  v_id  uuid;
BEGIN
  IF COALESCE(get_user_role()::text, '') NOT IN ('manager','admin') THEN
    RAISE EXCEPTION 'mark_coupon_used: manager or admin role required';
  END IF;

  SELECT * INTO v_row FROM public.vouchers WHERE id = p_voucher_id FOR UPDATE;
  IF v_row.id IS NULL OR v_row.org_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'mark_coupon_used: voucher not found in your organization';
  END IF;
  IF v_row.percent_off IS NULL THEN
    RAISE EXCEPTION 'mark_coupon_used: this voucher is not a coupon';
  END IF;
  IF v_row.needs_check THEN
    RAISE EXCEPTION 'mark_coupon_used: check this coupon first';
  END IF;
  IF v_row.expiry_date < (now() AT TIME ZONE 'Asia/Kathmandu')::date THEN
    RAISE EXCEPTION 'mark_coupon_used: coupon expired on %', v_row.expiry_date;
  END IF;
  IF EXISTS (SELECT 1 FROM public.voucher_events WHERE voucher_id = p_voucher_id AND kind = 'coupon_used') THEN
    RAISE EXCEPTION 'mark_coupon_used: coupon has already been used';
  END IF;
  IF p_booking_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.bookings b JOIN public.branches br ON br.id = b.branch_id
        WHERE b.id = p_booking_id AND br.org_id = v_org) THEN
    RAISE EXCEPTION 'mark_coupon_used: booking not found in your organization';
  END IF;

  INSERT INTO public.voucher_events (org_id, voucher_id, kind, booking_id, note, performed_by)
  VALUES (v_org, p_voucher_id, 'coupon_used', p_booking_id, NULLIF(btrim(p_note), ''), auth.uid())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- check_legacy_voucher / undo_legacy_check: manager/admin (the one-off review of old free vouchers and coupons)
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_legacy_voucher(p_voucher_id uuid, p_used boolean)
RETURNS public.vouchers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org       uuid := get_user_org_id();
  v_today     date := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  v_row       public.vouchers;
  v_remaining numeric(10,2);
BEGIN
  IF COALESCE(get_user_role()::text, '') NOT IN ('manager','admin') THEN
    RAISE EXCEPTION 'check_legacy_voucher: manager or admin role required';
  END IF;
  IF p_used IS NULL THEN
    RAISE EXCEPTION 'check_legacy_voucher: say whether the voucher was used';
  END IF;

  SELECT * INTO v_row FROM public.vouchers WHERE id = p_voucher_id FOR UPDATE;
  IF v_row.id IS NULL OR v_row.org_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'check_legacy_voucher: voucher not found in your organization';
  END IF;
  IF NOT v_row.needs_check THEN
    RAISE EXCEPTION 'check_legacy_voucher: this voucher has already been checked';
  END IF;

  IF p_used THEN
    IF v_row.percent_off IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.voucher_events WHERE voucher_id = p_voucher_id AND kind = 'coupon_used') THEN
        INSERT INTO public.voucher_events (org_id, voucher_id, kind, note, performed_by)
        VALUES (v_org, p_voucher_id, 'coupon_used', 'Used before the app tracked it', auth.uid());
      END IF;
    ELSE
      -- The whole remaining value, written directly: claim_voucher's expiry check doesn't apply to a past use.
      SELECT v_row.total_amount_issued - COALESCE(SUM(amount_claimed), 0) INTO v_remaining
        FROM public.voucher_claims WHERE voucher_id = p_voucher_id;
      IF v_remaining > 0 THEN
        INSERT INTO public.voucher_claims (voucher_id, org_id, redeemed_date, branch_claimed_id, amount_claimed, notes, performed_by, is_legacy)
        VALUES (p_voucher_id, v_org, v_today, v_row.branch_id, v_remaining, 'Used before the app tracked it', auth.uid(), true);
      END IF;
    END IF;
  END IF;

  UPDATE public.vouchers SET needs_check = false WHERE id = p_voucher_id RETURNING * INTO v_row;

  INSERT INTO public.voucher_events (org_id, voucher_id, kind, performed_by)
  VALUES (v_org, p_voucher_id, CASE WHEN p_used THEN 'legacy_checked_used' ELSE 'legacy_checked_valid' END, auth.uid());

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.undo_legacy_check(p_voucher_id uuid)
RETURNS public.vouchers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org   uuid := get_user_org_id();
  v_today date := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  v_row   public.vouchers;
  v_ev    public.voucher_events;
BEGIN
  IF COALESCE(get_user_role()::text, '') NOT IN ('manager','admin') THEN
    RAISE EXCEPTION 'undo_legacy_check: manager or admin role required';
  END IF;

  SELECT * INTO v_row FROM public.vouchers WHERE id = p_voucher_id FOR UPDATE;
  IF v_row.id IS NULL OR v_row.org_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'undo_legacy_check: voucher not found in your organization';
  END IF;

  -- The latest review event must be a check (not an undo), made today (Nepal).
  SELECT * INTO v_ev FROM public.voucher_events
   WHERE voucher_id = p_voucher_id AND kind IN ('legacy_checked_used', 'legacy_checked_valid', 'legacy_check_undone')
   ORDER BY created_at DESC LIMIT 1;
  IF v_ev.id IS NULL OR v_ev.kind = 'legacy_check_undone' OR v_row.needs_check THEN
    RAISE EXCEPTION 'undo_legacy_check: there is no check to undo';
  END IF;
  IF (v_ev.created_at AT TIME ZONE 'Asia/Kathmandu')::date <> v_today THEN
    RAISE EXCEPTION 'undo_legacy_check: a check can only be undone on the day it was made';
  END IF;

  IF v_ev.kind = 'legacy_checked_used' THEN
    IF v_row.percent_off IS NOT NULL THEN
      DELETE FROM public.voucher_events
       WHERE voucher_id = p_voucher_id AND kind = 'coupon_used'
         AND note = 'Used before the app tracked it' AND performed_by IS NOT DISTINCT FROM v_ev.performed_by;
    ELSE
      DELETE FROM public.voucher_claims WHERE voucher_id = p_voucher_id AND is_legacy;
    END IF;
  END IF;

  UPDATE public.vouchers SET needs_check = true WHERE id = p_voucher_id RETURNING * INTO v_row;

  INSERT INTO public.voucher_events (org_id, voucher_id, kind, performed_by)
  VALUES (v_org, p_voucher_id, 'legacy_check_undone', auth.uid());

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- voucher_customer_matches: unlinked vouchers whose phone (≥ 10 digits; the last 10 compared, so +977 is tolerated)
-- equals the phone of exactly one customer in the org. INVOKER: vouchers RLS limits it to manager/admin/admin_viewer.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.voucher_customer_matches()
RETURNS TABLE (voucher_id uuid, customer_id uuid, customer_name text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH c AS (
    SELECT id, full_name, right(regexp_replace(phone, '\D', '', 'g'), 10) AS d
      FROM public.customers
     WHERE org_id = get_user_org_id() AND length(regexp_replace(COALESCE(phone, ''), '\D', '', 'g')) >= 10
  ), uniq AS (
    SELECT d, min(id::text)::uuid AS id, min(full_name) AS full_name FROM c GROUP BY d HAVING count(*) = 1
  )
  SELECT v.id, u.id, u.full_name
    FROM public.vouchers v
    JOIN uniq u ON u.d = right(regexp_replace(v.guest_info, '\D', '', 'g'), 10)
   WHERE v.org_id = get_user_org_id()
     AND v.customer_id IS NULL
     AND length(regexp_replace(COALESCE(v.guest_info, ''), '\D', '', 'g')) >= 10
     AND get_user_role() IN ('manager', 'admin', 'admin_viewer');
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.issue_voucher(uuid, uuid, text, text, numeric, numeric, date, date, text, uuid, jsonb, text, text, text, text, text, text, uuid)',
    'public.extend_voucher(uuid, date, text)',
    'public.update_voucher_contact(uuid, text, text, uuid, text, text, uuid)',
    'public.log_voucher_reminder(uuid, text)',
    'public.mark_coupon_used(uuid, uuid, text)',
    'public.check_legacy_voucher(uuid, boolean)',
    'public.undo_legacy_check(uuid)',
    'public.voucher_customer_matches()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Backfill (first run only)
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  n       int;
BEGIN
  IF current_setting('zenly.m291_first_run', true) IS DISTINCT FROM 'true' THEN
    RAISE NOTICE '291 backfill: skipped (already applied)';
    RETURN;
  END IF;

  -- 1. What was collected, and how it was handed out.
  -- The true amount collected: its voucher_payments (the old total may have been edited by admin_correct_voucher_balance);
  -- vouchers from before migration-100 have no payment rows, so they fall back to the old total.
  UPDATE public.vouchers v
     SET amount_paid = COALESCE((SELECT SUM(p.amount) FROM public.voucher_payments p WHERE p.voucher_id = v.id), v.total_amount_issued);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '291 step 1a: amount_paid set on % vouchers (% from voucher_payments, % from the old total)', n,
    (SELECT count(*) FROM public.vouchers v WHERE EXISTS (SELECT 1 FROM public.voucher_payments p WHERE p.voucher_id = v.id)),
    (SELECT count(*) FROM public.vouchers v WHERE NOT EXISTS (SELECT 1 FROM public.voucher_payments p WHERE p.voucher_id = v.id));

  UPDATE public.vouchers SET issue_kind = 'free' WHERE discount_percent = 100 OR total_amount_issued = 0;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '291 step 1b: % vouchers marked given free (100%% discount or nothing collected)', n;

  -- 2. The % coupon types and their vouchers.
  UPDATE public.voucher_types
     SET percent_off = CASE name WHEN '25% Discount Voucher' THEN 25 ELSE 40 END,
         default_issue_kind = 'free'
   WHERE name IN ('25% Discount Voucher', '40% Discount Voucher') AND standard_price = 0 AND percent_off IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '291 step 2a: % voucher types made %% coupons', n;

  UPDATE public.vouchers v SET percent_off = t.percent_off
    FROM public.voucher_types t
   WHERE t.id = v.voucher_type_id AND t.percent_off IS NOT NULL AND v.percent_off IS NULL
     AND v.total_amount_issued = 0;  -- one sold with a real NPR total stays a value voucher
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '291 step 2b: % vouchers became coupons', n;

  UPDATE public.vouchers SET needs_check = true
   WHERE percent_off IS NOT NULL AND expiry_date >= v_today AND NOT needs_check;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '291 step 2c: % still-valid coupons need a check', n;

  -- 3. Free value vouchers stored at 0 get their value back.
  CREATE TEMP TABLE m291_free ON COMMIT DROP AS
    SELECT v.id, CASE WHEN v.actual_price > 0 THEN v.actual_price ELSE t.standard_price END AS value, v.expiry_date
      FROM public.vouchers v JOIN public.voucher_types t ON t.id = v.voucher_type_id
     WHERE v.issue_kind = 'free' AND v.percent_off IS NULL AND v.total_amount_issued = 0;

  UPDATE public.vouchers v SET total_amount_issued = f.value
    FROM m291_free f WHERE f.id = v.id AND f.value > 0;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '291 step 3a: % free vouchers given back their value (NPR %)', n,
    (SELECT COALESCE(SUM(value), 0) FROM m291_free WHERE value > 0);

  UPDATE public.vouchers v SET needs_check = true
    FROM m291_free f WHERE f.id = v.id AND f.value > 0 AND f.expiry_date >= v_today;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '291 step 3b: % of them are still valid and need a check', n;

  -- 4. Discounted vouchers with value left get their full value back (amount_paid already holds the old total).
  UPDATE public.vouchers v SET total_amount_issued = v.actual_price
   WHERE v.discount_percent > 0 AND v.discount_percent < 100 AND v.percent_off IS NULL
     AND v.total_amount_issued < v.actual_price
     AND v.total_amount_issued - COALESCE((SELECT SUM(c.amount_claimed) FROM public.voucher_claims c WHERE c.voucher_id = v.id), 0) > 0;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '291 step 4: % discounted vouchers given back their full value', n;

  -- 5. Types that are always given away.
  UPDATE public.voucher_types t SET default_issue_kind = 'free'
   WHERE t.default_issue_kind = 'sold'
     AND (SELECT count(*) FROM public.vouchers v WHERE v.voucher_type_id = t.id) >= 3
     AND NOT EXISTS (SELECT 1 FROM public.vouchers v WHERE v.voucher_type_id = t.id AND v.issue_kind <> 'free');
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '291 step 5: % voucher types are usually given free', n;
END $$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('291', 'voucher-value-free-history')
ON CONFLICT (version) DO NOTHING;

COMMIT;
