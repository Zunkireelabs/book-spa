-- ============================================================
-- Migration 180: don't repair-link an ambiguous email
-- ============================================================
--
-- staff_update_customer_contact()'s repair-link (migration-173) attaches an
-- already-signed-up customer_accounts row (customer_id IS NULL) to the
-- customers row staff just set/corrected an email on. customer_accounts has
-- UNIQUE(org_id, email), so at most one account can ever exist per email —
-- but customers.email has no such constraint, so two different real
-- customers in the same org can share an email (family, a shared front-desk
-- contact, a typo). Whichever one staff happened to edit first silently won
-- the repair-link; editing the second customer with the same email later
-- silently no-op'd (the account was already claimed), with no signal to
-- staff that the login now points at the wrong person's
-- membership/voucher/package data.
--
-- One email can only ever back one login, so this can't be solved by
-- linking both — the fix is to refuse to guess: skip the repair-link
-- entirely when the email is ambiguous (more than one customers row in the
-- org shares it), leaving it for a human to resolve, rather than silently
-- and unrecoverably attaching the login to whichever customer was edited
-- first. The primary action (updating this customer's own email/phone)
-- still succeeds either way — only the secondary, best-effort linking step
-- is withheld.
--
-- Same 3-arg signature as migration-173 — CREATE OR REPLACE in place, no
-- DROP FUNCTION needed.
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
  v_role          user_role := get_user_role();
  v_org           uuid      := get_user_org_id();
  v_customer      public.customers;
  v_norm_email    text := NULLIF(lower(btrim(p_email)), '');
  v_norm_phone    text := public.normalize_phone_e164(p_phone);
  v_email_sharers int;
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
  -- matching logic create_customer_account already runs at signup. Skipped
  -- entirely if the email is ambiguous (shared by more than one customers
  -- row in this org) — see migration-180 header for why.
  IF v_norm_email IS NOT NULL THEN
    SELECT count(*) INTO v_email_sharers
    FROM public.customers c
    JOIN public.branches b ON b.id = c.branch_id
    WHERE b.org_id = v_org AND lower(c.email) = v_norm_email;

    IF v_email_sharers = 1 THEN
      UPDATE public.customer_accounts ca
      SET customer_id = v_customer.id
      WHERE ca.customer_id IS NULL
        AND ca.org_id = v_org
        AND lower(ca.email) = v_norm_email;
    END IF;
  END IF;

  RETURN v_customer;
END;
$function$;

REVOKE ALL ON FUNCTION public.staff_update_customer_contact(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.staff_update_customer_contact(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.staff_update_customer_contact(uuid, text, text) TO authenticated;

-- ============================================================
-- MIGRATION 180 COMPLETE
-- ============================================================

INSERT INTO public.schema_migrations (version, name)
VALUES ('180', 'fix-ambiguous-email-repair-link')
ON CONFLICT (version) DO NOTHING;
