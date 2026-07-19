-- Migration 055: fix stale payment_mode CHECK constraint (bug fix)
--
-- Migrations 046 and 052 both intended to relax/replace the payment_mode CHECK
-- constraint, but both used the wrong constraint name ("payments_payment_mode_check").
-- The real constraint, created in migration-042, is named "chk_payment_mode". Because
-- both migrations used `DROP CONSTRAINT IF EXISTS`, the wrong-name drop silently
-- no-op'd and the new "payments_payment_mode_check" constraint was added *alongside*
-- the original "chk_payment_mode" — leaving the old fixed allowlist
-- (Cash/Card/MobileBanking/Cheque/Esewa/Khalti[/Membership]) still enforced.
--
-- Symptom: admin adds a custom payment method (e.g. "Mastercard") via
-- update_org_payment_methods, but recording a payment with it fails with:
--   new row for relation "payments" violates check constraint "chk_payment_mode"
--
-- Fix: drop the real old constraint by its actual name. The replacement constraint
-- from migration-052 (payments_payment_mode_check, non-empty <= 40 chars) already
-- exists and is correct — nothing to re-add here.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS. Portable: no hardcoded UUIDs.
--
-- Reversible:
--   ALTER TABLE public.payments ADD CONSTRAINT chk_payment_mode
--     CHECK (payment_mode IN ('Cash','Card','MobileBanking','Cheque','Esewa','Khalti','Membership'));

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS chk_payment_mode;

-- Record migration
INSERT INTO public.schema_migrations (version, name)
VALUES ('055', 'fix-payment-mode-constraint-name')
ON CONFLICT (version) DO NOTHING;
