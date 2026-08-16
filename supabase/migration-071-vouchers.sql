-- Migration 071: voucher system (issue / redeem / balance tracking)
--
-- Replaces the manually-maintained "Nuad Thai Voucher Tracking System" Excel
-- workbook. Four tables + one view:
--
--   voucher_types          — org-scoped catalog (Full Body Oil Massage-60 Min,
--                             1000 Worth Voucher, …). standard_price + code_prefix
--                             + is_wallet (true for the "Worth Voucher" stored-value
--                             types that get claimed across multiple partial visits).
--   voucher_code_counters  — one row per (org, branch, voucher_type). Holds the
--                             next sequence number so issue_voucher() can mint
--                             codes like "NT 4326-0001" without a pre-allocated
--                             block per branch (the Excel's Settings sheet had a
--                             7,128-row master table for this — gone here).
--   vouchers                — one row per issued voucher (was "Vouchers Issued").
--   voucher_claims          — append-only ledger, one row per redemption event
--                             (was "Vouchers Claimed"). A voucher can be claimed
--                             across multiple partial visits (wallet-style).
--   voucher_balances (view) — total_claimed / remaining_balance / status,
--                             computed from voucher_claims (was "Balance Tracking").
--                             Not stored, so there's no drift and no equivalent of
--                             the Excel bug where a blank branch_claimed cell
--                             silently dropped the amount from branch totals.
--
-- Writes go through SECURITY DEFINER functions (issue_voucher, claim_voucher) —
-- there are NO direct INSERT/UPDATE/DELETE policies on vouchers/voucher_claims.
-- Mirrors the memberships pattern (migration-045: enroll_member /
-- record_membership_transaction).
--
-- Manager/admin only, end to end — staff have no read or write access (per
-- product decision: vouchers are not part of the staff workflow for now).
--
-- Idempotent: CREATE … IF NOT EXISTS, DROP POLICY/TRIGGER IF EXISTS,
-- CREATE OR REPLACE FUNCTION, ON CONFLICT DO NOTHING for seed.
-- Portable: voucher_types seed resolves the org by SELECT … FROM organizations
-- (no hardcoded UUIDs) so the same script runs on staging and production.
--
-- Reversible (manual):
--   DROP FUNCTION IF EXISTS public.claim_voucher(uuid, date, text, text, uuid, numeric, text);
--   DROP FUNCTION IF EXISTS public.issue_voucher(uuid, uuid, text, text, numeric, numeric, date, date, text);
--   DROP VIEW     IF EXISTS public.voucher_balances;
--   DROP TABLE    IF EXISTS public.voucher_claims;
--   DROP TABLE    IF EXISTS public.vouchers;
--   DROP TABLE    IF EXISTS public.voucher_code_counters;
--   DROP TABLE    IF EXISTS public.voucher_types;

-- ============================================================
-- 1. TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.voucher_types (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            text          NOT NULL,
  code_prefix     text          NOT NULL,
  standard_price  decimal(10,2) NOT NULL DEFAULT 0 CHECK (standard_price >= 0),
  is_wallet       boolean       NOT NULL DEFAULT false,
  is_active       boolean       NOT NULL DEFAULT true,
  display_order   int           NOT NULL DEFAULT 0,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT voucher_types_org_name_uniq UNIQUE (org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_voucher_types_org ON public.voucher_types(org_id);

CREATE TABLE IF NOT EXISTS public.voucher_code_counters (
  org_id          uuid    NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id       uuid    NOT NULL REFERENCES public.branches(id)      ON DELETE CASCADE,
  voucher_type_id uuid    NOT NULL REFERENCES public.voucher_types(id) ON DELETE CASCADE,
  next_number     int     NOT NULL DEFAULT 1 CHECK (next_number > 0),
  PRIMARY KEY (branch_id, voucher_type_id)
);

CREATE TABLE IF NOT EXISTS public.vouchers (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id             uuid          NOT NULL REFERENCES public.branches(id),
  voucher_type_id       uuid          NOT NULL REFERENCES public.voucher_types(id),
  voucher_code          text          NOT NULL,
  issued_date           date          NOT NULL,
  expiry_date           date          NOT NULL,
  guest_name            text          NOT NULL,
  guest_info            text,
  actual_price          decimal(10,2) NOT NULL CHECK (actual_price >= 0),
  discount_percent      decimal(5,2)  NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
  total_amount_issued   decimal(10,2) NOT NULL CHECK (total_amount_issued >= 0),
  remarks               text,
  issued_by             uuid          REFERENCES public.users(id),
  created_at            timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT vouchers_org_code_uniq UNIQUE (org_id, voucher_code),
  CONSTRAINT vouchers_expiry_after_issue CHECK (expiry_date >= issued_date)
);

CREATE INDEX IF NOT EXISTS idx_vouchers_org         ON public.vouchers(org_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_branch       ON public.vouchers(branch_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_guest_name   ON public.vouchers(org_id, guest_name);
CREATE INDEX IF NOT EXISTS idx_vouchers_type         ON public.vouchers(voucher_type_id);

CREATE TABLE IF NOT EXISTS public.voucher_claims (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id          uuid          NOT NULL REFERENCES public.vouchers(id) ON DELETE CASCADE,
  org_id              uuid          NOT NULL REFERENCES public.organizations(id),
  redeemed_date       date          NOT NULL,
  guest_name_used_by  text,
  service_claimed     text,
  branch_claimed_id   uuid          NOT NULL REFERENCES public.branches(id),
  amount_claimed      decimal(10,2) NOT NULL CHECK (amount_claimed > 0),
  notes               text,
  performed_by        uuid          REFERENCES public.users(id),
  created_at          timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voucher_claims_voucher
  ON public.voucher_claims(voucher_id, redeemed_date DESC);

CREATE INDEX IF NOT EXISTS idx_voucher_claims_branch
  ON public.voucher_claims(branch_claimed_id);

-- ============================================================
-- 2. BALANCE VIEW (replaces "Balance Tracking" sheet — computed, not stored)
-- ============================================================

CREATE OR REPLACE VIEW public.voucher_balances AS
SELECT
  v.id                    AS voucher_id,
  v.org_id,
  v.branch_id,
  v.voucher_code,
  v.guest_name,
  v.guest_info,
  v.total_amount_issued,
  COALESCE(c.total_claimed, 0)                              AS total_claimed,
  v.total_amount_issued - COALESCE(c.total_claimed, 0)       AS remaining_balance,
  CASE
    WHEN COALESCE(c.total_claimed, 0) = 0 THEN 'unused'
    WHEN v.total_amount_issued - COALESCE(c.total_claimed, 0) <= 0 THEN 'fully_redeemed'
    ELSE 'partially_used'
  END                                                        AS status,
  c.last_claim_date
FROM public.vouchers v
LEFT JOIN (
  SELECT voucher_id,
         SUM(amount_claimed) AS total_claimed,
         MAX(redeemed_date)  AS last_claim_date
  FROM public.voucher_claims
  GROUP BY voucher_id
) c ON c.voucher_id = v.id;

-- ============================================================
-- 3. RLS
-- ============================================================

ALTER TABLE public.voucher_types         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voucher_code_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vouchers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voucher_claims        ENABLE ROW LEVEL SECURITY;

-- Manager/admin (any) can read voucher types in their org. No staff access —
-- vouchers are not part of the staff workflow.
DROP POLICY IF EXISTS "Manager/admin can read voucher types" ON public.voucher_types;
CREATE POLICY "Manager/admin can read voucher types"
  ON public.voucher_types FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id() AND get_user_role() IN ('manager','admin','admin_viewer'));

-- No direct write policy on voucher_types — managed via dashboard SQL for now
-- (same posture as membership_tiers being admin-managed; a management UI can
-- be added later without a schema change).
DROP POLICY IF EXISTS "Admin can manage voucher types" ON public.voucher_types;
CREATE POLICY "Admin can manage voucher types"
  ON public.voucher_types FOR ALL
  TO authenticated
  USING (get_user_role() = 'admin' AND org_id = get_user_org_id())
  WITH CHECK (get_user_role() = 'admin' AND org_id = get_user_org_id());

-- voucher_code_counters is internal bookkeeping for issue_voucher() — no
-- policies at all, so it's invisible even to admins via PostgREST. The
-- SECURITY DEFINER function reads/writes it directly.

DROP POLICY IF EXISTS "Manager/admin can read own org vouchers" ON public.vouchers;
CREATE POLICY "Manager/admin can read own org vouchers"
  ON public.vouchers FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id() AND get_user_role() IN ('manager','admin','admin_viewer'));

-- NO direct INSERT/UPDATE/DELETE policy — writes go through issue_voucher().

DROP POLICY IF EXISTS "Manager/admin can read own org voucher claims" ON public.voucher_claims;
CREATE POLICY "Manager/admin can read own org voucher claims"
  ON public.voucher_claims FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id() AND get_user_role() IN ('manager','admin','admin_viewer'));

-- NO direct INSERT/UPDATE/DELETE policy — ledger is append-only via claim_voucher().

-- ============================================================
-- 4. SECURITY DEFINER WRITE FUNCTIONS
-- ============================================================

-- ---- issue_voucher ---------------------------------------------------------
-- Mints the next sequential code for (branch, voucher_type) — e.g. the 41st
-- "Full Body Oil Massage-60 Min" voucher issued at Lazimpat becomes
-- "NT 4326-0041" — and inserts the voucher row. Manager/admin only.

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
  IF v_role NOT IN ('manager','admin') THEN
    RAISE EXCEPTION 'issue_voucher: manager or admin role required';
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

-- ---- claim_voucher ----------------------------------------------------------
-- Appends one redemption row. Locks the parent voucher so two concurrent
-- claims against the same voucher can't both pass the balance check (mirrors
-- record_membership_transaction's deduction guard in migration-045).

CREATE OR REPLACE FUNCTION public.claim_voucher(
  p_voucher_id         uuid,
  p_amount_claimed     numeric,
  p_redeemed_date      date DEFAULT NULL,
  p_guest_name_used_by text DEFAULT NULL,
  p_service_claimed    text DEFAULT NULL,
  p_branch_claimed_id  uuid DEFAULT NULL,
  p_notes              text DEFAULT NULL
)
RETURNS public.voucher_claims
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role          user_role := get_user_role();
  v_org           uuid      := get_user_org_id();
  v_voucher_org   uuid;
  v_total_issued  numeric(10,2);
  v_branch_org    uuid;
  v_already_claimed numeric(10,2);
  v_row           public.voucher_claims;
BEGIN
  IF v_role NOT IN ('manager','admin') THEN
    RAISE EXCEPTION 'claim_voucher: manager or admin role required';
  END IF;

  IF p_amount_claimed IS NULL OR p_amount_claimed <= 0 THEN
    RAISE EXCEPTION 'claim_voucher: amount_claimed must be positive';
  END IF;

  IF p_branch_claimed_id IS NULL THEN
    RAISE EXCEPTION 'claim_voucher: branch_claimed_id is required';
  END IF;

  SELECT org_id INTO v_branch_org FROM public.branches WHERE id = p_branch_claimed_id;
  IF v_branch_org IS NULL OR v_branch_org IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'claim_voucher: claiming branch is not in your organization';
  END IF;

  -- Lock the voucher row so a concurrent claim can't race the balance check.
  SELECT org_id, total_amount_issued INTO v_voucher_org, v_total_issued
  FROM public.vouchers
  WHERE id = p_voucher_id
  FOR UPDATE;

  IF v_voucher_org IS NULL THEN
    RAISE EXCEPTION 'claim_voucher: voucher % not found', p_voucher_id;
  END IF;
  IF v_voucher_org IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'claim_voucher: voucher is not in your organization';
  END IF;

  SELECT COALESCE(SUM(amount_claimed), 0) INTO v_already_claimed
  FROM public.voucher_claims
  WHERE voucher_id = p_voucher_id;

  IF p_amount_claimed > (v_total_issued - v_already_claimed) THEN
    RAISE EXCEPTION 'claim_voucher: amount % exceeds remaining balance %',
      p_amount_claimed, (v_total_issued - v_already_claimed);
  END IF;

  INSERT INTO public.voucher_claims (
    voucher_id, org_id, redeemed_date, guest_name_used_by, service_claimed,
    branch_claimed_id, amount_claimed, notes, performed_by
  )
  VALUES (
    p_voucher_id, v_org,
    COALESCE(p_redeemed_date, (now() AT TIME ZONE 'Asia/Kathmandu')::date),
    p_guest_name_used_by, p_service_claimed, p_branch_claimed_id,
    p_amount_claimed, p_notes, auth.uid()
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_voucher(uuid, numeric, date, text, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_voucher(uuid, numeric, date, text, text, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_voucher(uuid, numeric, date, text, text, uuid, text) TO authenticated;

-- ============================================================
-- 5. VOUCHER TYPE SEED (per existing org)
-- ============================================================
-- Mirrors the Excel's Settings sheet catalog. code_prefix omits the branch
-- block the Excel used (e.g. "NT 4326-0401" for Sanepa) — issue_voucher()
-- numbers per-branch independently via voucher_code_counters, so every
-- branch's first "Full Body Oil Massage-60 Min" voucher is "NT 4326-0001".

INSERT INTO public.voucher_types (org_id, name, code_prefix, standard_price, is_wallet, display_order)
SELECT o.id, t.name, t.code_prefix, t.standard_price, t.is_wallet, t.display_order
FROM public.organizations o
CROSS JOIN (VALUES
  ('Full Body Oil Massage-60 Min',  'NT 4326',        4200, false, 1),
  ('Full Body Oil Massage-90 Min',  'NT 4326',        5800, false, 2),
  ('Full Body Oil Massage-120 Min', 'NT 4326',        7200, false, 3),
  ('30 Min Foot Reflexology',       'NTFM 4326',      2400, false, 4),
  ('Hair Cut - Male/Female',        'NTMF 4326',      1500, false, 5),
  ('Sauna Steam Jacuzzi',           'NTSSJ 4326',     2000, false, 6),
  ('1500 Worth Voucher',            'NT1500 4326',    1500, false, 7),
  ('40% Discount Voucher',          'NT40 4326',         0, false, 8),
  ('25% Discount Voucher',          'NT25 4326',         0, false, 9),
  ('1000 Worth Voucher',            'NTWV(1K) 4326',  1000, true, 10),
  ('2000 Worth Voucher',            'NTWV(2K) 4326',  2000, true, 11),
  ('5000 Worth Voucher',            'NTWV(5K) 4326',  5000, true, 12),
  ('10000 Worth Voucher',           'NTWV(10K) 4326', 10000, true, 13)
) AS t(name, code_prefix, standard_price, is_wallet, display_order)
ON CONFLICT (org_id, name) DO NOTHING;

-- ============================================================
-- 6. RECORD MIGRATION
-- ============================================================

INSERT INTO public.schema_migrations (version, name)
VALUES ('071', 'vouchers')
ON CONFLICT (version) DO NOTHING;
