-- Migration 380 (ZNLY-206): a checkout pays once. ONE SECURITY DEFINER function writes the payment rows for ONE booking.
--   * locks the booking row (FOR UPDATE), so two parallel payments queue up instead of both seeing the same balance;
--   * works out what is still owed IN THE DATABASE (final_amount - sum of payments) and refuses a tender above it
--     (change is given in cash at the counter, it is never stored);
--   * takes an idempotency key per checkout attempt: a retry with the same key returns the first result and writes nothing.
-- Wallet / voucher / membership tenders keep their own RPCs (they also move a balance) and are refused here.
-- Staff lose the direct INSERT policy on public.payments: this function (and the existing SECURITY DEFINER RPCs) is the only way in.
-- Rollback (manual): recreate the two "Staff can record ... payments" INSERT policies from migration-340/317, drop the function and table.
-- Applied: stage - / prod HELD.

BEGIN;

CREATE TABLE IF NOT EXISTS public.payment_requests (
  idempotency_key uuid PRIMARY KEY,
  booking_id      uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  payment_ids     uuid[] NOT NULL DEFAULT '{}',
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;   -- no policy: only the function below touches it
REVOKE ALL ON public.payment_requests FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_booking_payment(
  p_booking_id uuid, p_rows jsonb, p_idempotency_key uuid, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid(); v_role user_role := get_user_role(); v_org uuid := get_user_org_id();
  v_b record; v_req record; v_row jsonb; v_mode text; v_amt numeric(10,2);
  v_total numeric(10,2) := 0; v_collected numeric(10,2); v_remaining numeric(10,2); v_ids uuid[] := '{}'; v_id uuid; v_first boolean := true;
BEGIN
  IF v_actor IS NULL OR v_role IS NULL OR v_role NOT IN ('staff', 'manager', 'admin') THEN
    RAISE EXCEPTION 'record_booking_payment: staff, manager, or admin role required';
  END IF;
  IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'record_booking_payment: an idempotency key is required'; END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN RAISE EXCEPTION 'record_booking_payment: rows must be a list'; END IF;

  SELECT b.id, b.branch_id, b.status, b.payment_status, b.final_amount, b.is_locked, br.org_id AS org INTO v_b
    FROM public.bookings b JOIN public.branches br ON br.id = b.branch_id WHERE b.id = p_booking_id FOR UPDATE OF b;
  IF v_b.id IS NULL THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND: booking not found'; END IF;
  IF v_b.org IS DISTINCT FROM v_org
     OR (v_role <> 'admin' AND NOT (v_b.branch_id = ANY ((get_user_branch_ids())::uuid[]))) THEN
    RAISE EXCEPTION 'record_booking_payment: booking is not in your organization or branch';
  END IF;

  -- a retry of the same checkout attempt: hand back the first result (checked after the lock, so a parallel twin waits for it)
  SELECT * INTO v_req FROM public.payment_requests WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_req.booking_id <> p_booking_id THEN RAISE EXCEPTION 'record_booking_payment: this key was used for another booking'; END IF;
    RETURN jsonb_build_object('payment_ids', to_jsonb(v_req.payment_ids), 'replayed', true);
  END IF;

  IF v_b.is_locked THEN RAISE EXCEPTION 'DAY_LOCKED: This day has been closed. No further modifications allowed.'; END IF;

  FOR v_row IN SELECT e FROM jsonb_array_elements(p_rows) e LOOP
    v_mode := btrim(COALESCE(v_row->>'payment_mode', ''));
    v_amt := round(COALESCE((v_row->>'amount')::numeric, -1), 2);
    IF v_mode = '' OR length(v_mode) > 40 THEN RAISE EXCEPTION 'INVALID_PAYMENT_MODE: Invalid payment method.'; END IF;
    IF v_mode IN ('Membership', 'ReferralWallet', 'ReferralVoucher', 'VoucherWallet') THEN
      RAISE EXCEPTION 'INVALID_PAYMENT_MODE: % payments go through their own function.', v_mode;
    END IF;
    IF v_amt < 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT: amount must not be negative'; END IF;
    v_total := v_total + v_amt;
  END LOOP;

  SELECT COALESCE(SUM(amount), 0) INTO v_collected FROM public.payments WHERE booking_id = p_booking_id;
  v_remaining := round(v_b.final_amount - v_collected, 2);

  IF v_total > 0 THEN
    IF v_b.payment_status = 'paid' OR v_remaining <= 0 THEN RAISE EXCEPTION 'ALREADY_PAID: Payment has already been recorded for this booking.'; END IF;
    IF v_b.status NOT IN ('Confirmed', 'In-Progress', 'Completed') THEN
      RAISE EXCEPTION 'INVALID_PAYMENT_STATE: Payment can only be recorded for Confirmed, In-Progress, or Completed bookings.';
    END IF;
    IF v_total > v_remaining THEN RAISE EXCEPTION 'OVERPAYMENT: Payment exceeds the remaining balance.'; END IF;   -- no amounts in the text: price-restricted staff
  ELSIF v_remaining > 0 THEN
    RAISE EXCEPTION 'OVERPAYMENT: a zero payment can only settle a booking with nothing left to pay.';
  END IF;

  -- nothing left to pay and already settled: a zero settle is a no-op
  IF NOT (v_total = 0 AND v_b.payment_status = 'paid') THEN
    FOR v_row IN SELECT e FROM jsonb_array_elements(p_rows) e LOOP
      INSERT INTO public.payments (booking_id, amount, payment_mode, recorded_by, notes)
      VALUES (p_booking_id, round((v_row->>'amount')::numeric, 2), btrim(v_row->>'payment_mode'), v_actor, CASE WHEN v_first THEN p_notes END)
      RETURNING id INTO v_id;
      v_ids := v_ids || v_id; v_first := false;
    END LOOP;
  END IF;

  INSERT INTO public.payment_requests (idempotency_key, booking_id, payment_ids, created_by) VALUES (p_idempotency_key, p_booking_id, v_ids, v_actor);
  RETURN jsonb_build_object('payment_ids', to_jsonb(v_ids), 'replayed', false);
END $$;

REVOKE ALL ON FUNCTION public.record_booking_payment(uuid, jsonb, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_booking_payment(uuid, jsonb, uuid, text) TO authenticated;

-- No direct INSERT on payments any more (every caller in the app now goes through the function above or a group/wallet RPC).
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT polname FROM pg_policy WHERE polrelid = 'public.payments'::regclass AND polcmd = 'a' LOOP
    EXECUTE format('DROP POLICY %I ON public.payments', p.polname);
  END LOOP;
END $$;
REVOKE INSERT ON public.payments FROM anon, authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('380', 'record-booking-payment')
ON CONFLICT (version) DO NOTHING;

COMMIT;
