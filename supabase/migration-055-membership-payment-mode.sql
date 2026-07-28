-- Migration 055: relax membership_transactions.payment_mode CHECK (additive, REVERSIBLE)
--
-- membership_transactions.payment_mode (migration-045) still carries the OLD fixed
-- allowlist (Cash, Card, MobileBanking, Cheque, Esewa, Khalti, Membership). payments
-- .payment_mode had this same constraint relaxed to a basic sanity check in
-- migration-052-custom-payment-methods.sql so admins could add custom/grouped
-- payment methods (organizations.settings.paymentMethods) for booking payments —
-- membership_transactions was never updated to match. Enroll/renew membership flows
-- are moving to the same admin-configured payment-method list + PaymentMethodSelector
-- as booking payments, so a custom or grouped sub-method (e.g. "Mastercard") would
-- violate the old CHECK and fail the enroll/renew RPC.
--
-- Idempotent (DROP/ADD CONSTRAINT guarded) and portable (no hardcoded UUIDs).
-- MUST also be run on production (see PROMOTION.md) once this ships past stage.
--
-- Reversible:
--   ALTER TABLE public.membership_transactions DROP CONSTRAINT IF EXISTS membership_transactions_payment_mode_check;
--   ALTER TABLE public.membership_transactions ADD CONSTRAINT membership_transactions_payment_mode_check
--     CHECK (payment_mode IN ('Cash','Card','MobileBanking','Cheque','Esewa','Khalti','Membership'));

ALTER TABLE public.membership_transactions DROP CONSTRAINT IF EXISTS membership_transactions_payment_mode_check;
ALTER TABLE public.membership_transactions ADD CONSTRAINT membership_transactions_payment_mode_check
  CHECK (
    payment_mode IS NULL
    OR (length(trim(payment_mode)) > 0 AND length(payment_mode) <= 40)
  );

INSERT INTO public.schema_migrations (version, name)
VALUES ('055', 'membership-payment-mode')
ON CONFLICT (version) DO NOTHING;
