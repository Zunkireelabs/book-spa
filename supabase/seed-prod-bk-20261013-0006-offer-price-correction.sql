-- PROD data correction (not a schema migration): booking BK-20261013-0006
-- (Rituza S, Nuad Thai Spa / Lazimpat) was switched mid-booking to service
-- "Festive Offer - Option 1 - 60 min Pain Release + 60 min Standard Facial",
-- which has a flat offer price of NPR 4,999 (offer_type='fixed',
-- offer_value=4999, price_npr=7500). updateBookingDetails() in src/services/api.js
-- had a bug (fixed in this branch) that used the service's raw price_npr
-- instead of its offer/effective price when a service was swapped on an
-- existing booking, so base_amount/final_amount were set to 7,500 and the
-- customer paid NPR 7,500 cash instead of the correct NPR 4,999 — an
-- overcharge of NPR 2,501. Confirmed via audit_logs (base_amount jumped
-- 4200 -> 7500 at the same instant service_id changed to the offer service).
--
-- Run in the PRODUCTION Supabase SQL editor (project pmbvogiphelmpjdalmtv).
-- Idempotent, portable (resolves booking/user by booking_number/email, no
-- hardcoded UUIDs). Payments are immutable (RESTRICT on UPDATE/DELETE) per
-- CLAUDE.md, so the original NPR 7,500 payment row is left untouched and the
-- NPR 2,501 difference is recorded as a payment_refunds row instead.

BEGIN;

-- ============================================================
-- 1. Record the NPR 2,501 overcharge as a refund
-- ============================================================

INSERT INTO public.payment_refunds (booking_id, org_id, amount, refunded_by, reason)
SELECT
  bk.id,
  br.org_id,
  2501.00,
  u.id,
  'Overcharge correction: service was switched to "Festive Offer - Option 1" (flat offer price NPR 4,999) but booking kept the full NPR 7,500 price due to an app bug in updateBookingDetails(). Customer paid NPR 7,500 cash; NPR 2,501 refunded.'
FROM public.bookings bk
JOIN public.branches br ON br.id = bk.branch_id
JOIN public.users u ON u.email = 'subash_tamang@nuadthainepal.com'
WHERE bk.booking_number = 'BK-20261013-0006'
  AND NOT EXISTS (
    SELECT 1 FROM public.payment_refunds pr
    WHERE pr.booking_id = bk.id AND pr.amount = 2501.00
  );

-- ============================================================
-- 2. Correct base_amount / final_amount to the offer price (NPR 4,999)
--    trg_compute_final_amount recomputes final_amount = base_amount - discount_amount.
-- ============================================================

UPDATE public.bookings bk
SET base_amount = 4999.00
WHERE bk.booking_number = 'BK-20261013-0006'
  AND bk.base_amount <> 4999.00;

COMMIT;

-- Verify:
-- SELECT booking_number, base_amount, discount_amount, final_amount
-- FROM public.bookings WHERE booking_number = 'BK-20261013-0006';
--
-- SELECT amount, reason, created_at FROM public.payment_refunds
-- WHERE booking_id = (SELECT id FROM public.bookings WHERE booking_number = 'BK-20261013-0006');
