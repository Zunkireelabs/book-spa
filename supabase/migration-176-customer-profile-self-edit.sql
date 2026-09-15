-- ============================================================
-- Migration 176: customer profile self-edit (name/phone direct,
-- email via OTP re-verification)
-- ============================================================
--
-- Closes a pre-existing gap: migration-064's "customer updates own account"
-- RLS policy on customer_accounts is row-scoped only (auth_user_id =
-- auth.uid()) — it does not restrict WHICH columns change. Nothing today
-- stops a customer session from calling
-- supabaseCustomer.from('customer_accounts').update({ email: 'x' }) with
-- zero re-verification (no UI exercised this before now, but the policy
-- already permitted it). This migration adds a guard trigger so email can
-- only change via sync_customer_email() below, called client-side only
-- after Supabase Auth's own OTP re-verification (verifyOtp type:
-- 'email_change') succeeds.
--
-- Three pieces:
--   1. trg_guard_customer_account_email — BEFORE UPDATE trigger blocking any
--      direct email write outside the sync path.
--   2. update_customer_contact_info(name, phone) — customer-callable RPC for
--      the two fields that DON'T need re-verification. Also syncs the
--      linked customers.phone row.
--   3. sync_customer_email() — customer-callable RPC, called once the client
--      has confirmed a new email via Supabase's native OTP email-change
--      flow; mirrors auth.users.email (already updated by Supabase Auth at
--      that point) onto customer_accounts.email AND the linked
--      customers.email, so staff dashboards / outreach (which read
--      customers.email live) don't go stale.
--
-- Safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION public.trg_guard_customer_account_email()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email
     AND current_setting('app.allow_customer_email_change', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'customer_accounts.email can only change via sync_customer_email() after OTP re-verification';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_customer_account_email ON public.customer_accounts;
CREATE TRIGGER guard_customer_account_email
  BEFORE UPDATE ON public.customer_accounts
  FOR EACH ROW EXECUTE FUNCTION public.trg_guard_customer_account_email();

CREATE OR REPLACE FUNCTION public.update_customer_contact_info(
  p_full_name text DEFAULT NULL,
  p_phone      text DEFAULT NULL
)
RETURNS public.customer_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_account customer_accounts;
  v_norm_phone text := public.normalize_phone_e164(p_phone);
BEGIN
  UPDATE public.customer_accounts
  SET full_name = COALESCE(NULLIF(btrim(p_full_name), ''), full_name),
      phone      = COALESCE(v_norm_phone, phone)
  WHERE auth_user_id = auth.uid()
  RETURNING * INTO v_account;

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'update_customer_contact_info: no customer account for this session';
  END IF;

  IF v_account.customer_id IS NOT NULL AND v_norm_phone IS NOT NULL THEN
    UPDATE public.customers SET phone = v_norm_phone WHERE id = v_account.customer_id;
  END IF;

  RETURN v_account;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.update_customer_contact_info(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_customer_email()
RETURNS public.customer_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_new_email text;
  v_account   customer_accounts;
BEGIN
  SELECT email INTO v_new_email FROM auth.users WHERE id = auth.uid();
  IF v_new_email IS NULL THEN
    RAISE EXCEPTION 'sync_customer_email: no authenticated user email found';
  END IF;

  PERFORM set_config('app.allow_customer_email_change', 'true', true); -- tx-local, auto-clears

  UPDATE public.customer_accounts
  SET email = v_new_email
  WHERE auth_user_id = auth.uid()
  RETURNING * INTO v_account;

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'sync_customer_email: no customer account for this session';
  END IF;

  -- Keep the linked customers row in sync too — staff dashboards and
  -- outreach (migrations 101-112) read customers.email live, so without
  -- this a self-service email change would silently go stale everywhere
  -- outside the portal itself.
  IF v_account.customer_id IS NOT NULL THEN
    UPDATE public.customers SET email = v_new_email WHERE id = v_account.customer_id;
  END IF;

  RETURN v_account;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.sync_customer_email() TO authenticated;

-- ============================================================
-- MIGRATION 176 COMPLETE
-- ============================================================

INSERT INTO public.schema_migrations (version, name)
VALUES ('176', 'customer-profile-self-edit')
ON CONFLICT (version) DO NOTHING;
