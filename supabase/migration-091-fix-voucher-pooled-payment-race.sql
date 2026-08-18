-- Migration 091: fix a lock-ordering race in record_voucher_wallet_payment_pooled
-- (REVERSIBLE)
--
-- Bug: migration-090's pooled loop computed each voucher's remaining balance
-- via a LEFT JOIN aggregate over voucher_claims in the SAME query that also
-- carries `FOR UPDATE OF v`:
--
--   SELECT v.id, v.total_amount_issued - COALESCE(c.total_claimed, 0) AS remaining
--   FROM public.vouchers v
--   LEFT JOIN (SELECT voucher_id, SUM(amount_claimed) ... ) c ON c.voucher_id = v.id
--   WHERE ...
--   FOR UPDATE OF v
--
-- record_voucher_wallet_payment (migration-076, single-voucher path) avoids
-- this by locking the voucher row FIRST with a plain `FOR UPDATE` (no join),
-- then running the voucher_claims SUM as a separate query afterwards -- so
-- the balance read is guaranteed to see every claim committed before the
-- lock was acquired.
--
-- The pooled function's `remaining` is computed as part of the same locked
-- query, before/while the lock is being acquired. Two concurrent payments
-- against overlapping vouchers for the same customer (one pooled, one
-- single, or two pooled) can both compute `remaining` from a snapshot that
-- doesn't yet reflect the other's claim, over-drawing a voucher's balance
-- past what it was actually issued for.
--
-- Fix: split into two steps, matching the single-voucher function's safe
-- ordering -- lock the voucher row first (plain FOR UPDATE, no join), THEN
-- compute its remaining balance in a fresh query. Any concurrent claim
-- against that voucher must already hold or wait for the same row lock, so
-- once we hold it the SUM read is accurate.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.
-- Portable: no hardcoded UUIDs.
--
-- Reversible: re-run migration-090's CREATE OR REPLACE FUNCTION block to
-- restore the prior (racy) version.

CREATE OR REPLACE FUNCTION public.record_voucher_wallet_payment_pooled(
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
  v_caller_org        uuid := get_user_org_id();
  v_actor             uuid := auth.uid();
  v_booking_org       uuid;
  v_branch_id         uuid;
  v_customer_id       uuid;
  v_customer_name     text;
  v_is_locked         boolean;
  v_payment_id        uuid;
  v_remaining         numeric(10,2);
  v_take              numeric(10,2);
  v_voucher_id        uuid;
  v_total_issued      numeric(10,2);
  v_already_claimed   numeric(10,2);
  v_voucher_remaining numeric(10,2);
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'record_voucher_wallet_payment_pooled: must be signed in';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'record_voucher_wallet_payment_pooled: amount must be positive';
  END IF;

  SELECT br.org_id, b.branch_id, b.customer_id, b.customer_name, b.is_locked
    INTO v_booking_org, v_branch_id, v_customer_id, v_customer_name, v_is_locked
  FROM public.bookings b
  JOIN public.branches br ON br.id = b.branch_id
  WHERE b.id = p_booking_id
  FOR UPDATE OF b;

  IF v_booking_org IS NULL THEN
    RAISE EXCEPTION 'record_voucher_wallet_payment_pooled: booking % not found', p_booking_id;
  END IF;
  IF v_booking_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'record_voucher_wallet_payment_pooled: booking is not in your organization';
  END IF;
  IF v_is_locked THEN
    RAISE EXCEPTION 'record_voucher_wallet_payment_pooled: this day has been closed, no further modifications allowed';
  END IF;
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'record_voucher_wallet_payment_pooled: this booking has no linked customer account';
  END IF;

  INSERT INTO public.payments (booking_id, amount, payment_mode, recorded_by, notes)
  VALUES (p_booking_id, p_amount, 'VoucherWallet', v_actor, p_notes)
  RETURNING id INTO v_payment_id;

  v_remaining := p_amount;

  -- Lock soonest-expiring vouchers first (so nothing is left to expire
  -- unused), one row at a time via the cursor's FOR UPDATE -- no join here,
  -- so the lock is acquired against the bare voucher row, exactly like
  -- record_voucher_wallet_payment's single-voucher lock.
  FOR v_voucher_id, v_total_issued IN
    SELECT v.id, v.total_amount_issued
    FROM public.vouchers v
    WHERE v.customer_id = v_customer_id
      AND v.org_id = v_caller_org
      AND v.expiry_date >= (now() AT TIME ZONE 'Asia/Kathmandu')::date
    ORDER BY v.expiry_date ASC, v.created_at ASC
    FOR UPDATE OF v
  LOOP
    EXIT WHEN v_remaining <= 0;

    -- Row is locked now -- re-derive the balance server-side rather than
    -- trusting anything computed before the lock. Any concurrent claim
    -- against this voucher (pooled or single) must already have committed
    -- (and released the lock) or be blocked waiting behind us, so this SUM
    -- is guaranteed accurate.
    SELECT COALESCE(SUM(amount_claimed), 0) INTO v_already_claimed
    FROM public.voucher_claims
    WHERE voucher_id = v_voucher_id;

    v_voucher_remaining := v_total_issued - v_already_claimed;
    IF v_voucher_remaining <= 0 THEN
      CONTINUE;
    END IF;

    v_take := LEAST(v_remaining, v_voucher_remaining);

    INSERT INTO public.voucher_claims (
      voucher_id, org_id, redeemed_date, guest_name_used_by, service_claimed,
      branch_claimed_id, amount_claimed, notes, performed_by, booking_id, payment_id
    )
    VALUES (
      v_voucher_id, v_caller_org, (now() AT TIME ZONE 'Asia/Kathmandu')::date, v_customer_name, NULL,
      v_branch_id, v_take, p_notes, v_actor, p_booking_id, v_payment_id
    );

    v_remaining := round(v_remaining - v_take, 2);
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'record_voucher_wallet_payment_pooled: amount % exceeds combined voucher balance (short by %)',
      p_amount, v_remaining;
  END IF;

  RETURN v_payment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_voucher_wallet_payment_pooled(uuid, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_voucher_wallet_payment_pooled(uuid, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_voucher_wallet_payment_pooled(uuid, numeric, text) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('091', 'fix-voucher-pooled-payment-race')
ON CONFLICT (version) DO NOTHING;
