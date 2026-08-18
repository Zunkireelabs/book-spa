-- Migration 052: custom-payment-methods (RECONSTRUCTED — not the original applied SQL)
--
-- ⚠️ PROVENANCE: Applied directly to production via the Supabase dashboard SQL editor,
-- never committed. No literal record survives (not in this repo, not in
-- supabase_migrations.schema_migrations, which only covers June 2026 onward).
-- Reconstructed on 2026-08-13 by Deployment Operator from the live schema dump
-- (supabase/baseline/schema.sql) to document net effect and bring a from-scratch
-- database to parity. Best-effort, NOT a byte-identical replay.
--
-- Net effect modeled here: lets each org define its own list of accepted payment
-- methods for booking payments (public.payments), stored at
-- organizations.settings->'paymentMethods', instead of the app hardcoding one fixed
-- list for everyone. update_org_payment_methods(jsonb) is the admin-only RPC that
-- writes it.
--
-- JUDGMENT CALL: public.payments.payment_mode_check (defined well before these 13
-- migrations) is, in the live schema, a generic "non-empty, <= 40 chars" check
-- rather than a fixed enum list — exactly what's needed for orgs to submit their own
-- custom mode strings. It's plausible this migration is also where that constraint
-- was loosened from an earlier enum-style check to the generic one, but payments
-- predates this migration set and isn't one of the 13 being reconstructed here, so
-- this file does NOT touch it — only the genuinely new pieces (org settings +
-- the RPC) are included. Flagging the possibility here rather than guessing at
-- payments' pre-052 constraint definition.
--
-- Idempotent (CREATE OR REPLACE FUNCTION; the settings column already exists on
-- organizations from an earlier migration, so no ALTER TABLE is needed here).

CREATE OR REPLACE FUNCTION public.update_org_payment_methods(p_methods jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
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

-- Record migration ------------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('052', 'custom-payment-methods')
ON CONFLICT (version) DO NOTHING;
