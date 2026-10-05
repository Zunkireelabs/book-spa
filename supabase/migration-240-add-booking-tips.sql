-- Migration 240: booking_tips — customer gratuity, logged for cash-reconciliation/audit
-- visibility only. NOT company revenue: must never be summed into payments.amount,
-- netRevenue, paymentBreakdown, discount %, or payroll service_revenue. No FK/trigger
-- relationship to `payments` or `update_booking_payment_status()` — inserted as a fully
-- independent, second write after recordPayment() succeeds (see PaymentModal.jsx /
-- services/api.js recordTip()). No per-therapist attribution (v1 scope cut — logged
-- against the booking only; who physically receives it is handled outside the app).
-- Insert-only, same immutability policy as `payments` — no UPDATE/DELETE RLS; a
-- mis-entered tip is corrected by hand in the DB (no admin-correction RPC in v1,
-- unlike admin_correct_payment_mode from migration-237).
--
-- Rollback: DROP TABLE IF EXISTS public.booking_tips; (cascades the policies)

BEGIN;

CREATE TABLE IF NOT EXISTS public.booking_tips (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  amount      numeric(10,2) NOT NULL CHECK (amount > 0),
  recorded_by uuid NOT NULL REFERENCES public.users(id),
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_tips_booking_id ON public.booking_tips(booking_id);

ALTER TABLE public.booking_tips ENABLE ROW LEVEL SECURITY;

-- Mirrors payments' current live RLS exactly (confirmed via direct inspection of the
-- staging DB's pg_policies for `payments`): branch-scoped SELECT/INSERT
-- (get_user_branch_ids() OR admin) + admin_viewer org-wide SELECT (get_user_org_id()).
-- No UPDATE/DELETE policy anywhere — immutable, same as payments. Helper calls wrapped
-- in (SELECT ...) per migration-225's InitPlan-hoisting convention (avoids re-evaluating
-- get_user_*() once per row).

DROP POLICY IF EXISTS "Staff can read branch tips" ON public.booking_tips;
CREATE POLICY "Staff can read branch tips"
  ON public.booking_tips FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = booking_tips.booking_id
      AND (b.branch_id = ANY((SELECT get_user_branch_ids())::uuid[]) OR (SELECT get_user_role()) = 'admin')
    )
  );

DROP POLICY IF EXISTS "Staff can record tips" ON public.booking_tips;
CREATE POLICY "Staff can record tips"
  ON public.booking_tips FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = booking_id
      AND (b.branch_id = ANY((SELECT get_user_branch_ids())::uuid[]) OR (SELECT get_user_role()) = 'admin')
    )
  );

DROP POLICY IF EXISTS "Admin viewer can read org tips" ON public.booking_tips;
CREATE POLICY "Admin viewer can read org tips"
  ON public.booking_tips FOR SELECT
  TO authenticated
  USING (
    (SELECT get_user_role()) = 'admin_viewer'
    AND EXISTS (
      SELECT 1 FROM public.bookings bk
      JOIN public.branches br ON br.id = bk.branch_id
      WHERE bk.id = booking_tips.booking_id
      AND br.org_id = (SELECT get_user_org_id())
    )
  );

-- Explicitly no UPDATE / DELETE policy — immutable, append-only, same as payments.

INSERT INTO public.schema_migrations (version, name)
VALUES ('240', 'add-booking-tips')
ON CONFLICT (version) DO NOTHING;

COMMIT;
