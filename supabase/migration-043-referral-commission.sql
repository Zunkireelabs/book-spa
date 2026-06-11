-- Migration 043: per-booking referral commission
--
-- Lets each booking carry a referral commission for whoever referred it
-- (bookings.referred_by, a free-typed name that the UI suggests from the
-- therapist roster). Commission is configured PER BOOKING, not as a global
-- rate, and can be either a percentage of final_amount or a flat NPR amount.
--
--   referral_commission_type  : 'percentage' | 'amount' | NULL (unset)
--   referral_commission_value : the % (e.g. 10 = 10%) or the flat NPR amount
--
-- The earned commission is DERIVED at read time, not stored:
--   percentage -> final_amount * value / 100
--   amount     -> value
-- so it always tracks the booking's current final_amount.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + guarded CHECK; safe to re-run.
-- Portable: no hardcoded UUIDs. MUST also be run on production (see PROMOTION.md).
--
-- Reversible (manual): drop the CHECK and the two columns.

-- 1. Per-booking commission columns -------------------------------------------
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS referral_commission_type text;
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS referral_commission_value numeric;

-- 2. Constrain the type + keep value non-negative -----------------------------
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS chk_referral_commission;
ALTER TABLE public.bookings
  ADD CONSTRAINT chk_referral_commission
  CHECK (
    (referral_commission_type IS NULL)
    OR (
      referral_commission_type IN ('percentage','amount')
      AND referral_commission_value IS NOT NULL
      AND referral_commission_value >= 0
      AND (referral_commission_type <> 'percentage' OR referral_commission_value <= 100)
    )
  );

-- 3. Record migration ---------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('043', 'referral-commission')
ON CONFLICT (version) DO NOTHING;
