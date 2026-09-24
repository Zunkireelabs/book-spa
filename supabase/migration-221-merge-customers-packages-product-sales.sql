-- Migration 221: repoint packages/product_sales during customer merge
--
-- merge_customers() (migration-133) repoints every table that referenced customers.id at
-- the time it was written, but packages (migration-141) and product_sales (migration-189)
-- were both added after 133 and were never added to its repoint list. Today, merging a
-- duplicate customer who has package purchases or product sales silently orphans those rows
-- instead of moving them to the canonical customer — the merge succeeds but the FK linkage
-- to the deleted duplicate is only preserved in customer_merge_log's jsonb snapshot, not in
-- the live packages/product_sales rows. This CREATE OR REPLACE adds both repoints; everything
-- else in the function body is unchanged from migration-133.

CREATE OR REPLACE FUNCTION public.merge_customers(p_canonical_id uuid, p_duplicate_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Managers are branch-scoped elsewhere in the app; a manager may only merge customers
  -- touching their own branch. Admin merges across any branch in their org.
  IF v_role = 'manager' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id IN (p_canonical_id, p_duplicate_id) AND c.branch_id = get_user_branch_id()
    ) THEN
      RAISE EXCEPTION 'merge_customers: manager may only merge customers touching their own branch';
    END IF;
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
$$;

REVOKE ALL ON FUNCTION public.merge_customers(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_customers(uuid, uuid) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('221', 'merge-customers-packages-product-sales')
ON CONFLICT (version) DO NOTHING;
