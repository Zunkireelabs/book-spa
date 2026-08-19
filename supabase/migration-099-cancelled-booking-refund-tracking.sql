-- Migration 099: refund tracking for cancelled bookings
-- (REVERSIBLE — see notes at bottom)
--
-- Bug: cancelling a paid/partial booking (status -> 'Cancelled') never
-- touched bookings.payment_status or the payments table. payments is
-- immutable (payments_booking_id_fkey ... ON DELETE RESTRICT, no UPDATE/
-- DELETE RLS policy), so a paid-then-cancelled booking kept
-- payment_status = 'paid' forever. Every revenue query in api.js filters
-- strictly on payment_status = 'paid' (getDailySummary, closing report,
-- period rollup, getSettledDueHistory, getReferralsReport, therapist
-- performance, staff discount summary) -- so cancelled bookings' payments
-- were still counted as sales.
--
-- Approved business rule:
--   1. Refund is always the full paid amount (no partial refunds).
--   2. Any role that can cancel a booking (staff/manager/admin) can trigger
--      the refund automatically as part of cancellation -- no separate
--      approval step, and it must not depend on every UI/API call site
--      remembering to record it, hence a DB trigger rather than app code.
--   3. 'No Show' does NOT refund -- payment stays 'paid', counts as real
--      revenue. Only the 'Cancelled' status triggers a refund.
--   4. payments rows are never mutated/deleted -- this follows the same
--      append-only ledger precedent as membership_transactions
--      (deposit/deduction kind) and the existing
--      update_booking_payment_status() trigger (schema.sql:332) that
--      already does a payments-insert -> bookings-update cross-table
--      trigger in the opposite direction.
--
-- payment_refunds is deliberately denormalized with org_id (looked up via
-- branches at insert time), matching membership_transactions' own org_id
-- column rather than payments' derive-via-join-to-bookings style -- keeps
-- RLS policies simple and matches this migration's closest sibling table.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- guarded backfill (WHERE NOT EXISTS against payment_refunds).
-- Portable: no hardcoded UUIDs.

-- ============================================================
-- 1. payment_refunds table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.payment_refunds (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  org_id       uuid NOT NULL REFERENCES public.organizations(id),
  amount       numeric(10,2) NOT NULL CHECK (amount > 0),
  refunded_by  uuid REFERENCES public.users(id),
  reason       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_refunds_booking_id ON public.payment_refunds(booking_id);
CREATE INDEX IF NOT EXISTS idx_payment_refunds_org_id ON public.payment_refunds(org_id);

ALTER TABLE public.payment_refunds ENABLE ROW LEVEL SECURITY;

-- Read: mirrors "Staff can read own org payments" on the payments table.
DROP POLICY IF EXISTS "Staff can read own org payment refunds" ON public.payment_refunds;
CREATE POLICY "Staff can read own org payment refunds" ON public.payment_refunds
  FOR SELECT
  TO authenticated
  USING (
    org_id = get_user_org_id()
    AND EXISTS (
      SELECT 1 FROM public.bookings bk
      WHERE bk.id = payment_refunds.booking_id
        AND (bk.branch_id = get_user_branch_id() OR get_user_role() = 'admin')
    )
  );

-- Insert: the BEFORE UPDATE trigger below runs as the cancelling user's own
-- session (no SECURITY DEFINER, matching how update_booking_payment_status()
-- and every other cross-table trigger in this schema runs as invoker), so
-- it needs an INSERT policy for the same staff/manager/admin roles that are
-- allowed to cancel a booking. Mirrors "Staff can record own org payments".
DROP POLICY IF EXISTS "Staff can record own org payment refunds" ON public.payment_refunds;
CREATE POLICY "Staff can record own org payment refunds" ON public.payment_refunds
  FOR INSERT
  TO authenticated
  WITH CHECK (
    org_id = get_user_org_id()
    AND EXISTS (
      SELECT 1 FROM public.bookings bk
      WHERE bk.id = payment_refunds.booking_id
        AND (bk.branch_id = get_user_branch_id() OR get_user_role() = 'admin')
    )
  );

-- No UPDATE/DELETE policy -- refunds are append-only, same as payments.

-- ============================================================
-- 2. Allow payment_status = 'refunded'
-- ============================================================

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS chk_payment_status;
ALTER TABLE public.bookings ADD CONSTRAINT chk_payment_status
  CHECK (payment_status IN ('unpaid', 'partial', 'paid', 'refunded'));

-- ============================================================
-- 3. Auto-refund trigger on cancellation
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_booking_cancellation_refund()
RETURNS trigger AS $$
DECLARE
  v_amount  numeric(10,2);
  v_org_id  uuid;
BEGIN
  IF NEW.status = 'Cancelled'
     AND OLD.status IS DISTINCT FROM 'Cancelled'
     AND OLD.payment_status IN ('paid', 'partial') THEN

    SELECT COALESCE(SUM(amount), 0) INTO v_amount
    FROM public.payments
    WHERE booking_id = NEW.id;

    IF v_amount > 0 THEN
      SELECT br.org_id INTO v_org_id
      FROM public.branches br
      WHERE br.id = NEW.branch_id;

      INSERT INTO public.payment_refunds (booking_id, org_id, amount, refunded_by, reason)
      VALUES (NEW.id, v_org_id, v_amount, auth.uid(), 'Full refund on booking cancellation');

      NEW.payment_status := 'refunded';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

DROP TRIGGER IF EXISTS trg_handle_booking_cancellation_refund ON public.bookings;
CREATE TRIGGER trg_handle_booking_cancellation_refund
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_booking_cancellation_refund();

-- Postgres fires same-event BEFORE triggers in name order, so
-- trg_enforce_booking_immutability runs before trg_handle_booking_cancellation_refund.
-- Order doesn't matter here: the immutability trigger only guards
-- OLD.status = 'Completed' paths, this one only acts on the Cancelled
-- transition -- they never touch the same row state.

-- ============================================================
-- 4. Backfill: bookings already cancelled+paid before this migration
-- ============================================================
-- These are the actual wrong sales numbers the user is currently seeing.
-- Idempotent via WHERE NOT EXISTS against payment_refunds.

WITH to_backfill AS (
  SELECT bk.id AS booking_id, br.org_id, COALESCE(SUM(p.amount), 0) AS amount
  FROM public.bookings bk
  JOIN public.branches br ON br.id = bk.branch_id
  JOIN public.payments p ON p.booking_id = bk.id
  WHERE bk.status = 'Cancelled'
    AND bk.payment_status IN ('paid', 'partial')
    AND NOT EXISTS (
      SELECT 1 FROM public.payment_refunds pr WHERE pr.booking_id = bk.id
    )
  GROUP BY bk.id, br.org_id
  HAVING COALESCE(SUM(p.amount), 0) > 0
),
inserted AS (
  INSERT INTO public.payment_refunds (booking_id, org_id, amount, refunded_by, reason)
  SELECT booking_id, org_id, amount, NULL,
         'backfill: pre-existing cancelled+paid booking, migration-099'
  FROM to_backfill
  RETURNING booking_id
)
UPDATE public.bookings
SET payment_status = 'refunded'
WHERE id IN (SELECT booking_id FROM inserted);

INSERT INTO public.schema_migrations (version, name)
VALUES ('099', 'cancelled-booking-refund-tracking')
ON CONFLICT (version) DO NOTHING;

-- Reversible: to roll back --
--   DROP TRIGGER trg_handle_booking_cancellation_refund ON public.bookings;
--   DROP FUNCTION public.handle_booking_cancellation_refund();
--   UPDATE public.bookings SET payment_status = 'paid'
--     WHERE id IN (SELECT booking_id FROM public.payment_refunds);
--   DROP TABLE public.payment_refunds;
--   ALTER TABLE public.bookings DROP CONSTRAINT chk_payment_status;
--   ALTER TABLE public.bookings ADD CONSTRAINT chk_payment_status
--     CHECK (payment_status IN ('unpaid', 'partial', 'paid'));
