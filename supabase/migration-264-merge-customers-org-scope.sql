-- Migration 264: merge_customers() — drop the manager branch restriction (additive,
-- REVERSIBLE)
--
-- Context: the CRM "Customers" tab was fixed to be org-wide in
-- fix/customer-intelligence-org-scope (getCustomerIntelligence, PR #390) — a
-- customer who first visited a different branch of the same org is no longer
-- invisible. "Potential Duplicates" (customer_duplicate_candidates, migration-133)
-- was already org-scoped at the query level, and "Manual Merge" search
-- (fetchCustomersLightweight) was fixed the same way in this branch's prior
-- commit. merge_customers() itself still hard-blocked a manager from merging two
-- customers unless at least one touched their own branch — org-scoped search can
-- now surface a duplicate pair neither of which touches the manager's branch, and
-- merging it would still raise 'manager may only merge customers touching their
-- own branch', a dead end with no path forward for a legitimate org-wide
-- duplicate-cleanup task.
--
-- Fix: CREATE OR REPLACE the function exactly as currently live (verified via
-- `select pg_get_functiondef(oid) from pg_proc where proname='merge_customers'`
-- against staging), with only the `IF v_role = 'manager' THEN ... END IF;`
-- branch-restriction block removed. The role gate (manager/admin only) and both
-- org-match checks (v_org_can <> v_org_dup, v_org_can <> get_user_org_id()) are
-- untouched — org_id stays the authorization boundary, branch_id stays provenance
-- metadata only, consistent with the rest of this cleanup.
--
-- Idempotent: CREATE OR REPLACE FUNCTION, same signature.
--
-- Reversible: re-add the removed block (see migration-221's original definition)
-- via another CREATE OR REPLACE FUNCTION public.merge_customers(...).

CREATE OR REPLACE FUNCTION public.merge_customers(p_canonical_id uuid, p_duplicate_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role       user_role;
  v_org_can    uuid;
  v_org_dup    uuid;
  v_dup_row    jsonb;
  v_nphone     text;
BEGIN
  IF p_canonical_id = p_duplicate_id THEN
    RAISE EXCEPTION 'merge_customers: canonical and duplicate are the same customer';
  END IF;

  v_role := get_user_role();
  IF v_role NOT IN ('manager', 'admin') THEN
    RAISE EXCEPTION 'merge_customers: requires manager or admin role';
  END IF;

  SELECT org_id INTO v_org_can FROM public.customers WHERE id = p_canonical_id;
  SELECT org_id INTO v_org_dup FROM public.customers WHERE id = p_duplicate_id;

  IF v_org_can IS NULL OR v_org_dup IS NULL THEN
    RAISE EXCEPTION 'merge_customers: canonical or duplicate customer not found';
  END IF;
  IF v_org_can <> v_org_dup THEN
    RAISE EXCEPTION 'merge_customers: canonical and duplicate belong to different orgs';
  END IF;
  IF v_org_can <> get_user_org_id() THEN
    RAISE EXCEPTION 'merge_customers: not authorized for this organization';
  END IF;

  SELECT to_jsonb(c) INTO v_dup_row FROM public.customers c WHERE c.id = p_duplicate_id;
  v_nphone := public.normalize_phone_e164((v_dup_row->>'phone'));

  -- Repoint every table that references customers.id. Order doesn't matter for FK
  -- validity (none of these reference each other), but outreach_messages is CASCADE —
  -- it MUST be repointed before the delete below, or its rows for the duplicate would be
  -- silently deleted instead of preserved.
  UPDATE public.bookings SET customer_id = p_canonical_id WHERE customer_id = p_duplicate_id;
  UPDATE public.customer_accounts SET customer_id = p_canonical_id WHERE customer_id = p_duplicate_id;
  UPDATE public.customer_referral_credits SET customer_id = p_canonical_id WHERE customer_id = p_duplicate_id;
  UPDATE public.customer_referral_debits SET customer_id = p_canonical_id WHERE customer_id = p_duplicate_id;
  UPDATE public.customer_referrals SET referring_customer_id = p_canonical_id WHERE referring_customer_id = p_duplicate_id;
  UPDATE public.customer_referrals SET referred_customer_id = p_canonical_id WHERE referred_customer_id = p_duplicate_id;
  UPDATE public.memberships SET customer_id = p_canonical_id WHERE customer_id = p_duplicate_id;
  UPDATE public.outreach_messages SET customer_id = p_canonical_id WHERE customer_id = p_duplicate_id;
  UPDATE public.vouchers SET customer_id = p_canonical_id WHERE customer_id = p_duplicate_id;
  UPDATE public.packages SET customer_id = p_canonical_id WHERE customer_id = p_duplicate_id;
  UPDATE public.product_sales SET customer_id = p_canonical_id WHERE customer_id = p_duplicate_id;

  -- Coalesce nullable fields onto the canonical row (extends migration-035's
  -- email/notes coalesce with gender and date_of_birth, which didn't exist in April).
  UPDATE public.customers can
     SET email         = COALESCE(can.email, dup.email),
         notes         = COALESCE(can.notes, dup.notes),
         gender        = COALESCE(can.gender, dup.gender),
         date_of_birth = COALESCE(can.date_of_birth, dup.date_of_birth)
    FROM public.customers dup
   WHERE can.id = p_canonical_id AND dup.id = p_duplicate_id;

  -- Snapshot before delete.
  INSERT INTO public.customer_merge_log (merged_id, canonical_id, org_id, nphone, merged_row)
  VALUES (p_duplicate_id, p_canonical_id, v_org_dup, v_nphone, v_dup_row);

  DELETE FROM public.customers WHERE id = p_duplicate_id;

  IF EXISTS (SELECT 1 FROM public.customers WHERE id = p_duplicate_id) THEN
    RAISE EXCEPTION 'merge_customers: duplicate row % still present after delete', p_duplicate_id;
  END IF;
END;
$function$;

-- Record migration ---------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('264', 'merge-customers-org-scope')
ON CONFLICT (version) DO NOTHING;
