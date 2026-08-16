-- ============================================================
-- Migration 069: Let staff issue vouchers
-- ============================================================
--
-- migration-066-vouchers.sql shipped vouchers as manager/admin only, end to
-- end, per a product decision at the time ("vouchers are not part of the
-- staff workflow for now"). That's changed — staff now need to be able to
-- issue a new voucher from their own dashboard.
--
-- Two changes, both idempotent:
--   1. issue_voucher(): allow the 'staff' role (identical body otherwise —
--      branch_id and issued_by are unaffected, they already come from the
--      caller's branch context / auth.uid()).
--   2. voucher_types SELECT policy: let staff read the active type catalog,
--      needed to populate the "New voucher" form's type dropdown.
--
-- Deliberately NOT changed: vouchers/voucher_claims SELECT policies stay
-- manager/admin-only (staff get a create action, not a voucher list), and
-- claim_voucher() stays manager/admin-only (redemption is out of scope here).
--
-- Safe to run multiple times.
-- ============================================================

-- ---- 1. voucher_types: add staff to the read policy -------------------------

DROP POLICY IF EXISTS "Manager/admin can read voucher types" ON public.voucher_types;
DROP POLICY IF EXISTS "Staff/manager/admin can read voucher types" ON public.voucher_types;
CREATE POLICY "Staff/manager/admin can read voucher types"
  ON public.voucher_types FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id() AND get_user_role() IN ('staff','manager','admin','admin_viewer'));

-- ---- 2. issue_voucher(): allow staff -----------------------------------------

CREATE OR REPLACE FUNCTION public.issue_voucher(
  p_branch_id        uuid,
  p_voucher_type_id  uuid,
  p_guest_name       text,
  p_guest_info       text    DEFAULT NULL,
  p_discount_percent numeric DEFAULT 0,
  p_actual_price     numeric DEFAULT NULL,
  p_issued_date      date    DEFAULT NULL,
  p_expiry_date      date    DEFAULT NULL,
  p_remarks          text    DEFAULT NULL
)
RETURNS public.vouchers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role         user_role := get_user_role();
  v_org          uuid      := get_user_org_id();
  v_branch_org   uuid;
  v_type         record;
  v_seq          int;
  v_code         text;
  v_actual_price numeric(10,2);
  v_issued       date := COALESCE(p_issued_date, (now() AT TIME ZONE 'Asia/Kathmandu')::date);
  v_expiry       date := COALESCE(p_expiry_date, v_issued + interval '90 days');
  v_row          public.vouchers;
BEGIN
  IF v_role NOT IN ('staff','manager','admin') THEN
    RAISE EXCEPTION 'issue_voucher: staff, manager, or admin role required';
  END IF;

  IF p_guest_name IS NULL OR length(btrim(p_guest_name)) = 0 THEN
    RAISE EXCEPTION 'issue_voucher: guest name is required';
  END IF;

  SELECT org_id INTO v_branch_org FROM public.branches WHERE id = p_branch_id;
  IF v_branch_org IS NULL OR v_branch_org IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'issue_voucher: branch is not in your organization';
  END IF;

  SELECT * INTO v_type FROM public.voucher_types
  WHERE id = p_voucher_type_id AND org_id = v_org;
  IF v_type IS NULL THEN
    RAISE EXCEPTION 'issue_voucher: voucher type not found in your organization';
  END IF;

  IF p_discount_percent IS NULL OR p_discount_percent < 0 OR p_discount_percent > 100 THEN
    RAISE EXCEPTION 'issue_voucher: discount_percent must be between 0 and 100';
  END IF;

  IF v_expiry < v_issued THEN
    RAISE EXCEPTION 'issue_voucher: expiry_date cannot be before issued_date';
  END IF;

  v_actual_price := COALESCE(p_actual_price, v_type.standard_price);

  -- Atomically claim the next sequence number for this (branch, type).
  INSERT INTO public.voucher_code_counters (org_id, branch_id, voucher_type_id, next_number)
  VALUES (v_org, p_branch_id, p_voucher_type_id, 2)
  ON CONFLICT (branch_id, voucher_type_id)
    DO UPDATE SET next_number = public.voucher_code_counters.next_number + 1
  RETURNING next_number - 1 INTO v_seq;

  v_code := v_type.code_prefix || '-' || lpad(v_seq::text, 4, '0');

  INSERT INTO public.vouchers (
    org_id, branch_id, voucher_type_id, voucher_code, issued_date, expiry_date,
    guest_name, guest_info, actual_price, discount_percent, total_amount_issued,
    remarks, issued_by
  )
  VALUES (
    v_org, p_branch_id, p_voucher_type_id, v_code, v_issued, v_expiry,
    btrim(p_guest_name), p_guest_info, v_actual_price, p_discount_percent,
    round(v_actual_price - (v_actual_price * p_discount_percent / 100), 2),
    p_remarks, auth.uid()
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_voucher(uuid, uuid, text, text, numeric, numeric, date, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_voucher(uuid, uuid, text, text, numeric, numeric, date, date, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.issue_voucher(uuid, uuid, text, text, numeric, numeric, date, date, text) TO authenticated;

-- ============================================================
-- MIGRATION 069 COMPLETE
-- ============================================================
