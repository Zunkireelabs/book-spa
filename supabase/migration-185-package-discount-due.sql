-- Migration 185: package discount + due-balance tracking
--
-- Session packages (migration-141) only recorded paid_amount — no concept of
-- the package's actual price, any discount applied, or a due balance when
-- payment falls short. Adds base_amount/discount/final_amount columns and a
-- due_holder_name (same convention as bookings.due_holder_name) so staff can
-- discount a package and, if underpaid, attribute the remainder to a named
-- responsible person. See docs/superpowers/specs/2026-09-21-package-
-- discount-due-tracking-design.md for full design context.
--
-- Due is never stored as a column — always computed as final_amount -
-- paid_amount, same "derive, don't trust a stored due column" approach
-- bookings' amountDue already uses.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, explicit DROP FUNCTION before
-- CREATE OR REPLACE (Postgres treats an added parameter as a new overload,
-- not a replacement — the old 11-arg signature would otherwise linger as
-- dead code), ON CONFLICT DO NOTHING for the migration record.
--
-- Reversible (manual):
--   DROP FUNCTION IF EXISTS public.issue_package(uuid, uuid, uuid, uuid, text, text, date, date, numeric, int, text, text, numeric, text);
--   -- then restore migration-141's original issue_package definition
--   ALTER TABLE public.packages
--     DROP COLUMN IF EXISTS base_amount,
--     DROP COLUMN IF EXISTS discount_type,
--     DROP COLUMN IF EXISTS discount_value,
--     DROP COLUMN IF EXISTS discount_amount,
--     DROP COLUMN IF EXISTS final_amount,
--     DROP COLUMN IF EXISTS due_holder_name;

-- ============================================================
-- 1. SCHEMA
-- ============================================================

ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS base_amount      numeric(10,2),
  ADD COLUMN IF NOT EXISTS discount_type    text CHECK (discount_type IN ('percentage','fixed')),
  ADD COLUMN IF NOT EXISTS discount_value   numeric(10,2),
  ADD COLUMN IF NOT EXISTS discount_amount  numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_amount     numeric(10,2),
  ADD COLUMN IF NOT EXISTS due_holder_name  text;

-- ============================================================
-- 2. issue_package — extend with discount + due-holder params
-- ============================================================

DROP FUNCTION IF EXISTS public.issue_package(uuid, uuid, uuid, uuid, text, text, date, date, numeric, int, text);

CREATE OR REPLACE FUNCTION public.issue_package(
  p_org_id          uuid,
  p_branch_id       uuid,
  p_package_type_id uuid,
  p_customer_id     uuid    DEFAULT NULL,
  p_guest_name      text    DEFAULT NULL,
  p_guest_info      text    DEFAULT NULL,
  p_issued_date     date    DEFAULT NULL,
  p_expiry_date     date    DEFAULT NULL,
  p_paid_amount     numeric DEFAULT NULL,
  p_sessions_total  int     DEFAULT NULL,
  p_remarks         text    DEFAULT NULL,
  p_discount_type   text    DEFAULT NULL,
  p_discount_value  numeric DEFAULT NULL,
  p_due_holder_name text    DEFAULT NULL
)
RETURNS public.packages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role            user_role := get_user_role();
  v_org             uuid      := get_user_org_id();
  v_branch_org      uuid;
  v_customer_org    uuid;
  v_type            record;
  v_issued          date := COALESCE(p_issued_date, (now() AT TIME ZONE 'Asia/Kathmandu')::date);
  v_expiry          date;
  v_base_amount     numeric(10,2);
  v_discount_amount numeric(10,2) := 0;
  v_final_amount    numeric(10,2);
  v_row             public.packages;
BEGIN
  IF v_role NOT IN ('manager','admin') THEN
    RAISE EXCEPTION 'issue_package: manager or admin role required';
  END IF;

  IF p_org_id IS NULL OR p_org_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'issue_package: org_id does not match your organization';
  END IF;

  IF p_customer_id IS NULL AND (p_guest_name IS NULL OR length(btrim(p_guest_name)) = 0) THEN
    RAISE EXCEPTION 'issue_package: either customer_id or guest_name is required';
  END IF;

  SELECT org_id INTO v_branch_org FROM public.branches WHERE id = p_branch_id;
  IF v_branch_org IS NULL OR v_branch_org IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'issue_package: branch is not in your organization';
  END IF;

  IF p_customer_id IS NOT NULL THEN
    SELECT org_id INTO v_customer_org FROM public.customers WHERE id = p_customer_id;
    IF v_customer_org IS NULL OR v_customer_org IS DISTINCT FROM v_org THEN
      RAISE EXCEPTION 'issue_package: customer is not in your organization';
    END IF;
  END IF;

  SELECT * INTO v_type FROM public.package_types
  WHERE id = p_package_type_id AND org_id = v_org;
  IF v_type IS NULL THEN
    RAISE EXCEPTION 'issue_package: package type not found in your organization';
  END IF;

  v_expiry := COALESCE(p_expiry_date, v_issued + make_interval(days => v_type.validity_days));

  IF v_expiry < v_issued THEN
    RAISE EXCEPTION 'issue_package: expiry_date cannot be before issued_date';
  END IF;

  IF p_paid_amount IS NULL OR p_paid_amount < 0 THEN
    RAISE EXCEPTION 'issue_package: paid_amount must be zero or greater';
  END IF;

  IF COALESCE(p_sessions_total, v_type.default_sessions) IS NULL
     OR COALESCE(p_sessions_total, v_type.default_sessions) <= 0 THEN
    RAISE EXCEPTION 'issue_package: sessions_total must be greater than zero';
  END IF;

  -- Discount + due-balance: the type's price is fixed (base_amount), staff
  -- can discount it (percentage or a flat NPR amount), and if paid_amount
  -- falls short of the discounted total, a responsible person is required —
  -- mirrors migration-177's v_due_holder IS NULL guard for bookings. A type
  -- with no standard_price (e.g. a legacy seed row) skips all of this —
  -- base_amount/final_amount stay NULL, meaning "not tracked", not "settled".
  v_base_amount := v_type.standard_price;

  IF v_base_amount IS NOT NULL THEN
    IF p_discount_type IS NOT NULL THEN
      IF p_discount_type NOT IN ('percentage','fixed') THEN
        RAISE EXCEPTION 'issue_package: discount_type must be percentage or fixed';
      END IF;
      IF p_discount_type = 'percentage' THEN
        v_discount_amount := round(v_base_amount * LEAST(GREATEST(COALESCE(p_discount_value, 0), 0), 100) / 100, 2);
      ELSE
        v_discount_amount := LEAST(GREATEST(COALESCE(p_discount_value, 0), 0), v_base_amount);
      END IF;
    END IF;

    v_final_amount := v_base_amount - v_discount_amount;

    IF p_paid_amount > v_final_amount THEN
      RAISE EXCEPTION 'issue_package: paid_amount cannot exceed the discounted total';
    END IF;

    IF p_paid_amount < v_final_amount AND btrim(COALESCE(p_due_holder_name, '')) = '' THEN
      RAISE EXCEPTION 'issue_package: a responsible person name is required when paid_amount is less than the total due';
    END IF;
  END IF;

  INSERT INTO public.packages (
    org_id, branch_id, package_type_id, service_id, customer_id, guest_name,
    guest_info, issued_date, expiry_date, paid_amount, sessions_total, remarks,
    issued_by, base_amount, discount_type, discount_value, discount_amount,
    final_amount, due_holder_name
  )
  VALUES (
    v_org, p_branch_id, p_package_type_id, v_type.service_id, p_customer_id,
    btrim(p_guest_name), p_guest_info, v_issued, v_expiry, p_paid_amount,
    COALESCE(p_sessions_total, v_type.default_sessions), p_remarks, auth.uid(),
    v_base_amount, p_discount_type, p_discount_value, v_discount_amount,
    v_final_amount, NULLIF(btrim(COALESCE(p_due_holder_name, '')), '')
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_package(uuid, uuid, uuid, uuid, text, text, date, date, numeric, int, text, text, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_package(uuid, uuid, uuid, uuid, text, text, date, date, numeric, int, text, text, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.issue_package(uuid, uuid, uuid, uuid, text, text, date, date, numeric, int, text, text, numeric, text) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('185', 'package-discount-due')
ON CONFLICT (version) DO NOTHING;
