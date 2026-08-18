-- Migration 089: fix voucher code collision across sibling voucher types
-- (REVERSIBLE)
--
-- Bug: voucher_code_counters is keyed per (branch_id, voucher_type_id), but
-- the generated code text only depends on code_prefix ("NT 4326-0001"), not
-- on which voucher_type_id produced it. Several voucher_types share the same
-- code_prefix on purpose (migration-072's seed: "Full Body Oil Massage-60/90/
-- 120 Min" are all "NT 4326" -- one shared numbering block, matching the
-- legacy Excel sheet). Because each type's counter starts its own sequence
-- at 1, the first "90 Min" voucher issued after any "60 Min" vouchers already
-- exist collides with an already-used code and issue_voucher() fails with
-- `duplicate key value violates unique constraint "vouchers_org_code_uniq"`.
--
-- Fix: key voucher_code_counters by (branch_id, code_prefix) instead of
-- voucher_type_id, so every voucher_type sharing a prefix draws from one
-- shared sequence -- matching what the code text (and the legacy numbering
-- it replaces) actually needs. Existing counters are discarded and rebuilt
-- from the ground truth (the max sequence number already present in
-- vouchers.voucher_code per branch+prefix), since the old counters are
-- exactly the source of the bug and can't be trusted.
--
-- Idempotent: guarded ALTER TABLE, CREATE OR REPLACE FUNCTION,
-- ON CONFLICT DO NOTHING backfill.
-- Portable: no hardcoded UUIDs.
--
-- Reversible (manual):
--   ALTER TABLE public.voucher_code_counters DROP CONSTRAINT IF EXISTS voucher_code_counters_pkey;
--   ALTER TABLE public.voucher_code_counters ADD COLUMN IF NOT EXISTS voucher_type_id uuid REFERENCES public.voucher_types(id) ON DELETE CASCADE;
--   -- (voucher_type_id would need re-backfilling per row -- ambiguous once
--   -- collapsed by prefix, so this rollback is lossy by design)
--   ALTER TABLE public.voucher_code_counters DROP COLUMN IF EXISTS code_prefix;
--   -- then re-run migration-082's CREATE OR REPLACE FUNCTION issue_voucher(...)
--   -- block to restore the voucher_type_id-keyed INSERT.

BEGIN;

-- ============================================================
-- 1. Rebuild voucher_code_counters keyed by (branch_id, code_prefix)
-- ============================================================

ALTER TABLE public.voucher_code_counters ADD COLUMN IF NOT EXISTS code_prefix text;

ALTER TABLE public.voucher_code_counters DROP CONSTRAINT IF EXISTS voucher_code_counters_pkey;
ALTER TABLE public.voucher_code_counters DROP COLUMN IF EXISTS voucher_type_id;

-- Ground-truth rebuild: one row per (branch, code_prefix) already issued,
-- next_number = 1 + the highest sequence number actually used in
-- vouchers.voucher_code (never trust the old per-type counters here, since
-- they're what produced the collision).
TRUNCATE public.voucher_code_counters;

INSERT INTO public.voucher_code_counters (org_id, branch_id, code_prefix, next_number)
SELECT
  v.org_id,
  v.branch_id,
  vt.code_prefix,
  COALESCE(MAX((regexp_match(v.voucher_code, '-(\d+)$'))[1]::int), 0) + 1
FROM public.vouchers v
JOIN public.voucher_types vt ON vt.id = v.voucher_type_id
GROUP BY v.org_id, v.branch_id, vt.code_prefix;

ALTER TABLE public.voucher_code_counters ALTER COLUMN code_prefix SET NOT NULL;
ALTER TABLE public.voucher_code_counters ADD PRIMARY KEY (branch_id, code_prefix);

-- ============================================================
-- 2. issue_voucher(): counter keyed by code_prefix, not voucher_type_id
-- ============================================================

CREATE OR REPLACE FUNCTION public.issue_voucher(
  p_branch_id uuid,
  p_voucher_type_id uuid,
  p_guest_name text,
  p_guest_info text DEFAULT NULL,
  p_discount_percent numeric DEFAULT 0,
  p_actual_price numeric DEFAULT NULL,
  p_issued_date date DEFAULT NULL,
  p_expiry_date date DEFAULT NULL,
  p_remarks text DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL
)
RETURNS public.vouchers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role         user_role := get_user_role();
  v_org          uuid      := get_user_org_id();
  v_branch_org   uuid;
  v_customer_org uuid;
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

  IF p_customer_id IS NOT NULL THEN
    SELECT org_id INTO v_customer_org FROM public.customers WHERE id = p_customer_id;
    IF v_customer_org IS NULL OR v_customer_org IS DISTINCT FROM v_org THEN
      RAISE EXCEPTION 'issue_voucher: customer is not in your organization';
    END IF;
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

  -- Keyed by code_prefix (not voucher_type_id): sibling types that share a
  -- prefix (e.g. the three "Full Body Oil Massage" durations, all "NT 4326")
  -- draw from one shared sequence, matching what the code text depends on.
  INSERT INTO public.voucher_code_counters (org_id, branch_id, code_prefix, next_number)
  VALUES (v_org, p_branch_id, v_type.code_prefix, 2)
  ON CONFLICT (branch_id, code_prefix)
    DO UPDATE SET next_number = public.voucher_code_counters.next_number + 1
  RETURNING next_number - 1 INTO v_seq;

  v_code := v_type.code_prefix || '-' || lpad(v_seq::text, 4, '0');

  INSERT INTO public.vouchers (
    org_id, branch_id, voucher_type_id, voucher_code, issued_date, expiry_date,
    guest_name, guest_info, actual_price, discount_percent, total_amount_issued,
    remarks, issued_by, customer_id
  )
  VALUES (
    v_org, p_branch_id, p_voucher_type_id, v_code, v_issued, v_expiry,
    btrim(p_guest_name), p_guest_info, v_actual_price, p_discount_percent,
    round(v_actual_price - (v_actual_price * p_discount_percent / 100), 2),
    p_remarks, auth.uid(), p_customer_id
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.issue_voucher(uuid, uuid, text, text, numeric, numeric, date, date, text, uuid) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('089', 'fix-voucher-code-counter-collision')
ON CONFLICT (version) DO NOTHING;

COMMIT;
