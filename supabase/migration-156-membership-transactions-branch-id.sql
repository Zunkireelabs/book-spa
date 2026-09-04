-- Migration 156: branch_id on membership_transactions (additive, REVERSIBLE)
--
-- The Today Insights dashboard card's Memberships Sold/Redeemed rows are
-- currently org-wide only -- membership_transactions has no branch_id column
-- at all (a deliberate historical decision, see comment previously at
-- src/services/api.js ~3013). Vouchers and packages already track
-- issuing-branch + redemption-branch separately while keeping the underlying
-- value centralized/usable across branches; this migration brings
-- memberships to the same model, going forward only.
--
-- Historical deposit/adjustment/enrollment/birthday_perk/extension rows have
-- no recoverable branch info and are left NULL (unattributed). Historical
-- 'deduction' rows are the one exception -- they're traceable via their
-- existing booking_id -> bookings.branch_id link, so those are backfilled
-- with real data below.
--
-- Idempotent: guarded ADD COLUMN, backfill only touches NULL rows,
-- CREATE INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION.
-- Portable: no hardcoded UUIDs.
--
-- Reversible:
--   DROP INDEX IF EXISTS idx_membership_transactions_branch;
--   ALTER TABLE public.membership_transactions DROP COLUMN IF EXISTS branch_id;
--   (then re-run migration-045/046/061/062/083's original CREATE OR REPLACE
--    FUNCTION bodies to drop the p_branch_id params)

-- ============================================================
-- 1. Column + backfill + index
-- ============================================================

ALTER TABLE public.membership_transactions
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id);

UPDATE public.membership_transactions mt
   SET branch_id = b.branch_id
  FROM public.bookings b
 WHERE mt.booking_id = b.id
   AND mt.kind = 'deduction'
   AND mt.branch_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_membership_transactions_branch
  ON public.membership_transactions(branch_id);

-- ============================================================
-- 2. record_membership_transaction -- add p_branch_id param
-- ============================================================
-- Adding a parameter changes the signature, so CREATE OR REPLACE would
-- otherwise create a second overload alongside the old one. Drop the old
-- signature first so callers can't silently resolve to the branch-less
-- version.

DROP FUNCTION IF EXISTS public.record_membership_transaction(uuid, text, numeric, text, uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.record_membership_transaction(
  p_membership_id uuid,
  p_kind          text,
  p_amount        numeric,
  p_payment_mode  text   DEFAULT NULL,
  p_booking_id    uuid   DEFAULT NULL,
  p_payment_id    uuid   DEFAULT NULL,
  p_notes         text   DEFAULT NULL,
  p_branch_id     uuid   DEFAULT NULL
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
    (membership_id, org_id, kind, amount, payment_mode, booking_id, payment_id, performed_by, notes, branch_id)
  VALUES
    (p_membership_id, v_mem_org, p_kind, p_amount, p_payment_mode, p_booking_id, p_payment_id, auth.uid(), p_notes, p_branch_id)
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

REVOKE ALL ON FUNCTION public.record_membership_transaction(uuid, text, numeric, text, uuid, uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_membership_transaction(uuid, text, numeric, text, uuid, uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_membership_transaction(uuid, text, numeric, text, uuid, uuid, text, uuid) TO authenticated;

-- ============================================================
-- 3. record_membership_payment -- derive branch_id from the booking
-- ============================================================
-- Authoritative path: b.branch_id already joined in for the same-org check,
-- just wasn't kept. Not spoofable by a stale client value.

CREATE OR REPLACE FUNCTION public.record_membership_payment(
  p_booking_id  uuid,
  p_amount      numeric,
  p_notes       text DEFAULT NULL
)
RETURNS uuid  -- the new payments.id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_org    uuid := get_user_org_id();
  v_actor         uuid := auth.uid();
  v_customer_id   uuid;
  v_booking_org   uuid;
  v_booking_branch uuid;
  v_membership_id uuid;
  v_balance       numeric(12,2);
  v_payment_id    uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'record_membership_payment: must be signed in';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'record_membership_payment: amount must be positive';
  END IF;

  -- Resolve the booking → customer → org. Walk-ins (NULL customer_id) cannot
  -- use a wallet because there's nothing to bill against.
  SELECT b.customer_id, br.org_id, b.branch_id
    INTO v_customer_id, v_booking_org, v_booking_branch
  FROM public.bookings b
  JOIN public.branches br ON br.id = b.branch_id
  WHERE b.id = p_booking_id;

  IF v_booking_org IS NULL THEN
    RAISE EXCEPTION 'record_membership_payment: booking % not found', p_booking_id;
  END IF;

  IF v_booking_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'record_membership_payment: booking is not in your organization';
  END IF;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'record_membership_payment: booking has no linked customer (walk-in cannot use a wallet)';
  END IF;

  -- Find the most recent membership for this customer in the org and lock it.
  -- (One non-depleted membership per customer is enforced by the partial unique
  -- index in migration-045, so this is unambiguous in practice.)
  SELECT id, balance
    INTO v_membership_id, v_balance
  FROM public.memberships
  WHERE org_id = v_caller_org AND customer_id = v_customer_id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_membership_id IS NULL THEN
    RAISE EXCEPTION 'record_membership_payment: customer has no membership';
  END IF;

  IF v_balance < p_amount THEN
    RAISE EXCEPTION 'record_membership_payment: insufficient wallet balance (have %, need %)',
      v_balance, p_amount;
  END IF;

  -- Atomic pair: payments INSERT first so we can link the deduction back to it.
  INSERT INTO public.payments (booking_id, amount, payment_mode, recorded_by, notes)
  VALUES (p_booking_id, p_amount, 'Membership', v_actor, p_notes)
  RETURNING id INTO v_payment_id;

  INSERT INTO public.membership_transactions
    (membership_id, org_id, kind, amount, payment_mode, booking_id, payment_id, performed_by, notes, branch_id)
  VALUES
    (v_membership_id, v_caller_org, 'deduction', -p_amount, NULL, p_booking_id, v_payment_id, v_actor,
     COALESCE(p_notes, 'Booking checkout'), v_booking_branch);

  RETURN v_payment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_membership_payment(uuid, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_membership_payment(uuid, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_membership_payment(uuid, numeric, text) TO authenticated;

-- ============================================================
-- 4. enroll_member -- add p_branch_id param
-- ============================================================

DROP FUNCTION IF EXISTS public.enroll_member(uuid, uuid, numeric, text, text);

CREATE OR REPLACE FUNCTION public.enroll_member(
  p_customer_id      uuid,
  p_tier_id          uuid,
  p_initial_deposit  numeric,
  p_payment_mode     text,
  p_notes            text DEFAULT NULL,
  p_branch_id        uuid DEFAULT NULL
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
  IF v_role NOT IN ('manager', 'admin', 'staff') THEN
    RAISE EXCEPTION 'enroll_member: manager, admin, or staff role required';
  END IF;

  IF p_initial_deposit IS NULL OR p_initial_deposit <= 0 THEN
    RAISE EXCEPTION 'enroll_member: initial deposit must be positive';
  END IF;

  IF p_payment_mode IS NULL
     OR length(trim(p_payment_mode)) = 0
     OR length(p_payment_mode) > 40 THEN
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

  -- Initial deposit, inserted directly (not via record_membership_transaction,
  -- which is manager/admin-only) so a staff-enrolled member's first deposit
  -- still goes through the same trigger-driven balance recompute.
  INSERT INTO public.membership_transactions
    (membership_id, org_id, kind, amount, payment_mode, performed_by, notes, branch_id)
  VALUES
    (v_membership, v_caller_org, 'deposit', p_initial_deposit, p_payment_mode, auth.uid(), 'Initial enrollment deposit', p_branch_id);

  RETURN v_membership;
END;
$$;

REVOKE ALL ON FUNCTION public.enroll_member(uuid, uuid, numeric, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enroll_member(uuid, uuid, numeric, text, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.enroll_member(uuid, uuid, numeric, text, text, uuid) TO authenticated;

-- ============================================================
-- 5. renew_membership -- add p_branch_id param
-- ============================================================

DROP FUNCTION IF EXISTS public.renew_membership(uuid, numeric, text, uuid, text);

CREATE OR REPLACE FUNCTION public.renew_membership(
  p_membership_id uuid,
  p_amount        numeric,
  p_payment_mode  text,
  p_tier_id       uuid DEFAULT NULL,
  p_notes         text DEFAULT NULL,
  p_branch_id     uuid DEFAULT NULL
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
  v_current_tier uuid;
  v_final_tier   uuid;
  v_tier_org     uuid;
  v_validity     int;
  v_activation   date;
  v_balance      numeric(12,2);
  v_txn_id       uuid;
BEGIN
  IF v_role NOT IN ('manager','admin') THEN
    RAISE EXCEPTION 'renew_membership: manager or admin role required';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'renew_membership: amount must be positive';
  END IF;

  -- Lock the membership row + load current state.
  SELECT org_id, tier_id, balance
    INTO v_mem_org, v_current_tier, v_balance
  FROM public.memberships
  WHERE id = p_membership_id
  FOR UPDATE;

  IF v_mem_org IS NULL THEN
    RAISE EXCEPTION 'renew_membership: membership % not found', p_membership_id;
  END IF;

  IF v_mem_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'renew_membership: membership is not in your organization';
  END IF;

  -- Optional tier change.
  v_final_tier := COALESCE(p_tier_id, v_current_tier);
  IF p_tier_id IS NOT NULL AND p_tier_id IS DISTINCT FROM v_current_tier THEN
    SELECT org_id INTO v_tier_org FROM public.membership_tiers WHERE id = p_tier_id;
    IF v_tier_org IS NULL THEN
      RAISE EXCEPTION 'renew_membership: tier % not found', p_tier_id;
    END IF;
    IF v_tier_org IS DISTINCT FROM v_caller_org THEN
      RAISE EXCEPTION 'renew_membership: tier must be in your organization';
    END IF;
    UPDATE public.memberships SET tier_id = p_tier_id WHERE id = p_membership_id;
  END IF;

  SELECT validity_days INTO v_validity FROM public.membership_tiers WHERE id = v_final_tier;

  -- Forfeit any balance left over from the expired cycle -- renewal starts a
  -- fresh cycle, so old unspent money is written off (visible in history as
  -- an adjustment row, not dropped).
  IF v_balance <> 0 THEN
    INSERT INTO public.membership_transactions
      (membership_id, org_id, kind, amount, performed_by, notes, branch_id)
    VALUES
      (p_membership_id, v_mem_org, 'adjustment', -v_balance, auth.uid(),
       'Previous cycle balance forfeited on renewal.', p_branch_id);
  END IF;

  -- Record the deposit (trigger recomputes total_deposited/balance; won't
  -- touch activation_date/expiry_date since they're already set).
  v_txn_id := public.record_membership_transaction(
    p_membership_id, 'deposit', p_amount, p_payment_mode, NULL, NULL,
    COALESCE(p_notes, 'Renewal deposit'), p_branch_id
  );

  -- Start a fresh cycle on this same row.
  v_activation := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  UPDATE public.memberships
     SET activation_date = v_activation,
         expiry_date     = v_activation + (v_validity || ' days')::interval
   WHERE id = p_membership_id;

  RETURN v_txn_id;
END;
$$;

REVOKE ALL ON FUNCTION public.renew_membership(uuid, numeric, text, uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.renew_membership(uuid, numeric, text, uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.renew_membership(uuid, numeric, text, uuid, text, uuid) TO authenticated;

-- ============================================================
-- 6. extend_membership -- add p_branch_id param
-- ============================================================

DROP FUNCTION IF EXISTS public.extend_membership(uuid, date, text);

CREATE OR REPLACE FUNCTION public.extend_membership(
  p_membership_id   uuid,
  p_new_expiry_date date,
  p_notes           text DEFAULT NULL,
  p_branch_id       uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role        user_role := get_user_role();
  v_caller_org  uuid      := get_user_org_id();
  v_mem_org     uuid;
  v_balance     numeric(12,2);
  v_expiry      date;
  v_today       date := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  v_txn_id      uuid;
BEGIN
  IF v_role NOT IN ('manager','admin') THEN
    RAISE EXCEPTION 'extend_membership: manager or admin role required';
  END IF;

  IF p_new_expiry_date IS NULL OR p_new_expiry_date <= v_today THEN
    RAISE EXCEPTION 'extend_membership: new expiry date must be after today';
  END IF;

  -- Lock the membership row + load current state.
  SELECT org_id, balance, expiry_date
    INTO v_mem_org, v_balance, v_expiry
  FROM public.memberships
  WHERE id = p_membership_id
  FOR UPDATE;

  IF v_mem_org IS NULL THEN
    RAISE EXCEPTION 'extend_membership: membership % not found', p_membership_id;
  END IF;

  IF v_mem_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'extend_membership: membership is not in your organization';
  END IF;

  IF v_balance <= 0 THEN
    RAISE EXCEPTION 'extend_membership: membership has no remaining balance -- use renew instead';
  END IF;

  IF v_expiry IS NULL OR v_expiry >= v_today THEN
    RAISE EXCEPTION 'extend_membership: membership is not lapsed';
  END IF;

  -- Extend validity only -- balance, total_deposited, and tier_id are untouched.
  UPDATE public.memberships
     SET expiry_date = p_new_expiry_date
   WHERE id = p_membership_id;

  -- Zero-amount audit row so the reactivation shows up in transaction history.
  INSERT INTO public.membership_transactions
    (membership_id, org_id, kind, amount, performed_by, notes, branch_id)
  VALUES
    (p_membership_id, v_mem_org, 'extension', 0, auth.uid(),
     COALESCE(p_notes, 'Membership reactivated -- validity extended to ' || p_new_expiry_date || ', balance preserved.'), p_branch_id)
  RETURNING id INTO v_txn_id;

  RETURN v_txn_id;
END;
$$;

REVOKE ALL ON FUNCTION public.extend_membership(uuid, date, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.extend_membership(uuid, date, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.extend_membership(uuid, date, text, uuid) TO authenticated;

-- ============================================================
-- 7. Record migration
-- ============================================================

INSERT INTO public.schema_migrations (version, name)
VALUES ('156', 'membership-transactions-branch-id')
ON CONFLICT (version) DO NOTHING;
