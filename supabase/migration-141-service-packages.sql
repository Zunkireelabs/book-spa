-- Migration 141: service packages (prepaid session bundles)
--
-- Replaces the manually-maintained "Annual Package Details" / "Membership
-- Details" Excel workbooks. Nuad Thai Spa sold 28 "annual packages" — each a
-- prepaid bundle of N sessions of ONE specific service (e.g. "8 sessions of
-- 90 min Oil Massage"). Structurally mirrors migration-072 (vouchers):
-- catalog table -> issued-instance table -> append-only ledger -> balance
-- view -> two SECURITY DEFINER RPCs -- but binds each package to exactly one
-- service (unlike vouchers, which redeem against any free-text service) and
-- tracks *sessions*, not a monetary balance.
--
--   package_types        — org-scoped catalog, bound to a single service_id.
--   packages              — one row per sold package (was "Annual Package
--                            Details" / "Membership Details" sheets).
--   package_redemptions   — append-only ledger, one row per session used.
--                            No amount column -- each row simply means
--                            "1 session used".
--   package_balances (view) — sessions_used / sessions_remaining / status,
--                            computed from package_redemptions (not stored).
--
-- Writes go through SECURITY DEFINER functions (issue_package,
-- redeem_package_session) -- there are NO direct INSERT/UPDATE/DELETE
-- policies on packages/package_redemptions. Mirrors the vouchers pattern.
--
-- Read access is wider than vouchers: staff can read (in addition to
-- manager/admin) because redeeming a session is a staff-facing action, and
-- redeem_package_session() itself allows the 'staff' role (the deliberate
-- divergence from claim_voucher's manager/admin-only gate).
--
-- Idempotent: CREATE ... IF NOT EXISTS, DROP POLICY IF EXISTS,
-- CREATE OR REPLACE FUNCTION, ON CONFLICT DO NOTHING for the migration record.
--
-- Reversible (manual):
--   DROP FUNCTION IF EXISTS public.redeem_package_session(uuid, uuid, uuid, text, text);
--   DROP FUNCTION IF EXISTS public.issue_package(uuid, uuid, uuid, uuid, text, text, date, date, numeric, int, text);
--   DROP VIEW     IF EXISTS public.package_balances;
--   DROP TABLE    IF EXISTS public.package_redemptions;
--   DROP TABLE    IF EXISTS public.packages;
--   DROP TABLE    IF EXISTS public.package_types;

-- ============================================================
-- 1. TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.package_types (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  service_id       uuid          REFERENCES public.services(id),
  name             text          NOT NULL,
  default_sessions int,
  standard_price   numeric(10,2),
  validity_days    int           NOT NULL DEFAULT 365,
  is_active        boolean       NOT NULL DEFAULT true,
  display_order    int,
  created_at       timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_package_types_org     ON public.package_types(org_id);
CREATE INDEX IF NOT EXISTS idx_package_types_service ON public.package_types(service_id);

CREATE TABLE IF NOT EXISTS public.packages (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id        uuid          NOT NULL REFERENCES public.branches(id),
  package_type_id  uuid          NOT NULL REFERENCES public.package_types(id),
  service_id       uuid          REFERENCES public.services(id),
  customer_id      uuid          REFERENCES public.customers(id),
  guest_name       text,
  guest_info       text,
  issued_date      date          NOT NULL,
  expiry_date      date          NOT NULL,
  paid_amount      numeric(10,2) NOT NULL CHECK (paid_amount >= 0),
  sessions_total   int           NOT NULL CHECK (sessions_total > 0),
  package_code     text,
  remarks          text,
  issued_by        uuid          REFERENCES public.users(id),
  created_at       timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT packages_expiry_after_issue CHECK (expiry_date >= issued_date)
);

CREATE INDEX IF NOT EXISTS idx_packages_org         ON public.packages(org_id);
CREATE INDEX IF NOT EXISTS idx_packages_branch       ON public.packages(branch_id);
CREATE INDEX IF NOT EXISTS idx_packages_customer     ON public.packages(customer_id);
CREATE INDEX IF NOT EXISTS idx_packages_guest_name   ON public.packages(org_id, guest_name);
CREATE INDEX IF NOT EXISTS idx_packages_type         ON public.packages(package_type_id);
CREATE INDEX IF NOT EXISTS idx_packages_service      ON public.packages(service_id);

CREATE TABLE IF NOT EXISTS public.package_redemptions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id          uuid        NOT NULL REFERENCES public.packages(id),
  org_id              uuid        NOT NULL REFERENCES public.organizations(id),
  redeemed_date       date        NOT NULL DEFAULT current_date,
  branch_id           uuid        REFERENCES public.branches(id),
  booking_id          uuid        REFERENCES public.bookings(id),
  guest_name_used_by  text,
  notes               text,
  performed_by        uuid        REFERENCES public.users(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_package_redemptions_package
  ON public.package_redemptions(package_id, redeemed_date DESC);

CREATE INDEX IF NOT EXISTS idx_package_redemptions_branch
  ON public.package_redemptions(branch_id);

-- ============================================================
-- 2. BALANCE VIEW (computed, not stored)
-- ============================================================

CREATE OR REPLACE VIEW public.package_balances WITH (security_invoker = true) AS
SELECT
  p.id                    AS package_id,
  p.org_id,
  p.branch_id,
  p.package_type_id,
  p.service_id,
  p.customer_id,
  p.guest_name,
  p.guest_info,
  p.expiry_date,
  p.sessions_total,
  COALESCE(r.sessions_used, 0)                              AS sessions_used,
  p.sessions_total - COALESCE(r.sessions_used, 0)            AS sessions_remaining,
  CASE
    WHEN p.expiry_date < current_date
      AND p.sessions_total - COALESCE(r.sessions_used, 0) > 0 THEN 'expired'
    WHEN COALESCE(r.sessions_used, 0) = 0 THEN 'unused'
    WHEN p.sessions_total - COALESCE(r.sessions_used, 0) <= 0 THEN 'fully_redeemed'
    ELSE 'partially_used'
  END                                                        AS status,
  r.last_redeemed_date
FROM public.packages p
LEFT JOIN (
  SELECT package_id,
         COUNT(*)            AS sessions_used,
         MAX(redeemed_date)  AS last_redeemed_date
  FROM public.package_redemptions
  GROUP BY package_id
) r ON r.package_id = p.id;

-- ============================================================
-- 3. RLS
-- ============================================================

ALTER TABLE public.package_types       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.packages            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_redemptions ENABLE ROW LEVEL SECURITY;

-- Staff/manager/admin can read package types in their org (wider than
-- vouchers -- redemption is a staff action, so staff need to see the catalog).
DROP POLICY IF EXISTS "Staff can read package types" ON public.package_types;
CREATE POLICY "Staff can read package types"
  ON public.package_types FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id() AND get_user_role() IN ('staff','manager','admin','admin_viewer'));

-- No direct write policy on package_types -- managed via dashboard SQL for
-- now (same posture as voucher_types), except admin gets a direct-manage
-- policy mirroring migration-072's "Admin can manage voucher types".
DROP POLICY IF EXISTS "Admin can manage package types" ON public.package_types;
CREATE POLICY "Admin can manage package types"
  ON public.package_types FOR ALL
  TO authenticated
  USING (get_user_role() = 'admin' AND org_id = get_user_org_id())
  WITH CHECK (get_user_role() = 'admin' AND org_id = get_user_org_id());

DROP POLICY IF EXISTS "Staff can read own org packages" ON public.packages;
CREATE POLICY "Staff can read own org packages"
  ON public.packages FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id() AND get_user_role() IN ('staff','manager','admin','admin_viewer'));

-- NO direct INSERT/UPDATE/DELETE policy -- writes go through issue_package().

DROP POLICY IF EXISTS "Staff can read own org package redemptions" ON public.package_redemptions;
CREATE POLICY "Staff can read own org package redemptions"
  ON public.package_redemptions FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id() AND get_user_role() IN ('staff','manager','admin','admin_viewer'));

-- NO direct INSERT/UPDATE/DELETE policy -- ledger is append-only via
-- redeem_package_session().

-- ============================================================
-- 4. SECURITY DEFINER WRITE FUNCTIONS
-- ============================================================

-- ---- issue_package ----------------------------------------------------------
-- Mirrors issue_voucher: validates branch/org scoping and role, inserts the
-- packages row. Manager/admin only (issuing a prepaid package is a
-- higher-trust action than redeeming a session against one).

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
  p_remarks         text    DEFAULT NULL
)
RETURNS public.packages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role         user_role := get_user_role();
  v_org          uuid      := get_user_org_id();
  v_branch_org   uuid;
  v_customer_org uuid;
  v_type         record;
  v_issued       date := COALESCE(p_issued_date, (now() AT TIME ZONE 'Asia/Kathmandu')::date);
  v_expiry       date;
  v_row          public.packages;
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

  INSERT INTO public.packages (
    org_id, branch_id, package_type_id, service_id, customer_id, guest_name,
    guest_info, issued_date, expiry_date, paid_amount, sessions_total, remarks,
    issued_by
  )
  VALUES (
    v_org, p_branch_id, p_package_type_id, v_type.service_id, p_customer_id,
    btrim(p_guest_name), p_guest_info, v_issued, v_expiry, p_paid_amount,
    COALESCE(p_sessions_total, v_type.default_sessions), p_remarks, auth.uid()
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_package(uuid, uuid, uuid, uuid, text, text, date, date, numeric, int, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_package(uuid, uuid, uuid, uuid, text, text, date, date, numeric, int, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.issue_package(uuid, uuid, uuid, uuid, text, text, date, date, numeric, int, text) TO authenticated;

-- ---- redeem_package_session --------------------------------------------------
-- Appends one redemption row. Locks the parent package so two concurrent
-- redemptions against the same package can't both pass the sessions-left
-- check (mirrors claim_voucher's FOR UPDATE guard). Role check includes
-- 'staff' in addition to manager/admin -- the deliberate divergence from
-- claim_voucher, since redeeming a session is a staff-facing action.

CREATE OR REPLACE FUNCTION public.redeem_package_session(
  p_package_id          uuid,
  p_booking_id          uuid DEFAULT NULL,
  p_branch_claimed_id   uuid DEFAULT NULL,
  p_guest_name_used_by  text DEFAULT NULL,
  p_notes               text DEFAULT NULL
)
RETURNS public.package_redemptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role          user_role := get_user_role();
  v_org           uuid      := get_user_org_id();
  v_package_org   uuid;
  v_sessions_total int;
  v_expiry_date   date;
  v_branch_org    uuid;
  v_booking_org   uuid;
  v_sessions_used int;
  v_row           public.package_redemptions;
BEGIN
  IF v_role NOT IN ('staff','manager','admin') THEN
    RAISE EXCEPTION 'redeem_package_session: staff, manager, or admin role required';
  END IF;

  IF p_branch_claimed_id IS NULL THEN
    RAISE EXCEPTION 'redeem_package_session: branch_claimed_id is required';
  END IF;

  SELECT org_id INTO v_branch_org FROM public.branches WHERE id = p_branch_claimed_id;
  IF v_branch_org IS NULL OR v_branch_org IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'redeem_package_session: redeeming branch is not in your organization';
  END IF;

  IF p_booking_id IS NOT NULL THEN
    -- bookings has no org_id column (only branch_id) so org_id is resolved
    -- via branches, same as migration-108.
    SELECT br.org_id INTO v_booking_org
    FROM public.bookings b
    JOIN public.branches br ON br.id = b.branch_id
    WHERE b.id = p_booking_id;
    IF v_booking_org IS NULL OR v_booking_org IS DISTINCT FROM v_org THEN
      RAISE EXCEPTION 'redeem_package_session: booking is not in your organization';
    END IF;
  END IF;

  -- Lock the package row so a concurrent redemption can't race the
  -- sessions-remaining check.
  SELECT org_id, sessions_total, expiry_date
  INTO v_package_org, v_sessions_total, v_expiry_date
  FROM public.packages
  WHERE id = p_package_id
  FOR UPDATE;

  IF v_package_org IS NULL THEN
    RAISE EXCEPTION 'redeem_package_session: package % not found', p_package_id;
  END IF;
  IF v_package_org IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'redeem_package_session: package is not in your organization';
  END IF;

  SELECT COUNT(*) INTO v_sessions_used
  FROM public.package_redemptions
  WHERE package_id = p_package_id;

  IF v_expiry_date < current_date THEN
    RAISE EXCEPTION 'redeem_package_session: package expired on %', v_expiry_date;
  END IF;

  IF v_sessions_used >= v_sessions_total THEN
    RAISE EXCEPTION 'redeem_package_session: no sessions remaining on this package';
  END IF;

  INSERT INTO public.package_redemptions (
    package_id, org_id, redeemed_date, branch_id, booking_id,
    guest_name_used_by, notes, performed_by
  )
  VALUES (
    p_package_id, v_org, (now() AT TIME ZONE 'Asia/Kathmandu')::date, p_branch_claimed_id,
    p_booking_id, p_guest_name_used_by, p_notes, auth.uid()
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_package_session(uuid, uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.redeem_package_session(uuid, uuid, uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.redeem_package_session(uuid, uuid, uuid, text, text) TO authenticated;

-- ============================================================
-- MIGRATION 141 COMPLETE
-- ============================================================

INSERT INTO public.schema_migrations (version, name)
VALUES ('141', 'service-packages')
ON CONFLICT (version) DO NOTHING;
