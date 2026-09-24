-- Migration 222: extend staff_update_customer_contact to also edit full_name/notes
--
-- staff_update_customer_contact (migration-173, patched by migration-180) only ever
-- accepted email/phone. The new manual-merge flow (Customers > Manual Merge tab) lets a
-- manager/admin edit the surviving customer's name/notes right after merging two duplicate
-- records, so this needs a name/notes write path too. Adds p_full_name/p_notes as optional
-- (default NULL, COALESCE-onto-existing — same "only touch what's provided" contract the
-- function already uses for email/phone). full_name is normalized the same way
-- migration-158's one-time backfill did (collapse whitespace, initcap) since there's no
-- DB trigger enforcing title case — normalization otherwise only happens in the JS layer.

-- CREATE OR REPLACE only replaces a function whose argument types match exactly, and this
-- call adds two new params — without an explicit DROP first, Postgres would keep the old
-- 3-arg overload alongside this one instead of replacing it.
DROP FUNCTION IF EXISTS public.staff_update_customer_contact(uuid, text, text);

CREATE OR REPLACE FUNCTION public.staff_update_customer_contact(
  p_customer_id uuid,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_full_name text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS public.customers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role          user_role := get_user_role();
  v_org           uuid      := get_user_org_id();
  v_customer      public.customers;
  v_norm_email    text := NULLIF(lower(btrim(p_email)), '');
  v_norm_phone    text := public.normalize_phone_e164(p_phone);
  v_norm_name     text := NULLIF(initcap(regexp_replace(btrim(p_full_name), '\s+', ' ', 'g')), '');
  v_norm_notes    text := NULLIF(btrim(p_notes), '');
  v_email_sharers int;
BEGIN
  IF v_role NOT IN ('staff','manager','admin') THEN
    RAISE EXCEPTION 'staff_update_customer_contact: staff, manager, or admin role required';
  END IF;

  UPDATE public.customers c
  SET email     = COALESCE(v_norm_email, c.email),
      phone     = COALESCE(v_norm_phone, c.phone),
      full_name = COALESCE(v_norm_name, c.full_name),
      notes     = COALESCE(v_norm_notes, c.notes)
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
$$;

REVOKE ALL ON FUNCTION public.staff_update_customer_contact(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_update_customer_contact(uuid, text, text, text, text) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('222', 'customer-contact-name-notes')
ON CONFLICT (version) DO NOTHING;
