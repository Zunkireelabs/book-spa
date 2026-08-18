-- Migration 090: pooled voucher wallet payment (additive, REVERSIBLE)
--
-- Product decision: at checkout, a customer's vouchers should behave like
-- Membership/Referral Wallet -- one combined balance, staff just picks
-- "Voucher" and types an amount, no picking a specific voucher code or
-- searching. migration-076 only supported redeeming ONE specific voucher per
-- tender (record_voucher_wallet_payment(booking_id, voucher_id, amount)),
-- which forced staff to search/select each voucher individually even when
-- the booking's own customer already has one or more vouchers linked to
-- their account (migration-082/084).
--
-- record_voucher_wallet_payment_pooled(booking_id, amount, notes) fixes this:
-- it looks up the booking's customer_id itself (no client-supplied customer
-- id to trust), re-derives every linked, non-expired voucher's remaining
-- balance server-side, and greedily draws the requested amount from those
-- vouchers soonest-expiring-first (so nothing is left stranded to expire
-- unused) -- locking every contributing voucher row so a concurrent payment
-- can't race the balance check. One payments row is inserted for the full
-- amount; one voucher_claims row is inserted per voucher actually drawn
-- from, all sharing that payment_id -- same audit trail as today, just
-- possibly split across more than one voucher.
--
-- record_voucher_wallet_payment (single-voucher) and search_vouchers_for_payment
-- are untouched -- still used for a walk-in/gift voucher not linked to this
-- booking's customer, exactly as before.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.
-- Portable: no hardcoded UUIDs.
--
-- Reversible: DROP FUNCTION IF EXISTS public.record_voucher_wallet_payment_pooled(uuid, numeric, text);

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
  v_caller_org      uuid := get_user_org_id();
  v_actor           uuid := auth.uid();
  v_booking_org     uuid;
  v_branch_id       uuid;
  v_customer_id     uuid;
  v_customer_name   text;
  v_is_locked       boolean;
  v_payment_id      uuid;
  v_remaining       numeric(10,2);
  v_take            numeric(10,2);
  v_row             record;
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

  -- Lock and draw down soonest-expiring vouchers first (so nothing is left to
  -- expire unused), locking each row as it's visited via the cursor's FOR
  -- UPDATE (can't combine FOR UPDATE with the SUM() aggregate above in one
  -- query, so the balance check happens implicitly below instead: if the
  -- loop runs out of eligible rows before v_remaining reaches zero, the
  -- exception after the loop rolls back this entire function call, including
  -- the payments insert and every claim already made in this loop).
  FOR v_row IN
    SELECT v.id, v.total_amount_issued - COALESCE(c.total_claimed, 0) AS remaining
    FROM public.vouchers v
    LEFT JOIN (
      SELECT voucher_id, SUM(amount_claimed) AS total_claimed
      FROM public.voucher_claims
      GROUP BY voucher_id
    ) c ON c.voucher_id = v.id
    WHERE v.customer_id = v_customer_id
      AND v.org_id = v_caller_org
      AND v.expiry_date >= (now() AT TIME ZONE 'Asia/Kathmandu')::date
      AND (v.total_amount_issued - COALESCE(c.total_claimed, 0)) > 0
    ORDER BY v.expiry_date ASC, v.created_at ASC
    FOR UPDATE OF v
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_remaining, v_row.remaining);

    INSERT INTO public.voucher_claims (
      voucher_id, org_id, redeemed_date, guest_name_used_by, service_claimed,
      branch_claimed_id, amount_claimed, notes, performed_by, booking_id, payment_id
    )
    VALUES (
      v_row.id, v_caller_org, (now() AT TIME ZONE 'Asia/Kathmandu')::date, v_customer_name, NULL,
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
VALUES ('090', 'voucher-wallet-pooled-payment')
ON CONFLICT (version) DO NOTHING;
