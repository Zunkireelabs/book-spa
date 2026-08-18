-- Migration 083: relax enroll_member()'s payment_mode validation (additive, REVERSIBLE)
--
-- enroll_member() (migration-045, re-CREATE OR REPLACE'd by migration-080) still
-- validates p_payment_mode against the OLD fixed allowlist:
--   IF p_payment_mode IS NULL OR p_payment_mode NOT IN
--     ('Cash','Card','MobileBanking','Cheque','Esewa','Khalti') THEN
--     RAISE EXCEPTION 'enroll_member: invalid payment_mode %', p_payment_mode;
--
-- migration-052-custom-payment-methods.sql relaxed payments.payment_mode, and
-- migration-060-membership-payment-mode.sql relaxed membership_transactions
-- .payment_mode, to a basic sanity check (non-empty, <= 40 chars) so admins could
-- add custom/grouped payment methods (organizations.settings.paymentMethods) — but
-- enroll_member()'s own inline check was never updated to match. Any org-configured
-- custom method (Mastercard, IME Pay, Visa, or a re-cased "eSewa") now passes the
-- table CHECK but is rejected by this RPC's own RAISE EXCEPTION before it ever
-- reaches the table.
--
-- Fix: replace the hardcoded IN (...) list with the same sanity check already used
-- by the relaxed table constraints, so enroll_member() accepts whatever the
-- admin-configured payment-method list offers, same as record_membership_payment
-- and the booking checkout flow already do.
--
-- Idempotent (CREATE OR REPLACE) and portable (no hardcoded UUIDs).
-- MUST also be run on production (see PROMOTION.md) once this ships past stage.
--
-- Reversible: re-run migration-080-staff-membership-enrollment.sql's
-- CREATE OR REPLACE FUNCTION public.enroll_member(...) block to restore the old
-- fixed allowlist check.

CREATE OR REPLACE FUNCTION public.enroll_member(
  p_customer_id      uuid,
  p_tier_id          uuid,
  p_initial_deposit  numeric,
  p_payment_mode     text,
  p_notes            text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role        user_role := get_user_role();
  v_caller_org  uuid      := get_user_org_id();
  v_cust_org    uuid;
  v_tier_org    uuid;
  v_membership  uuid;
BEGIN
  IF v_role NOT IN ('manager', 'admin', 'staff') THEN
    RAISE EXCEPTION 'enroll_member: manager, admin, or staff role required';
  END IF;

  IF p_initial_deposit IS NULL OR p_initial_deposit <= 0 THEN
    RAISE EXCEPTION 'enroll_member: initial deposit must be positive';
  END IF;

  IF p_payment_mode IS NULL
     OR length(trim(p_payment_mode)) = 0
     OR length(p_payment_mode) > 40 THEN
    RAISE EXCEPTION 'enroll_member: invalid payment_mode %', p_payment_mode;
  END IF;

  SELECT org_id INTO v_cust_org FROM public.customers      WHERE id = p_customer_id;
  SELECT org_id INTO v_tier_org FROM public.membership_tiers WHERE id = p_tier_id;

  IF v_cust_org IS NULL THEN
    RAISE EXCEPTION 'enroll_member: customer % not found', p_customer_id;
  END IF;
  IF v_tier_org IS NULL THEN
    RAISE EXCEPTION 'enroll_member: tier % not found', p_tier_id;
  END IF;
  IF v_cust_org IS DISTINCT FROM v_caller_org OR v_tier_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'enroll_member: customer and tier must be in your organization';
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, notes, created_by)
  VALUES (v_caller_org, p_customer_id, p_tier_id, p_notes, auth.uid())
  RETURNING id INTO v_membership;

  -- Initial deposit, inserted directly (not via record_membership_transaction,
  -- which is manager/admin-only) so a staff-enrolled member's first deposit
  -- still goes through the same trigger-driven balance recompute.
  INSERT INTO public.membership_transactions
    (membership_id, org_id, kind, amount, payment_mode, performed_by, notes)
  VALUES
    (v_membership, v_caller_org, 'deposit', p_initial_deposit, p_payment_mode, auth.uid(), 'Initial enrollment deposit');

  RETURN v_membership;
END;
$$;

REVOKE ALL ON FUNCTION public.enroll_member(uuid, uuid, numeric, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enroll_member(uuid, uuid, numeric, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.enroll_member(uuid, uuid, numeric, text, text) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('083', 'enroll-member-payment-mode')
ON CONFLICT (version) DO NOTHING;
