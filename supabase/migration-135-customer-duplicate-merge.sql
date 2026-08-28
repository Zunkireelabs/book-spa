-- Migration 135: duplicate-customer review — dismissals table, candidate view, merge RPC
--
-- Production has 171 phone-normalization collision groups (342 of 1506 nuad-thai-spa
-- customers) discovered while validating migration-133's pre-flight guard. Unlike
-- migration-034/035 (one-off dry-run + destructive migration, bookings-only repoint),
-- these merges must be human-triggered one pair at a time via a review UI — no migration
-- merges anything here. This migration only ships the building blocks:
--   1. customer_duplicate_dismissals — persists "not a duplicate" decisions so dismissed
--      pairs stop resurfacing.
--   2. customer_duplicate_candidates(p_org_id) — dynamically finds current
--      phone-collision pairs for an org (not a static snapshot), excluding dismissed pairs.
--   3. merge_customers(p_canonical_id, p_duplicate_id) — SECURITY DEFINER RPC doing the
--      real FK repoint + coalesce + delete + audit-log, extending migration-035's pattern
--      to every table that now references customers.id (bookings, customer_accounts,
--      customer_referral_credits/debits, customer_referrals x2, memberships,
--      outreach_messages, vouchers) — 035 only handled bookings, which was correct when it
--      was written but is stale now.
--
-- Role-gated to manager/admin inside the function body (checked via get_user_role()),
-- same as this repo's other SECURITY DEFINER RPCs. Wrapped so any constraint violation
-- (e.g. two active memberships, both sides already referred) rolls back the whole merge
-- rather than partially repointing — fail loud, never corrupt.

-- 1. Dismissals ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_duplicate_dismissals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_id_a    uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  customer_id_b    uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  dismissed_by     uuid REFERENCES public.users(id),
  dismissed_at     timestamptz NOT NULL DEFAULT now(),
  -- Store the pair in a canonical (least, greatest) order so a dismissal is
  -- found regardless of which id the candidate query happens to list first.
  customer_id_lo   uuid GENERATED ALWAYS AS (LEAST(customer_id_a, customer_id_b)) STORED,
  customer_id_hi   uuid GENERATED ALWAYS AS (GREATEST(customer_id_a, customer_id_b)) STORED,
  UNIQUE (org_id, customer_id_lo, customer_id_hi)
);

ALTER TABLE public.customer_duplicate_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Manager/admin can read own org dismissals"
  ON public.customer_duplicate_dismissals FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id() AND get_user_role() IN ('manager', 'admin'));

CREATE POLICY "Manager/admin can dismiss within own org"
  ON public.customer_duplicate_dismissals FOR INSERT
  TO authenticated
  WITH CHECK (org_id = get_user_org_id() AND get_user_role() IN ('manager', 'admin'));

-- 2. Dynamic duplicate-candidate query ----------------------------------------
-- Branch-scoping note: customers.branch_id is a "home branch" and duplicates can span
-- branches (a customer visiting two branches under one org), so this is org-scoped, not
-- branch-scoped. The UI itself applies branch-visibility (manager sees pairs touching
-- their branch, admin sees all) when calling this.
CREATE OR REPLACE FUNCTION public.customer_duplicate_candidates(p_org_id uuid)
RETURNS TABLE (
  customer_id_a uuid,
  customer_id_b uuid,
  nphone        text,
  name_a        text,
  name_b        text,
  phone_a       text,
  phone_b       text,
  email_a       text,
  email_b       text,
  branch_id_a   uuid,
  branch_id_b   uuid,
  created_at_a  timestamptz,
  created_at_b  timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_org_id <> get_user_org_id() THEN
    RAISE EXCEPTION 'customer_duplicate_candidates: not authorized for this organization';
  END IF;
  IF get_user_role() NOT IN ('manager', 'admin') THEN
    RAISE EXCEPTION 'customer_duplicate_candidates: requires manager or admin role';
  END IF;

  -- Column aliases below are prefixed (v_nphone, not nphone) to avoid ambiguity against
  -- this function's own RETURNS TABLE column of the same name, which plpgsql exposes as an
  -- implicit variable in scope for the whole function body.
  RETURN QUERY
  WITH norm AS (
    SELECT c.id, c.org_id, c.full_name, c.phone, c.email, c.branch_id, c.created_at,
           public.normalize_phone_e164(c.phone) AS v_nphone
    FROM public.customers c
    WHERE c.org_id = p_org_id
  ),
  grp AS (
    SELECT v_nphone, array_agg(id ORDER BY created_at, id) AS ids
    FROM norm
    WHERE v_nphone IS NOT NULL
    GROUP BY v_nphone
    HAVING count(*) > 1
  ),
  pairs AS (
    -- All groups found so far are exact pairs (verified against production), but generate
    -- every combination within a group so a future 3+ group doesn't get silently dropped.
    SELECT g.v_nphone, a.id AS id_a, b.id AS id_b
    FROM grp g,
         LATERAL unnest(g.ids) WITH ORDINALITY AS a(id, ord_a),
         LATERAL unnest(g.ids) WITH ORDINALITY AS b(id, ord_b)
    WHERE a.ord_a < b.ord_b
  )
  SELECT p.id_a, p.id_b, p.v_nphone,
         na.full_name, nb.full_name,
         na.phone, nb.phone,
         na.email, nb.email,
         na.branch_id, nb.branch_id,
         na.created_at, nb.created_at
  FROM pairs p
  JOIN norm na ON na.id = p.id_a
  JOIN norm nb ON nb.id = p.id_b
  WHERE NOT EXISTS (
    SELECT 1 FROM public.customer_duplicate_dismissals d
    WHERE d.org_id = p_org_id
      AND d.customer_id_lo = LEAST(p.id_a, p.id_b)
      AND d.customer_id_hi = GREATEST(p.id_a, p.id_b)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.customer_duplicate_candidates(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_duplicate_candidates(uuid) TO authenticated;

-- 3. merge_customers RPC -------------------------------------------------------
-- Unlike migration-035 (fixed oldest-wins), the caller designates the canonical row —
-- a manager reviewing two records side-by-side may have better judgment than a fixed rule
-- (e.g. the newer row has the correct spelling of a name).
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

-- 4. Record migration -----------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('135', 'customer-duplicate-merge')
ON CONFLICT (version) DO NOTHING;
