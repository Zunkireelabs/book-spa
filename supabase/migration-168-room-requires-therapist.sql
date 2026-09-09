-- Incident fix: staff could not start (In-Progress) or complete Sauna/Steam/Jacuzzi
-- bookings — self-service rooms with no therapist assigned. The blocker was
-- trg_enforce_therapist_required / enforce_therapist_for_active_bookings(), which was
-- applied directly to prod outside any tracked migration and unconditionally requires
-- therapist_id on every In-Progress/Completed booking, with no notion of room type.
-- A frontend-only hotfix (BookingActionModal.jsx) relaxed the Start button for Thamel
-- only, but never stopped this trigger from firing.
--
-- Fix: give rooms a real requires_therapist flag, backfill it false for self-service
-- room types across all branches, and make the trigger respect it. DROP+CREATE the
-- trigger (idempotent) so this applies cleanly whether or not an environment already
-- has the untracked prod version.

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS requires_therapist boolean NOT NULL DEFAULT true;

UPDATE rooms
SET requires_therapist = false
WHERE UPPER(TRIM(name)) IN ('JACUZZI', 'SAUNA', 'STEAM');

CREATE OR REPLACE FUNCTION public.enforce_therapist_for_active_bookings()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status IN ('In-Progress', 'Completed')
     AND NEW.therapist_id IS NULL
     AND COALESCE((SELECT r.requires_therapist FROM rooms r WHERE r.id = NEW.room_id), true) THEN
    RAISE EXCEPTION
      'THERAPIST_REQUIRED: Bookings with status "%" must have a therapist assigned.',
      NEW.status
      USING ERRCODE = 'P0003';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_therapist_required ON public.bookings;

CREATE TRIGGER trg_enforce_therapist_required
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_therapist_for_active_bookings();

INSERT INTO public.schema_migrations (version, name)
VALUES ('168', 'room-requires-therapist')
ON CONFLICT (version) DO NOTHING;
