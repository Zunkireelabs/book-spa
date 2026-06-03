-- Migration 026: Allow discount edits on Completed-but-UNPAID bookings
--
-- Problem: enforce_booking_immutability() froze ALL discount changes the moment a
-- booking became 'Completed', but the app (applyDiscount) intentionally allows
-- discounting a completed-but-unpaid booking (standard cash-spa flow: finish service
-- -> settle/discount -> take payment). The mismatch surfaced as
-- "BOOKING_IMMUTABLE: Completed bookings cannot be modified." on the Discount tab.
--
-- Fix: keep structural fields (status, base_amount, therapist_id) frozen on completion,
-- but allow discount_amount / discount_status to change until payment_status = 'paid'.

CREATE OR REPLACE FUNCTION enforce_booking_immutability()
RETURNS TRIGGER AS $$
BEGIN
  -- Locked bookings: no changes at all
  IF OLD.is_locked = true THEN
    RAISE EXCEPTION 'DAY_LOCKED: This day has been closed. No further modifications allowed.'
      USING ERRCODE = 'P0001';
  END IF;

  IF OLD.status = 'Completed' THEN
    -- Structural fields are always immutable once completed
    IF (
      NEW.status IS DISTINCT FROM OLD.status
      OR NEW.base_amount IS DISTINCT FROM OLD.base_amount
      OR NEW.therapist_id IS DISTINCT FROM OLD.therapist_id
    ) THEN
      RAISE EXCEPTION 'BOOKING_IMMUTABLE: Completed bookings cannot be modified.'
        USING ERRCODE = 'P0002';
    END IF;

    -- Discounts stay editable until payment is taken; once paid, frozen
    IF OLD.payment_status = 'paid' AND (
      NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
      OR NEW.discount_status IS DISTINCT FROM OLD.discount_status
    ) THEN
      RAISE EXCEPTION 'BOOKING_IMMUTABLE: Cannot modify discount on a paid booking.'
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public;
