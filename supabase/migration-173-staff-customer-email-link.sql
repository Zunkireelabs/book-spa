-- ============================================================
-- Migration 173: staff-added customer email + account repair-link
-- ============================================================
--
-- Portal login (/:orgSlug/customer-login) is email-OTP-only. Membership,
-- voucher, and package customers are frequently enrolled by staff with only
-- a phone number (customers.email is nullable and often blank for exactly
-- this population), so those customers currently have no way to ever reach
-- the portal. This adds a staff-callable RPC to add/edit a customer's email
-- (and/or phone) so that customer can subsequently sign up.
--
-- create_customer_account() (migration-065) already links a new
-- customer_accounts row to an existing customers row by exact
-- case-insensitive email match, but only at signup time. This migration
-- adds the missing repair-link for the other direction: a customer who
-- already has a bare customer_accounts row (customer_id IS NULL, because no
-- matching customers.email existed yet at their signup) picks up the link
-- retroactively once staff set/correct that email.
--
-- No new RLS needed for the customers write itself — staff/manager/admin
-- already have UPDATE on customers (migration-012/063).
--
-- Safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION public.staff_update_customer_contact(
  p_customer_id uuid,
  p_email       text DEFAULT NULL,
  p_phone       text DEFAULT NULL
)
RETURNS public.customers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role       user_role := get_user_role();
  v_org        uuid      := get_user_org_id();
  v_customer   public.customers;
  v_norm_email text := NULLIF(lower(btrim(p_email)), '');
  v_norm_phone text := public.normalize_phone_e164(p_phone);
BEGIN
  IF v_role NOT IN ('staff','manager','admin') THEN
    RAISE EXCEPTION 'staff_update_customer_contact: staff, manager, or admin role required';
  END IF;

  UPDATE public.customers c
  SET email = COALESCE(v_norm_email, c.email),
      phone = COALESCE(v_norm_phone, c.phone)
  FROM public.branches b
  WHERE c.id = p_customer_id AND c.branch_id = b.id AND b.org_id = v_org
  RETURNING c.* INTO v_customer;

  IF v_customer IS NULL THEN
    RAISE EXCEPTION 'staff_update_customer_contact: customer not found in your organization';
  END IF;

  -- Repair-link: an already-signed-up customer_accounts row with no
  -- customer_id yet (email didn't match anything at signup time) picks up
  -- this customer now that the email is set/corrected — mirrors the
  -- matching logic create_customer_account already runs at signup.
  IF v_norm_email IS NOT NULL THEN
    UPDATE public.customer_accounts ca
    SET customer_id = v_customer.id
    WHERE ca.customer_id IS NULL
      AND ca.org_id = v_org
      AND lower(ca.email) = v_norm_email;
  END IF;

  RETURN v_customer;
END;
$function$;

REVOKE ALL ON FUNCTION public.staff_update_customer_contact(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.staff_update_customer_contact(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.staff_update_customer_contact(uuid, text, text) TO authenticated;

-- ============================================================
-- MIGRATION 173 COMPLETE
-- ============================================================

INSERT INTO public.schema_migrations (version, name)
VALUES ('173', 'staff-customer-email-link')
ON CONFLICT (version) DO NOTHING;
