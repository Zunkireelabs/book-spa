-- Migration 052: admin-manageable, custom payment methods (additive, REVERSIBLE)
--
-- Until now, payments.payment_mode was locked to a fixed CHECK list (Cash, Card,
-- MobileBanking, Cheque, Esewa, Khalti, Membership — from migration-042/046) and the
-- payment-method dropdown in PaymentModal.jsx was hardcoded to match. This migration
-- lets admins add/rename/delete payment methods per org, including fully custom ones,
-- stored in organizations.settings.paymentMethods (jsonb, added in migration-009).
--
-- Two changes:
--   1. Relax payments_payment_mode_check from a fixed allowlist to a basic sanity
--      check (non-empty, <= 40 chars) — the admin-configured list in
--      organizations.settings is now the source of truth for what's offered in the
--      UI; the DB just guards against garbage values, not a specific vocabulary.
--   2. Add update_org_payment_methods(p_methods jsonb) — a SECURITY DEFINER RPC
--      (mirrors record_membership_payment from migration-046) that lets an org's
--      admin write settings.paymentMethods without a blanket UPDATE RLS policy on
--      organizations (which has none today — migration-009 only granted SELECT).
--      Scoping the write to a single RPC prevents an admin write path from being able
--      to touch name/slug/code.
--
-- Idempotent (DROP/CREATE OR REPLACE guarded) and portable (no hardcoded UUIDs).
-- MUST also be run on production (see PROMOTION.md) once this ships past stage.
--
-- Reversible:
--   DROP FUNCTION IF EXISTS public.update_org_payment_methods(jsonb);
--   ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_payment_mode_check;
--   ALTER TABLE public.payments ADD CONSTRAINT payments_payment_mode_check
--     CHECK (payment_mode IN ('Cash','Card','MobileBanking','Cheque','Esewa','Khalti','Membership'));

-- ============================================================
-- 1. Relax payment_mode CHECK
-- ============================================================

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_payment_mode_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_payment_mode_check
  CHECK (
    payment_mode IS NOT NULL
    AND length(trim(payment_mode)) > 0
    AND length(payment_mode) <= 40
  );

-- ============================================================
-- 2. update_org_payment_methods — admin-only, org-scoped settings write
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_org_payment_methods(p_methods jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org_id  uuid := get_user_org_id();
  v_role    text := get_user_role();
  v_settings jsonb;
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'update_org_payment_methods: admin only';
  END IF;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'update_org_payment_methods: no organization context';
  END IF;

  IF jsonb_typeof(p_methods) IS DISTINCT FROM 'array' OR jsonb_array_length(p_methods) = 0 THEN
    RAISE EXCEPTION 'update_org_payment_methods: p_methods must be a non-empty array';
  END IF;

  UPDATE public.organizations
  SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{paymentMethods}', p_methods, true)
  WHERE id = v_org_id
  RETURNING settings INTO v_settings;

  IF v_settings IS NULL THEN
    RAISE EXCEPTION 'update_org_payment_methods: organization % not found', v_org_id;
  END IF;

  RETURN v_settings;
END;
$$;

REVOKE ALL ON FUNCTION public.update_org_payment_methods(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_org_payment_methods(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_org_payment_methods(jsonb) TO authenticated;

-- ============================================================
-- 3. Record migration
-- ============================================================

INSERT INTO public.schema_migrations (version, name)
VALUES ('052', 'custom-payment-methods')
ON CONFLICT (version) DO NOTHING;
