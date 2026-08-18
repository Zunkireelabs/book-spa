-- Migration 045: memberships (RECONSTRUCTED — not the original applied SQL)
--
-- ⚠️ PROVENANCE: This migration was applied directly to production via the Supabase
-- dashboard SQL editor and never committed to git. The literal statements that ran
-- are lost — they are not in this repo and not in supabase_migrations.schema_migrations
-- (Supabase's own history table only goes back to June 2026 and doesn't cover this
-- version). This file was reconstructed on 2026-08-13 by Deployment Operator from
-- supabase/baseline/schema.sql (a pg_dump of the LIVE prod schema), to document the
-- migration's net effect and let a from-scratch database reach parity. It is a
-- best-effort re-derivation, NOT a byte-identical replay of history.
--
-- Net effect modeled here: the foundational membership/wallet feature —
-- membership_tiers (per-org tier definitions), memberships (one wallet per
-- customer/tier enrollment), and membership_transactions (the deposit/deduction
-- ledger), plus the enroll_member() RPC and the membership_recompute() trigger that
-- keeps memberships.total_deposited/balance/activation_date/expiry_date in sync with
-- the ledger.
--
-- Columns/constraints deliberately EXCLUDED here because later-named migrations own
-- them (kept out to avoid stepping on those files' CREATE/ALTER statements):
--   - membership_transactions.payment_mode + its CHECK           -> 046
--   - memberships.membership_number, membership_tiers.code_prefix -> 047
--
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS + CREATE).

-- 1. membership_tiers -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.membership_tiers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  advance_amount  numeric(12,2) NOT NULL,
  validity_days   integer NOT NULL DEFAULT 365,
  discount_rules  jsonb NOT NULL DEFAULT '{}'::jsonb,
  display_order   integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT membership_tiers_advance_amount_check CHECK (advance_amount > 0),
  CONSTRAINT membership_tiers_validity_days_check CHECK (validity_days > 0)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'membership_tiers_org_name_uniq'
  ) THEN
    ALTER TABLE public.membership_tiers
      ADD CONSTRAINT membership_tiers_org_name_uniq UNIQUE (org_id, name);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_membership_tiers_org ON public.membership_tiers USING btree (org_id);

-- 2. memberships -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.memberships (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_id           uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  tier_id               uuid NOT NULL REFERENCES public.membership_tiers(id),
  total_deposited       numeric(12,2) NOT NULL DEFAULT 0,
  balance               numeric(12,2) NOT NULL DEFAULT 0,
  activation_date       date,
  expiry_date           date,
  birthday_perk_used_at timestamptz,
  notes                 text,
  created_by            uuid REFERENCES public.users(id),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memberships_org      ON public.memberships USING btree (org_id);
CREATE INDEX IF NOT EXISTS idx_memberships_customer ON public.memberships USING btree (org_id, customer_id);

-- Partial unique index: a customer may hold at most one "open" membership (a
-- positive balance, or one that has never activated) at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_membership_per_customer
  ON public.memberships USING btree (org_id, customer_id)
  WHERE (balance > 0::numeric OR activation_date IS NULL);

-- 3. membership_transactions (the ledger) -------------------------------------------
CREATE TABLE IF NOT EXISTS public.membership_transactions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id uuid NOT NULL REFERENCES public.memberships(id) ON DELETE CASCADE,
  org_id        uuid NOT NULL REFERENCES public.organizations(id),
  kind          text NOT NULL,
  amount        numeric(12,2) NOT NULL,
  booking_id    uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  payment_id    uuid,
  performed_by  uuid REFERENCES public.users(id),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT membership_transactions_kind_check CHECK (kind = ANY (ARRAY['deposit','deduction','birthday_perk','adjustment'])),
  CONSTRAINT membership_transactions_amount_sign CHECK (
    (kind = 'deposit' AND amount > 0)
    OR (kind = 'deduction' AND amount < 0)
    OR (kind = 'adjustment' AND amount <> 0)
    OR (kind = 'birthday_perk' AND amount = 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_membership_txns_membership ON public.membership_transactions USING btree (membership_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_membership_txns_booking    ON public.membership_transactions USING btree (booking_id) WHERE (booking_id IS NOT NULL);

-- 4. membership_recompute(): keeps memberships.total_deposited/balance in sync with
--    the ledger, and stamps activation_date/expiry_date the first time the running
--    deposit total crosses the tier's advance_amount threshold.
CREATE OR REPLACE FUNCTION public.membership_recompute() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_total      numeric(12,2);
  v_balance    numeric(12,2);
  v_threshold  numeric(12,2);
  v_validity   int;
  v_already    boolean;
  v_activation date;
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

-- 5. enroll_member(): manager/admin creates a membership + first deposit.
-- NOTE: the payment_mode validation below is reconstructed from the final
-- enroll_member body in schema.sql, which hardcodes the same fixed list of modes
-- that migration-046 introduces as a column+constraint on membership_transactions.
-- It's included here (rather than deferred to 046) because a working enroll_member
-- needs SOME payment_mode handling from the start; 046 is what gives that mode a
-- place to be stored durably on the ledger row.
CREATE OR REPLACE FUNCTION public.enroll_member(p_customer_id uuid, p_tier_id uuid, p_initial_deposit numeric, p_payment_mode text, p_notes text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
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

-- 6. record_membership_transaction(): the shared, authorized entry point every
--    deposit/deduction/adjustment/birthday_perk goes through.
-- NOTE: this 045 version accepts p_payment_mode (so callers like enroll_member's
-- signature don't need to change again in 046) but does NOT yet persist it — the
-- membership_transactions.payment_mode column doesn't exist until migration-046,
-- which both adds the column and swaps this function for a version that stores it.
CREATE OR REPLACE FUNCTION public.record_membership_transaction(p_membership_id uuid, p_kind text, p_amount numeric, p_payment_mode text DEFAULT NULL::text, p_booking_id uuid DEFAULT NULL::uuid, p_payment_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
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

  INSERT INTO public.membership_transactions
    (membership_id, org_id, kind, amount, booking_id, payment_id, performed_by, notes)
  VALUES
    (p_membership_id, v_mem_org, p_kind, p_amount, p_booking_id, p_payment_id, auth.uid(), p_notes)
  RETURNING id INTO v_txn_id;

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

-- 7. RLS ---------------------------------------------------------------------------
ALTER TABLE public.membership_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read membership tiers" ON public.membership_tiers;
CREATE POLICY "Anyone can read membership tiers"
  ON public.membership_tiers FOR SELECT
  TO authenticated, anon
  USING (true);

DROP POLICY IF EXISTS "Users can read own org memberships" ON public.memberships;
CREATE POLICY "Users can read own org memberships"
  ON public.memberships FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id());

DROP POLICY IF EXISTS "Users can read own org membership transactions" ON public.membership_transactions;
CREATE POLICY "Users can read own org membership transactions"
  ON public.membership_transactions FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id());

-- 8. Record migration ----------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('045', 'memberships')
ON CONFLICT (version) DO NOTHING;
