-- Migration 045: membership wallet system (Phase 1 — additive, REVERSIBLE)
--
-- Introduces a prepaid wallet + tiered membership program. Three tables:
--
--   membership_tiers         — org-scoped catalog (Premium Club, Deluxe Club, …).
--                              advance_amount + validity_days + discount_rules JSON.
--   memberships              — one row per customer enrollment. Tracks total_deposited
--                              and balance (maintained by trigger), activation_date and
--                              expiry_date (auto-set when total_deposited first reaches
--                              the tier's advance_amount), and the manual birthday-perk
--                              timestamp.
--   membership_transactions  — append-only ledger. Every deposit, deduction (booking
--                              payment), birthday gift, and admin adjustment lands here.
--                              Drives the balance/total_deposited recomputation trigger.
--
-- Status (pending / active / lapsed / depleted) is computed from
-- (activation_date, expiry_date, balance, total_deposited, tier.advance_amount)
-- and NOT stored. Keeps the data model simple and avoids a cron job in v1.
--
-- Discount enforcement is OUT OF SCOPE for v1 — staff enters the discount % manually
-- per booking. tier.discount_rules is captured for the marketing page + future v2
-- auto-application, but no DB constraint reads it.
--
-- Writes to memberships + membership_transactions go through SECURITY DEFINER
-- functions (record_membership_transaction, enroll_member) — there are NO direct
-- INSERT/UPDATE/DELETE policies on those tables. This mirrors the
-- staff_transfers / transfer_therapist pattern from migration-038/039.
--
-- Idempotent: CREATE … IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE POLICY,
-- CREATE OR REPLACE FUNCTION/TRIGGER, ON CONFLICT DO NOTHING for seed.
-- Portable: tier seed resolves orgs by SELECT … FROM organizations (no UUIDs).
--
-- Reversible (manual):
--   DROP FUNCTION IF EXISTS public.enroll_member(uuid, uuid, numeric, text, text);
--   DROP FUNCTION IF EXISTS public.record_membership_transaction(uuid, text, numeric, text, uuid, uuid, text);
--   DROP TRIGGER  IF EXISTS trg_membership_recompute ON public.membership_transactions;
--   DROP FUNCTION IF EXISTS public.membership_recompute();
--   DROP TABLE    IF EXISTS public.membership_transactions;
--   DROP TABLE    IF EXISTS public.memberships;
--   DROP TABLE    IF EXISTS public.membership_tiers;

-- ============================================================
-- 1. TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.membership_tiers (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  advance_amount  numeric(12,2) NOT NULL CHECK (advance_amount > 0),
  validity_days   int         NOT NULL DEFAULT 365 CHECK (validity_days > 0),
  discount_rules  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  display_order   int         NOT NULL DEFAULT 0,
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT membership_tiers_org_name_uniq UNIQUE (org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_membership_tiers_org ON public.membership_tiers(org_id);

CREATE TABLE IF NOT EXISTS public.memberships (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_id            uuid        NOT NULL REFERENCES public.customers(id)     ON DELETE RESTRICT,
  tier_id                uuid        NOT NULL REFERENCES public.membership_tiers(id),
  total_deposited        numeric(12,2) NOT NULL DEFAULT 0,
  balance                numeric(12,2) NOT NULL DEFAULT 0,
  activation_date        date,
  expiry_date            date,
  birthday_perk_used_at  timestamptz,
  notes                  text,
  created_by             uuid        REFERENCES public.users(id),
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memberships_org      ON public.memberships(org_id);
CREATE INDEX IF NOT EXISTS idx_memberships_customer ON public.memberships(org_id, customer_id);

-- At most ONE non-depleted membership per (customer, org).
-- A membership is "non-depleted" while it still has a balance OR has never activated
-- (pending state). Once balance hits 0 AND activation_date is set, the row counts as
-- depleted and the customer may enroll fresh.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_membership_per_customer
  ON public.memberships(org_id, customer_id)
  WHERE balance > 0 OR activation_date IS NULL;

CREATE TABLE IF NOT EXISTS public.membership_transactions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id   uuid        NOT NULL REFERENCES public.memberships(id) ON DELETE CASCADE,
  org_id          uuid        NOT NULL REFERENCES public.organizations(id),
  kind            text        NOT NULL CHECK (kind IN ('deposit','deduction','birthday_perk','adjustment')),
  amount          numeric(12,2) NOT NULL,
  payment_mode    text        CHECK (payment_mode IN ('Cash','Card','MobileBanking','Cheque','Esewa','Khalti','Membership')),
  booking_id      uuid        REFERENCES public.bookings(id) ON DELETE SET NULL,
  payment_id      uuid        REFERENCES public.payments(id) ON DELETE SET NULL,
  performed_by    uuid        REFERENCES public.users(id),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- Sign rules per kind:
  --   deposit       → amount > 0
  --   deduction     → amount < 0
  --   adjustment    → amount <> 0 (can go either way)
  --   birthday_perk → amount = 0 (informational ledger row)
  CONSTRAINT membership_transactions_amount_sign CHECK (
    (kind = 'deposit'       AND amount > 0)
    OR (kind = 'deduction'  AND amount < 0)
    OR (kind = 'adjustment' AND amount <> 0)
    OR (kind = 'birthday_perk' AND amount = 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_membership_txns_membership
  ON public.membership_transactions(membership_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_membership_txns_booking
  ON public.membership_transactions(booking_id)
  WHERE booking_id IS NOT NULL;

-- ============================================================
-- 2. BALANCE-RECOMPUTE TRIGGER
-- ============================================================
-- After every ledger insert, recompute total_deposited + balance on the parent
-- membership row. If total_deposited first crosses the tier threshold, set
-- activation_date = today and expiry_date = today + validity_days.
--
-- Locks the membership row FOR UPDATE so concurrent inserts can't both compute
-- a stale sum.

CREATE OR REPLACE FUNCTION public.membership_recompute()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total      numeric(12,2);
  v_balance    numeric(12,2);
  v_threshold  numeric(12,2);
  v_validity   int;
  v_activation date;
  v_already    boolean;
BEGIN
  PERFORM 1 FROM public.memberships WHERE id = NEW.membership_id FOR UPDATE;

  SELECT t.advance_amount, t.validity_days, m.activation_date IS NOT NULL
    INTO v_threshold, v_validity, v_already
  FROM public.memberships m
  JOIN public.membership_tiers t ON t.id = m.tier_id
  WHERE m.id = NEW.membership_id;

  SELECT COALESCE(SUM(amount) FILTER (WHERE kind = 'deposit'), 0),
         COALESCE(SUM(amount), 0)
    INTO v_total, v_balance
  FROM public.membership_transactions
  WHERE membership_id = NEW.membership_id;

  IF v_already OR v_total < v_threshold THEN
    UPDATE public.memberships
       SET total_deposited = v_total,
           balance         = v_balance
     WHERE id = NEW.membership_id;
  ELSE
    v_activation := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
    UPDATE public.memberships
       SET total_deposited = v_total,
           balance         = v_balance,
           activation_date = v_activation,
           expiry_date     = v_activation + (v_validity || ' days')::interval
     WHERE id = NEW.membership_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_membership_recompute ON public.membership_transactions;
CREATE TRIGGER trg_membership_recompute
  AFTER INSERT ON public.membership_transactions
  FOR EACH ROW EXECUTE FUNCTION public.membership_recompute();

-- ============================================================
-- 3. RLS
-- ============================================================

ALTER TABLE public.membership_tiers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_transactions ENABLE ROW LEVEL SECURITY;

-- ---- membership_tiers ------------------------------------------------------

-- Public read so the customer-facing /:orgSlug/membership marketing page can list
-- tiers without auth. (Same anon-read precedent as branches/services/etc.)
DROP POLICY IF EXISTS "Anyone can read membership tiers" ON public.membership_tiers;
CREATE POLICY "Anyone can read membership tiers"
  ON public.membership_tiers FOR SELECT
  TO anon, authenticated
  USING (true);

-- Admin-only write on tiers.
DROP POLICY IF EXISTS "Admin can manage membership tiers" ON public.membership_tiers;
CREATE POLICY "Admin can manage membership tiers"
  ON public.membership_tiers FOR ALL
  TO authenticated
  USING (get_user_role() = 'admin' AND org_id = get_user_org_id())
  WITH CHECK (get_user_role() = 'admin' AND org_id = get_user_org_id());

-- ---- memberships -----------------------------------------------------------

-- Same-org staff (any role) may read membership records.
DROP POLICY IF EXISTS "Users can read own org memberships" ON public.memberships;
CREATE POLICY "Users can read own org memberships"
  ON public.memberships FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id());

-- NO direct INSERT/UPDATE/DELETE policy — writes go through enroll_member()
-- and record_membership_transaction() (SECURITY DEFINER, defined below).

-- ---- membership_transactions ----------------------------------------------

DROP POLICY IF EXISTS "Users can read own org membership transactions"
  ON public.membership_transactions;
CREATE POLICY "Users can read own org membership transactions"
  ON public.membership_transactions FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id());

-- NO INSERT/UPDATE/DELETE policy — ledger is append-only via
-- record_membership_transaction() (SECURITY DEFINER).

-- ============================================================
-- 4. SECURITY DEFINER WRITE FUNCTIONS
-- ============================================================
-- All writes to memberships + membership_transactions route through these.
-- Mirrors the transfer_therapist pattern (migration-039) — no direct table
-- INSERT policy, so the ledger can't be forged and the membership row can't
-- be created with a stale balance.

-- ---- record_membership_transaction ----------------------------------------
-- Append one ledger row (and let the trigger recompute the parent row).
-- Used for deposits, deductions (booking payments), birthday perks, and admin
-- adjustments. Returns the new transaction id.

CREATE OR REPLACE FUNCTION public.record_membership_transaction(
  p_membership_id uuid,
  p_kind          text,
  p_amount        numeric,
  p_payment_mode  text   DEFAULT NULL,
  p_booking_id    uuid   DEFAULT NULL,
  p_payment_id    uuid   DEFAULT NULL,
  p_notes         text   DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role         user_role := get_user_role();
  v_caller_org   uuid      := get_user_org_id();
  v_mem_org      uuid;
  v_balance      numeric(12,2);
  v_activation   date;
  v_expiry       date;
  v_perk_used    timestamptz;
  v_txn_id       uuid;
BEGIN
  IF p_kind NOT IN ('deposit','deduction','birthday_perk','adjustment') THEN
    RAISE EXCEPTION 'record_membership_transaction: invalid kind %', p_kind;
  END IF;

  -- Lock the membership row + load current state.
  SELECT org_id, balance, activation_date, expiry_date, birthday_perk_used_at
    INTO v_mem_org, v_balance, v_activation, v_expiry, v_perk_used
  FROM public.memberships
  WHERE id = p_membership_id
  FOR UPDATE;

  IF v_mem_org IS NULL THEN
    RAISE EXCEPTION 'record_membership_transaction: membership % not found', p_membership_id;
  END IF;

  IF v_mem_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'record_membership_transaction: membership is not in your organization';
  END IF;

  -- Per-kind authorization + sign/business-rule checks.
  IF p_kind IN ('deposit','deduction','birthday_perk') THEN
    IF v_role NOT IN ('manager','admin') THEN
      RAISE EXCEPTION 'record_membership_transaction: manager or admin role required';
    END IF;
  ELSIF p_kind = 'adjustment' THEN
    IF v_role <> 'admin' THEN
      RAISE EXCEPTION 'record_membership_transaction: adjustments are admin-only';
    END IF;
    IF p_notes IS NULL OR length(btrim(p_notes)) = 0 THEN
      RAISE EXCEPTION 'record_membership_transaction: adjustment requires a note';
    END IF;
  END IF;

  IF p_kind = 'deposit' AND p_amount <= 0 THEN
    RAISE EXCEPTION 'record_membership_transaction: deposit amount must be positive';
  END IF;

  IF p_kind = 'deduction' THEN
    IF p_amount >= 0 THEN
      RAISE EXCEPTION 'record_membership_transaction: deduction amount must be negative';
    END IF;
    IF abs(p_amount) > v_balance THEN
      RAISE EXCEPTION 'record_membership_transaction: insufficient balance (have %, need %)',
        v_balance, abs(p_amount);
    END IF;
  END IF;

  IF p_kind = 'birthday_perk' THEN
    IF p_amount <> 0 THEN
      RAISE EXCEPTION 'record_membership_transaction: birthday_perk amount must be 0';
    END IF;
    IF v_activation IS NULL THEN
      RAISE EXCEPTION 'record_membership_transaction: birthday perk requires an active membership';
    END IF;
    IF v_perk_used IS NOT NULL
       AND v_perk_used::date >= v_activation
       AND v_perk_used::date <= COALESCE(v_expiry, v_activation) THEN
      RAISE EXCEPTION 'record_membership_transaction: birthday perk already used in current cycle';
    END IF;
  END IF;

  -- Append the ledger row.
  INSERT INTO public.membership_transactions
    (membership_id, org_id, kind, amount, payment_mode, booking_id, payment_id, performed_by, notes)
  VALUES
    (p_membership_id, v_mem_org, p_kind, p_amount, p_payment_mode, p_booking_id, p_payment_id, auth.uid(), p_notes)
  RETURNING id INTO v_txn_id;

  -- Birthday perk side-effect: stamp the membership so we can block another in
  -- the same cycle. (The trigger handles balance/total_deposited/activation.)
  IF p_kind = 'birthday_perk' THEN
    UPDATE public.memberships
       SET birthday_perk_used_at = now()
     WHERE id = p_membership_id;
  END IF;

  RETURN v_txn_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_membership_transaction(uuid, text, numeric, text, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_membership_transaction(uuid, text, numeric, text, uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_membership_transaction(uuid, text, numeric, text, uuid, uuid, text) TO authenticated;

-- ---- enroll_member --------------------------------------------------------
-- Atomic: create a memberships row + record the initial deposit in one tx.
-- Caller is manager/admin in the customer's org. Returns the new membership id.

CREATE OR REPLACE FUNCTION public.enroll_member(
  p_customer_id      uuid,
  p_tier_id          uuid,
  p_initial_deposit  numeric,
  p_payment_mode     text,
  p_notes            text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role        user_role := get_user_role();
  v_caller_org  uuid      := get_user_org_id();
  v_cust_org    uuid;
  v_tier_org    uuid;
  v_membership  uuid;
BEGIN
  IF v_role NOT IN ('manager','admin') THEN
    RAISE EXCEPTION 'enroll_member: manager or admin role required';
  END IF;

  IF p_initial_deposit IS NULL OR p_initial_deposit <= 0 THEN
    RAISE EXCEPTION 'enroll_member: initial deposit must be positive';
  END IF;

  IF p_payment_mode IS NULL OR p_payment_mode NOT IN ('Cash','Card','MobileBanking','Cheque','Esewa','Khalti') THEN
    RAISE EXCEPTION 'enroll_member: invalid payment_mode %', p_payment_mode;
  END IF;

  SELECT org_id INTO v_cust_org FROM public.customers      WHERE id = p_customer_id;
  SELECT org_id INTO v_tier_org FROM public.membership_tiers WHERE id = p_tier_id;

  IF v_cust_org IS NULL THEN
    RAISE EXCEPTION 'enroll_member: customer % not found', p_customer_id;
  END IF;
  IF v_tier_org IS NULL THEN
    RAISE EXCEPTION 'enroll_member: tier % not found', p_tier_id;
  END IF;
  IF v_cust_org IS DISTINCT FROM v_caller_org OR v_tier_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'enroll_member: customer and tier must be in your organization';
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, notes, created_by)
  VALUES (v_caller_org, p_customer_id, p_tier_id, p_notes, auth.uid())
  RETURNING id INTO v_membership;

  -- First deposit (trigger recomputes balance + may activate).
  PERFORM public.record_membership_transaction(
    v_membership, 'deposit', p_initial_deposit, p_payment_mode, NULL, NULL,
    'Initial enrollment deposit'
  );

  RETURN v_membership;
END;
$$;

REVOKE ALL ON FUNCTION public.enroll_member(uuid, uuid, numeric, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enroll_member(uuid, uuid, numeric, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.enroll_member(uuid, uuid, numeric, text, text) TO authenticated;

-- ============================================================
-- 5. TIER SEED (per existing org)
-- ============================================================
-- Resolves orgs by SELECT … FROM organizations so the same script runs on
-- staging and production despite different org UUIDs. Re-running is harmless.

INSERT INTO public.membership_tiers (org_id, name, advance_amount, discount_rules, display_order)
SELECT o.id, 'Premium Club', 100000,
       '{"spa":45,"salon":25,"body_scrub":30,"package":10}'::jsonb, 1
FROM public.organizations o
ON CONFLICT (org_id, name) DO NOTHING;

INSERT INTO public.membership_tiers (org_id, name, advance_amount, discount_rules, display_order)
SELECT o.id, 'Deluxe Club', 50000, '{}'::jsonb, 2
FROM public.organizations o
ON CONFLICT (org_id, name) DO NOTHING;

-- ============================================================
-- 6. RECORD MIGRATION
-- ============================================================

INSERT INTO public.schema_migrations (version, name)
VALUES ('045', 'memberships')
ON CONFLICT (version) DO NOTHING;
