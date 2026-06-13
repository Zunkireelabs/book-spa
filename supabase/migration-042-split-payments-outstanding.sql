-- Migration 042: split / partial payments + outstanding-by-person
--
-- Adds the ability to settle a booking with MULTIPLE tenders (e.g. part cash,
-- part card) and to leave the remainder as a DUE (credit). The unpaid balance is
-- attributed to a free-typed "responsible person" name so a new Outstanding
-- report can show "under whom" credit is accumulating (per the client, dues are
-- mostly owners — who are NOT in the therapist roster, hence a plain text name
-- rather than a therapist/user FK).
--
-- Model change: payments goes from one immutable row per booking (full amount)
-- to N immutable rows per booking; booking.payment_status becomes a 3-state
-- (unpaid | partial | paid) recomputed from SUM(payments.amount) vs final_amount.
--
-- Also reconciles payment methods: the UI already offered Card/MobileBanking/etc
-- but the DB enum only allowed Cash/Nabil/GlobalIME/NICAsia/Fonepay, so every
-- non-cash payment was being rejected by Postgres. Methods are standardized to
-- text + CHECK (Cash, Card, MobileBanking, Cheque, Esewa, Khalti) and existing
-- rows are remapped (Nabil/GlobalIME/NICAsia -> Card, Fonepay -> MobileBanking).
--
-- payment_mode and payment_status_enum are converted to text + CHECK (rather than
-- enum surgery) — more portable across the two databases and avoids the
-- "unsafe use of new enum value in same transaction" restriction of ALTER TYPE.
--
-- Idempotent: guarded conversions + IF [NOT] EXISTS throughout; safe to re-run.
-- Portable: no hardcoded UUIDs. MUST also be run on production (see PROMOTION.md).
--
-- Reversible (manual): re-add UNIQUE(booking_id) after collapsing to one row per
-- booking, drop the CHECKs/column, and restore the single-status trigger. Not
-- auto-reversible because the method remap is lossy (bank names -> Card).

-- 1. Payment methods: enum -> text + CHECK, with data remap -------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payments'
      AND column_name = 'payment_mode' AND udt_name = 'payment_mode'
  ) THEN
    ALTER TABLE public.payments
      ALTER COLUMN payment_mode TYPE text
      USING (
        CASE payment_mode::text
          WHEN 'Nabil'     THEN 'Card'
          WHEN 'GlobalIME' THEN 'Card'
          WHEN 'NICAsia'   THEN 'Card'
          WHEN 'Fonepay'   THEN 'MobileBanking'
          ELSE payment_mode::text  -- 'Cash'
        END
      );
  END IF;
END $$;

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS chk_payment_mode;
ALTER TABLE public.payments
  ADD CONSTRAINT chk_payment_mode
  CHECK (payment_mode IN ('Cash','Card','MobileBanking','Cheque','Esewa','Khalti'));

DROP TYPE IF EXISTS payment_mode;

-- 2. Allow multiple tenders per booking ---------------------------------------
-- Drop the one-payment-per-booking UNIQUE (auto-named payments_booking_id_key);
-- payments stay immutable (no UPDATE/DELETE RLS) — settling more appends rows.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_booking_id_key;
CREATE INDEX IF NOT EXISTS idx_payments_booking_id ON public.payments(booking_id);

-- 3. payment_status: enum -> text + CHECK with new 'partial' state -------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bookings'
      AND column_name = 'payment_status' AND udt_name = 'payment_status_enum'
  ) THEN
    ALTER TABLE public.bookings ALTER COLUMN payment_status DROP DEFAULT;
    ALTER TABLE public.bookings
      ALTER COLUMN payment_status TYPE text USING payment_status::text;
    ALTER TABLE public.bookings ALTER COLUMN payment_status SET DEFAULT 'unpaid';
  END IF;
END $$;

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS chk_payment_status;
ALTER TABLE public.bookings
  ADD CONSTRAINT chk_payment_status
  CHECK (payment_status IN ('unpaid','partial','paid'));

DROP TYPE IF EXISTS payment_status_enum;

-- 4. Responsible person for an outstanding balance ----------------------------
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS due_holder_name text;

-- 5. Recompute payment_status from SUM(payments) ------------------------------
-- Replaces the old "any payment => paid" trigger. Runs AFTER INSERT ON payments
-- (trigger trg_payment_update_booking_status already exists from the baseline).
CREATE OR REPLACE FUNCTION update_booking_payment_status()
RETURNS TRIGGER AS $$
DECLARE
  v_paid  numeric;
  v_final numeric;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM public.payments WHERE booking_id = NEW.booking_id;

  SELECT final_amount INTO v_final
  FROM public.bookings WHERE id = NEW.booking_id;

  UPDATE public.bookings
  SET payment_status = CASE
        WHEN v_paid >= v_final THEN 'paid'
        WHEN v_paid > 0        THEN 'partial'
        ELSE 'unpaid'
      END
  WHERE id = NEW.booking_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

-- 6. Record migration ---------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('042', 'split-payments-outstanding')
ON CONFLICT (version) DO NOTHING;
