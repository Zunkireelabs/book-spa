-- Migration 055: fix-payment-mode-constraint-name (RECONSTRUCTED — not the original
-- applied SQL)
--
-- ⚠️ PROVENANCE: Applied directly to production via the Supabase dashboard SQL editor,
-- never committed. No literal record survives (not in this repo, not in
-- supabase_migrations.schema_migrations, which only covers June 2026 onward).
-- Reconstructed on 2026-08-13 by Deployment Operator from the live schema dump
-- (supabase/baseline/schema.sql) to document net effect and bring a from-scratch
-- database to parity. Best-effort, NOT a byte-identical replay.
--
-- JUDGMENT CALL / low confidence: the live schema shows
-- membership_transactions_payment_mode_check as a generic "NULL, or non-empty and
-- <= 40 chars" CHECK — NOT the fixed enum ('Cash','Card','MobileBanking','Cheque',
-- 'Esewa','Khalti') that migration-046 introduced. Something between 046 and today
-- relaxed it to the generic form (needed once org.settings.paymentMethods /
-- custom-payment-methods, migration-052, let orgs define their own mode strings —
-- a fixed enum would reject any custom value). "fix-payment-mode-constraint-name"
-- is the only remaining migration name in the 045-063 range that plausibly touches
-- this constraint, so this file is where that relaxation is modeled: drop the old
-- enum-shaped constraint from 046 and add back a correctly-named, generically
-- shaped one matching public.payments_payment_mode_check's pattern. The literal
-- rename detail implied by the migration's name (what the "wrong" name actually
-- was) could not be recovered from the final schema and is not knowable from this
-- evidence — schema.sql only shows the end state, not the intermediate wrong name.
--
-- Idempotent (DROP CONSTRAINT IF EXISTS + guarded ADD CONSTRAINT).

DO $$
BEGIN
  -- Drop whatever shape/name the constraint had after 046 (enum-style, and possibly
  -- misnamed — the original name is unrecoverable from the final schema).
  ALTER TABLE public.membership_transactions
    DROP CONSTRAINT IF EXISTS membership_transactions_payment_mode_check;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'membership_transactions_payment_mode_check'
  ) THEN
    ALTER TABLE public.membership_transactions
      ADD CONSTRAINT membership_transactions_payment_mode_check
      CHECK (
        payment_mode IS NULL
        OR (length(trim(both from payment_mode)) > 0 AND length(payment_mode) <= 40)
      );
  END IF;
END $$;

-- Record migration ------------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('055', 'fix-payment-mode-constraint-name')
ON CONFLICT (version) DO NOTHING;
