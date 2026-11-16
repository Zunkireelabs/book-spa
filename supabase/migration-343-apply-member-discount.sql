-- Migration 343: apply_member_discount(): a membership tier's discount, applied at checkout
-- Idempotent: safe to re-run in either database. (343 is the local number; check the next free one on origin/stage before the PR.)
--
-- WHY
--   membership_tiers.discount_rules (e.g. Premium Club {"spa":45,"salon":25,"body_scrub":30,"package":10}) were never applied
--   to bookings: migration-045 left that for a "future v2", and only NewVoucherPanel reads them. Checkout (PaymentModal) now
--   shows the member rate automatically; this function is the only thing that saves it.
--
--   It is an RPC and not applyDiscount() on purpose: the rate comes only from the tier, never from the client, so the staff
--   discount limit (DISCOUNT_LIMITS, 50% for now, 15% normally) must not block or route it to approval.
--
-- WHAT
--   bookings.member_discount text NULL ('applied' | 'declined'): whether the booking's member discount was saved or staff
--   chose not to apply it this visit. NULL = undecided (checkout applies it automatically). This column, not the reason
--   text, is what "is this a member discount" means. A manual discount through applyDiscount() resets it to NULL.
--
--   apply_member_discount(p_booking_id, p_remove DEFAULT false), SECURITY DEFINER, EXECUTE for authenticated only.
--   Caller: staff / manager / admin of the booking's org, with access to its branch (same rule as the bookings UPDATE policy,
--   migration-340). Booking: not locked, not Cancelled / No Show, not paid.
--   * apply (p_remove = false): the customer's latest membership must be active at Nepal today (money in the wallet, activated
--     or fully deposited, not past its expiry); the service's category, normalised like the JS (lower, trim, spaces/dashes → _),
--     must have a 1–100 rule ('package' is for vouchers and never matches). Sets discount_amount = round(base × pct / 100, 2),
--     capped so final_amount never drops below what has already been paid; discount_status 'approved', approved_by = caller,
--     reason '<Tier> member · <pct>% <category>'; clears the requested_by / requested_to fields; recomputes payment_status the
--     same way applyDiscount() does; member_discount = 'applied'. Replaces any existing discount (checkout only offers it
--     when it saves the guest more).
--     Calling it twice gives the same result. A 100% discount with nothing paid gets the same zero 'No Charge' payment that
--     applyDiscount() inserts, so the booking settles.
--   * remove (p_remove = true): records member_discount = 'declined' ("don't apply it this visit"). If the saved discount is
--     the member one (member_discount = 'applied') it is also cleared back to no discount; any other discount is left alone.
--     Works when nothing was saved yet, too. Writes a MEMBER_DISCOUNT_DECLINED row to audit_logs (on top of the
--     DISCOUNT_CHANGE row the booking audit trigger writes whenever the amount changes).
--   Errors are raised with a code prefix (MEMBER_DISCOUNT_FORBIDDEN, BOOKING_NOT_FOUND, DAY_LOCKED, BOOKING_IMMUTABLE,
--   NOT_A_MEMBER, MEMBERSHIP_NOT_ACTIVE, NO_MEMBER_RATE, NOTHING_TO_DISCOUNT).
--
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.apply_member_discount(uuid, boolean);
--   ALTER TABLE public.bookings DROP COLUMN IF EXISTS member_discount;
--   DELETE FROM public.schema_migrations WHERE version = '343';

BEGIN;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS member_discount text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_member_discount_check' AND conrelid = 'public.bookings'::regclass) THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_member_discount_check CHECK (member_discount IN ('applied', 'declined'));
  END IF;
END $$;
COMMENT ON COLUMN public.bookings.member_discount IS
  'V22: applied = the membership tier discount was saved by apply_member_discount(); declined = staff chose not to apply it this visit; NULL = undecided.';

CREATE OR REPLACE FUNCTION public.apply_member_discount(p_booking_id uuid, p_remove boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid    := auth.uid();
  v_role       text    := (SELECT get_user_role())::text;
  v_org        uuid    := (SELECT get_user_org_id());
  v_branches   uuid[]  := (SELECT get_user_branch_ids())::uuid[];
  v_today      date    := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  v_b          record;
  v_m          record;
  v_paid       numeric := 0;
  v_key        text;
  v_pct        numeric;
  v_full       numeric;
  v_amount     numeric;
  v_new_final  numeric;
  v_reason     text;
BEGIN
  IF v_uid IS NULL OR v_role IS NULL OR v_role NOT IN ('staff', 'manager', 'admin') THEN
    RAISE EXCEPTION 'MEMBER_DISCOUNT_FORBIDDEN: only staff, managers and admins can change a member discount.' USING ERRCODE = '42501';
  END IF;

  SELECT b.id, b.branch_id, b.customer_id, b.status, b.is_locked, b.payment_status, b.base_amount,
         b.discount_amount, b.discount_status, b.discount_reason, b.member_discount, br.org_id, s.category
    INTO v_b
    FROM public.bookings b
    JOIN public.branches br ON br.id = b.branch_id
    LEFT JOIN public.services s ON s.id = b.service_id
   WHERE b.id = p_booking_id
     FOR UPDATE OF b;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND: booking % not found.', p_booking_id USING ERRCODE = 'P0002';
  END IF;

  -- Same access as the bookings UPDATE policy (migration-340): the caller's org, and a branch they work at (admins: any branch of the org).
  IF v_b.org_id IS DISTINCT FROM v_org OR NOT (v_b.branch_id = ANY (v_branches) OR v_role = 'admin') THEN
    RAISE EXCEPTION 'MEMBER_DISCOUNT_FORBIDDEN: this booking is not in your branch.' USING ERRCODE = '42501';
  END IF;
  IF v_b.is_locked THEN
    RAISE EXCEPTION 'DAY_LOCKED: This day has been closed. No further modifications allowed.' USING ERRCODE = 'P0001';
  END IF;
  IF v_b.status::text IN ('Cancelled', 'No Show') THEN
    RAISE EXCEPTION 'BOOKING_IMMUTABLE: % bookings cannot be modified.', v_b.status USING ERRCODE = 'P0001';
  END IF;
  IF v_b.payment_status = 'paid' THEN
    RAISE EXCEPTION 'BOOKING_IMMUTABLE: Cannot modify discount on a paid booking.' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(SUM(p.amount), 0) INTO v_paid FROM public.payments p WHERE p.booking_id = p_booking_id;

  -- ── Decline (p_remove) ────────────────────────────────────────────────────────────────────────────
  IF p_remove THEN
    IF v_b.member_discount = 'applied' THEN
      UPDATE public.bookings
         SET discount_amount       = 0,
             discount_status       = 'none',
             discount_reason       = NULL,
             discount_approved_by  = NULL,
             discount_requested_by = NULL,
             discount_requested_to = NULL,
             member_discount       = 'declined',
             payment_status        = CASE WHEN v_paid <= 0 THEN 'unpaid' WHEN v_paid >= v_b.base_amount THEN 'paid' ELSE 'partial' END
       WHERE id = p_booking_id;
    ELSE
      UPDATE public.bookings SET member_discount = 'declined' WHERE id = p_booking_id;   -- any other discount stays as it is
    END IF;

    INSERT INTO public.audit_logs (branch_id, table_name, record_id, action_type, old_data, new_data, changed_by, reason)
    VALUES (v_b.branch_id, 'bookings', p_booking_id, 'MEMBER_DISCOUNT_DECLINED',
            jsonb_build_object('member_discount', v_b.member_discount, 'discount_amount', v_b.discount_amount, 'discount_reason', v_b.discount_reason),
            jsonb_build_object('member_discount', 'declined',
                               'discount_amount', CASE WHEN v_b.member_discount = 'applied' THEN 0 ELSE v_b.discount_amount END),
            v_uid, 'Member discount not applied this visit');

    RETURN jsonb_build_object('declined', true, 'cleared', COALESCE(v_b.member_discount = 'applied', false),
                              'discount_amount', CASE WHEN v_b.member_discount = 'applied' THEN 0 ELSE v_b.discount_amount END);
  END IF;

  -- ── Apply ─────────────────────────────────────────────────────────────────────────────────────────
  IF v_b.customer_id IS NULL THEN
    RAISE EXCEPTION 'NOT_A_MEMBER: this booking has no customer with a membership.' USING ERRCODE = 'P0001';
  END IF;

  SELECT m.balance, m.activation_date, m.expiry_date, m.total_deposited, t.name AS tier_name, t.advance_amount, t.discount_rules
    INTO v_m
    FROM public.memberships m
    JOIN public.membership_tiers t ON t.id = m.tier_id
   WHERE m.customer_id = v_b.customer_id
     AND m.org_id = v_b.org_id
   ORDER BY m.created_at DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_A_MEMBER: this customer has no membership.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT (COALESCE(v_m.balance, 0) > 0
          AND ((v_m.activation_date IS NOT NULL AND (v_m.expiry_date IS NULL OR v_m.expiry_date >= v_today))
               OR (v_m.activation_date IS NULL AND v_m.total_deposited >= v_m.advance_amount))) THEN
    RAISE EXCEPTION 'MEMBERSHIP_NOT_ACTIVE: the membership is not active (pending, lapsed or used up).' USING ERRCODE = 'P0001';
  END IF;

  v_key := regexp_replace(lower(btrim(COALESCE(v_b.category, ''))), '[[:space:]-]+', '_', 'g');
  IF v_key = '' OR v_key = 'package' OR jsonb_typeof(v_m.discount_rules -> v_key) IS NULL
     OR jsonb_typeof(v_m.discount_rules -> v_key) NOT IN ('number', 'string') THEN
    RAISE EXCEPTION 'NO_MEMBER_RATE: % has no discount for % services.', v_m.tier_name, COALESCE(NULLIF(v_b.category, ''), 'these') USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    v_pct := (v_m.discount_rules ->> v_key)::numeric;
  EXCEPTION WHEN others THEN
    v_pct := NULL;
  END;
  IF v_pct IS NULL OR v_pct < 1 OR v_pct > 100 THEN
    RAISE EXCEPTION 'NO_MEMBER_RATE: % has no valid discount for % services.', v_m.tier_name, v_b.category USING ERRCODE = 'P0001';
  END IF;

  v_full   := round(v_b.base_amount * v_pct / 100, 2);
  v_amount := LEAST(v_full, GREATEST(v_b.base_amount - v_paid, 0));   -- never below what has already been paid
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'NOTHING_TO_DISCOUNT: what has already been paid covers this booking.' USING ERRCODE = 'P0001';
  END IF;

  v_new_final := v_b.base_amount - v_amount;
  v_reason := v_m.tier_name || ' member · '
              || CASE WHEN v_pct = trunc(v_pct) THEN trunc(v_pct)::text ELSE v_pct::text END
              || '% ' || replace(v_key, '_', ' ');

  UPDATE public.bookings
     SET discount_amount       = v_amount,
         discount_status       = 'approved',
         discount_approved_by  = v_uid,
         discount_requested_by = NULL,
         discount_requested_to = NULL,
         discount_reason       = v_reason,
         member_discount       = 'applied',
         payment_status        = CASE WHEN v_paid <= 0 THEN 'unpaid' WHEN v_paid >= v_new_final THEN 'paid' ELSE 'partial' END
   WHERE id = p_booking_id;

  -- Same as applyDiscount(): a 100% discount with nothing paid settles with a zero 'No Charge' payment.
  IF v_new_final <= 0 AND v_paid <= 0 THEN
    INSERT INTO public.payments (booking_id, amount, payment_mode, recorded_by, notes)
    VALUES (p_booking_id, 0, 'No Charge', v_uid, 'Auto-settled — 100% member discount leaves no balance due');
  END IF;

  RETURN jsonb_build_object('discount_amount', v_amount, 'final_amount', v_new_final, 'pct', v_pct,
                            'reason', v_reason, 'capped', v_amount < v_full, 'already_paid', v_paid);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_member_discount(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_member_discount(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.apply_member_discount(uuid, boolean) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('343', 'apply-member-discount')
ON CONFLICT (version) DO NOTHING;

COMMIT;
