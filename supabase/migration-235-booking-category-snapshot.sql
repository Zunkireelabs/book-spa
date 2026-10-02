-- Migration 235: service_category_snapshot on bookings
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + backfill only where NULL.
-- Additive, reversible (manual): DROP COLUMN public.bookings.service_category_snapshot.
-- Portable: no hardcoded UUIDs.
--
--
-- Why this exists
--
-- The Sales by Category dashboard report (getCategoryRevenueByBranch(), api.js)
-- grouped bookings by joining bookings.service_id -> services.category live at
-- query time. That means recategorizing a service (or deleting it) silently
-- rewrites history: a booking made in September under "Massage" starts showing
-- under "Wellness" in the report the moment someone edits the service's category
-- in October, with no indication anything changed. Every other historical field
-- on a booking (service name, duration, price) is already snapshotted at
-- booking time (service_name_snapshot / service_duration_snapshot /
-- service_price_snapshot, Phase 9A) for exactly this reason. Category was
-- missed because the report was added after that snapshot work, in a separate
-- later change. This migration closes that gap the same way.
--
--
-- Backfill note
--
-- Existing rows get a best-effort backfill from the service's *current*
-- category, since no snapshot existed before now -- this is not perfectly
-- accurate for any booking whose service has already been recategorized, but
-- it's the best available data and stops further drift going forward. Rows
-- whose service_id has since been deleted stay NULL (same pre-existing gap
-- service_name_snapshot has for deleted services) and the application falls
-- back to "Uncategorized", mirroring the service-revenue report's existing
-- "Unknown Service" fallback for the same situation.
--
-- Locked (day-closed) rows are excluded from the backfill entirely --
-- trg_enforce_booking_immutability (schema.sql:350) raises DAY_LOCKED for any
-- UPDATE to a row with is_locked = true, unconditionally, which would abort
-- this whole statement. migration-158 hit this same wall for its
-- titlecase-name backfill and solved it the same way: exclude locked rows
-- from the WHERE clause rather than disabling/bypassing the trigger --
-- migration-232 already establishes is_locked as deliberately
-- "not correctable." Locked bookings simply keep service_category_snapshot
-- NULL and fall back to "Uncategorized" in the report, same as the
-- deleted-service case above.
--
-- Same wall, second trigger: trg_enforce_therapist_required
-- (enforce_therapist_for_active_bookings(), migration-168) blocks any UPDATE
-- to a row whose *current* state is status IN ('In-Progress','Completed') +
-- therapist_id IS NULL + the room requires a therapist (requires_therapist
-- defaults true) -- it checks row state, not which columns changed, so the
-- backfill trips it too. The WHERE clause below mirrors the trigger's exact
-- condition so only rows that would actually fail are skipped -- self-service
-- Sauna/Steam/Jacuzzi bookings (requires_therapist = false) still get
-- backfilled. Skipped rows keep service_category_snapshot NULL, same
-- "Uncategorized" fallback as above.

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS service_category_snapshot text;

UPDATE public.bookings
SET service_category_snapshot = services.category
FROM public.services
WHERE bookings.service_id = services.id
  AND bookings.service_category_snapshot IS NULL
  AND bookings.is_locked IS NOT TRUE
  AND NOT (
    bookings.status IN ('In-Progress', 'Completed')
    AND bookings.therapist_id IS NULL
    AND COALESCE((SELECT r.requires_therapist FROM rooms r WHERE r.id = bookings.room_id), true)
  );

INSERT INTO public.schema_migrations (version, name)
VALUES ('235', 'booking-category-snapshot')
ON CONFLICT (version) DO NOTHING;
