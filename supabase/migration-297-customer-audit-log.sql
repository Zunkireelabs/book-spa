-- Migration 297: write-side instrumentation for the customer-detail Log tab
--
-- CustomerLogTab.jsx has shipped as a deliberately-empty stub since it was
-- built, with a comment explaining why: no mutation path wrote to audit_logs
-- for customers. This migration closes that gap by reusing the existing
-- generic audit_logs table (migration-002) and its log_booking_changes()
-- trigger pattern, applied to the customers table instead of bookings.
--
-- Unlike log_booking_changes() (which hand-lists 3 specific fields), this
-- trigger diffs the whole row generically: to_jsonb(OLD) vs to_jsonb(NEW),
-- keeping only the keys that actually changed. This means every current and
-- future customers column (profile edits via updateCustomerContact/
-- updateCustomerProfileDetails, block/unblock via setCustomerActive's
-- is_active flip, coalesce-on-merge in merge_customers) is captured without
-- needing a matching code change here every time a new profile field ships.
-- DELETE is logged too, covering deleteCustomer's hard delete and the
-- duplicate-row delete inside merge_customers.
--
-- audit_logs already has the RLS it needs for this: "System can write audit
-- logs" (FOR INSERT, WITH CHECK true — belt-and-suspenders since this trigger
-- runs SECURITY DEFINER and bypasses RLS anyway) and three SELECT policies
-- scoping reads to manager/admin/admin_viewer within their own org via
-- branch_id -> branches.org_id. customers.branch_id is NOT NULL, so every
-- row this trigger inserts is readable under those existing policies with no
-- new policy needed.
--
-- merge_customers() (migration-264) is also re-applied here, unchanged
-- except for one added INSERT: a single explicit 'MERGE' audit_logs row on
-- the canonical customer naming which duplicate was merged in. Without it,
-- a merge only shows up as an anonymous-looking UPDATE (the coalesce) plus a
-- DELETE row attached to the now-gone duplicate's id — accurate but not
-- legible as "these two customers were merged" from the canonical record's
-- own Log tab.
--
-- Idempotent: CREATE OR REPLACE FUNCTION throughout; DROP TRIGGER IF EXISTS
-- before CREATE TRIGGER (triggers have no CREATE OR REPLACE).
-- Reversible:
--   DROP TRIGGER IF EXISTS trg_audit_customer_changes ON public.customers;
--   DROP FUNCTION IF EXISTS public.log_customer_changes();
--   -- then re-apply migration-264's merge_customers() body verbatim to drop
--   -- the added MERGE insert.

BEGIN;

CREATE OR REPLACE FUNCTION public.log_customer_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  old_j     jsonb;
  new_j     jsonb;
  old_diff  jsonb := '{}'::jsonb;
  new_diff  jsonb := '{}'::jsonb;
  k         text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    old_j := to_jsonb(OLD);
    new_j := to_jsonb(NEW);
    FOR k IN SELECT jsonb_object_keys(new_j) LOOP
      IF old_j->k IS DISTINCT FROM new_j->k THEN
        old_diff := old_diff || jsonb_build_object(k, old_j->k);
        new_diff := new_diff || jsonb_build_object(k, new_j->k);
      END IF;
    END LOOP;

    -- A no-op UPDATE (e.g. re-saving unchanged fields) writes nothing.
    IF old_diff = '{}'::jsonb THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.audit_logs (branch_id, table_name, record_id, action_type, old_data, new_data, changed_by)
    VALUES (NEW.branch_id, 'customers', NEW.id, 'UPDATE', old_diff, new_diff, auth.uid());
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_logs (branch_id, table_name, record_id, action_type, old_data, new_data, changed_by)
    VALUES (OLD.branch_id, 'customers', OLD.id, 'DELETE', to_jsonb(OLD), NULL, auth.uid());
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_customer_changes ON public.customers;
CREATE TRIGGER trg_audit_customer_changes
  AFTER UPDATE OR DELETE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.log_customer_changes();

-- merge_customers(): re-applied from migration-264 verbatim, plus one added
-- explicit MERGE audit_logs row (see header comment above for why).
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
  v_can_branch uuid;
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

  SELECT branch_id INTO v_can_branch FROM public.customers WHERE id = p_canonical_id;
  INSERT INTO public.audit_logs (branch_id, table_name, record_id, action_type, old_data, new_data, changed_by)
  VALUES (
    v_can_branch, 'customers', p_canonical_id, 'MERGE',
    NULL,
    jsonb_build_object('merged_customer_id', p_duplicate_id, 'merged_customer_name', v_dup_row->>'full_name', 'merged_customer_phone', v_dup_row->>'phone'),
    auth.uid()
  );

  DELETE FROM public.customers WHERE id = p_duplicate_id;

  IF EXISTS (SELECT 1 FROM public.customers WHERE id = p_duplicate_id) THEN
    RAISE EXCEPTION 'merge_customers: duplicate row % still present after delete', p_duplicate_id;
  END IF;
END;
$function$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('297', 'customer-audit-log')
ON CONFLICT (version) DO NOTHING;

COMMIT;
