-- Migration 402 (ZNLY-274): create_customer_for_booking — the one way a booking creates (or finds) its customer row.
--
-- Bug: createBooking inserted into customers with `.insert(...).select('id').single()`. anon has an INSERT policy but no
-- SELECT policy (migration-098), so the RETURNING read failed for the online booking page: the booking saved with
-- customer_id NULL and no usable customer was linked. This SECURITY DEFINER function does the lookup + insert server-side
-- and returns only the id.
--   * validates the branch belongs to the org and the org is active; trims and length-limits every input
--   * org-wide de-dupe: normalized phone (same rule as customers_org_nphone_uniq), then lower(email); returns the existing id
--   * NEVER updates an existing customer (no profile overwrite from anon)
--   * idempotent (CREATE OR REPLACE); EXECUTE for anon + authenticated only
--
-- Reversible: DROP FUNCTION IF EXISTS public.create_customer_for_booking(uuid, uuid, text, text, text, text);

BEGIN;

CREATE OR REPLACE FUNCTION public.create_customer_for_booking(
  p_org_id    uuid,
  p_branch_id uuid,
  p_full_name text,
  p_phone     text DEFAULT NULL,
  p_email     text DEFAULT NULL,
  p_gender    text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_name   text := left(btrim(coalesce(p_full_name, '')), 120);
  v_phone  text := left(NULLIF(btrim(coalesce(p_phone, '')), ''), 32);
  v_email  text := left(lower(NULLIF(btrim(coalesce(p_email, '')), '')), 254);
  v_gender text := left(NULLIF(btrim(coalesce(p_gender, '')), ''), 20);
  v_nphone text := NULLIF(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g'), '');
  v_id     uuid;
BEGIN
  IF v_name = '' THEN
    RAISE EXCEPTION 'customer name is required' USING ERRCODE = '22023';
  END IF;
  IF p_org_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'organization and branch are required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.branches b JOIN public.organizations o ON o.id = b.org_id
    WHERE b.id = p_branch_id AND b.org_id = p_org_id AND o.is_active IS NOT FALSE
  ) THEN
    RAISE EXCEPTION 'branch does not belong to an active organization' USING ERRCODE = '42501';
  END IF;

  -- Existing customer: phone first (same normalization as customers_org_nphone_uniq), then email.
  IF v_nphone IS NOT NULL THEN
    SELECT c.id INTO v_id FROM public.customers c
    WHERE c.org_id = p_org_id AND NULLIF(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), '') = v_nphone
    LIMIT 1;
  END IF;
  IF v_id IS NULL AND v_email IS NOT NULL THEN
    SELECT c.id INTO v_id FROM public.customers c
    WHERE c.org_id = p_org_id AND lower(c.email) = v_email
    LIMIT 1;
  END IF;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  BEGIN
    INSERT INTO public.customers (org_id, branch_id, full_name, phone, email, gender)
    VALUES (p_org_id, p_branch_id, v_name, v_phone, v_email, v_gender)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- lost a race against customers_org_nphone_uniq: return the winner
    SELECT c.id INTO v_id FROM public.customers c
    WHERE c.org_id = p_org_id AND NULLIF(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), '') = v_nphone
    LIMIT 1;
  END;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_customer_for_booking(uuid, uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_customer_for_booking(uuid, uuid, text, text, text, text) TO anon, authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('402', 'create-customer-for-booking')
ON CONFLICT (version) DO NOTHING;

COMMIT;
