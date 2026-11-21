-- Migration 388 (ZNLY-221): bookings.room_id becomes nullable.
-- Room-less industries (beauty, enable_rooms = false, mig 246) and a room org's explicit "no room" insert room_id NULL; the NOT NULL
-- in schema.sql made every such booking fail with 23502. All triggers/RPCs that read room_id are already null-safe
-- (check_room_capacity, populate_booking_snapshots, enforce_therapist_for_active_bookings, reschedule_booking, admin_correct_booking).
-- Idempotent. Rollback (manual, only if no NULL rows exist): ALTER TABLE public.bookings ALTER COLUMN room_id SET NOT NULL;
BEGIN;
ALTER TABLE public.bookings ALTER COLUMN room_id DROP NOT NULL;
INSERT INTO public.schema_migrations (version, name)
VALUES ('388', 'bookings-room-id-nullable')
ON CONFLICT (version) DO NOTHING;
COMMIT;
