-- Migration 414 (ZNLY-351): one therapist can never have two overlapping active bookings.
--
-- Rule (owner-approved, every business, every industry): for bookings that START at or after the cutoff
-- (2026-11-22 00:00 Asia/Kathmandu = 2026-11-21 18:15:00+00), a therapist cannot be on two overlapping bookings whose
-- status is not Cancelled / No Show. Back-to-back (end = start) is allowed. Rows that start before the cutoff are never
-- touched or checked: production already holds 182 old overlapping pairs that this migration leaves alone, and they can
-- still be edited (e.g. status -> Completed).
--
-- Why this was missing: excl_therapist_overlap lives only in schema.sql; production was bootstrapped without it
-- (local/staging have it, unrestricted, and keep it: never two guards).
--
-- 1. bookings: excl_therapist_overlap (same name + same error: SQLSTATE 23P01) created only when absent, with the
--    cutoff in its predicate so the old pairs do not block creation.
-- 2. booking_therapists (second therapist of a couple booking): a therapist may sit on two bookings through the junction,
--    which no GiST constraint sees (migration 171 note). enforce_therapist_junction_overlap() refuses it across both
--    bookings.therapist_id and booking_therapists.therapist_id, raising 23P01 too.
-- 3. booking_combo_items: migration 288's two guards, added only when missing (production drift), same cutoff.
--
-- Every existing app path already maps 23P01 to a THERAPIST_CONFLICT message (api.js) / friendlyError.
-- Idempotent: every step is guarded / CREATE OR REPLACE. Reversible (manual):
--   DROP TRIGGER IF EXISTS trg_zz_bookings_therapist_junction_overlap ON public.bookings;
--   DROP TRIGGER IF EXISTS trg_booking_therapists_overlap ON public.booking_therapists;
--   DROP FUNCTION IF EXISTS public.enforce_therapist_junction_overlap();
--   ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS excl_therapist_overlap;  -- prod only; local/stage had it before
--   ALTER TABLE public.booking_combo_items DROP CONSTRAINT IF EXISTS excl_combo_item_therapist_overlap, DROP CONSTRAINT IF EXISTS excl_combo_item_room_overlap;

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- 1. bookings -----------------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'excl_therapist_overlap' AND conrelid = 'public.bookings'::regclass) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT excl_therapist_overlap
      EXCLUDE USING gist (therapist_id WITH =, tstzrange(start_datetime, end_datetime) WITH &&)
      WHERE (therapist_id IS NOT NULL
             AND status NOT IN ('Cancelled', 'No Show')
             AND start_datetime >= '2026-11-21 18:15:00+00'::timestamptz);
  END IF;
END $$;

-- 2. booking_therapists -------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_therapist_junction_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_cutoff constant timestamptz := '2026-11-21 18:15:00+00';
  v_bid uuid; v_tid uuid; v_start timestamptz; v_end timestamptz;
  b record;
BEGIN
  IF TG_TABLE_NAME = 'bookings' THEN
    -- a booking's own therapist against companions of OTHER bookings
    IF NEW.therapist_id IS NULL OR NEW.status IN ('Cancelled', 'No Show')
       OR NEW.date IS NULL OR NEW.start_time IS NULL OR NEW.end_time IS NULL THEN
      RETURN NEW;
    END IF;
    -- from date + time (the source of truth), not start_datetime: the compute trigger that fills it may fire after this one
    v_start := (NEW.date + NEW.start_time) AT TIME ZONE 'Asia/Kathmandu';
    v_end   := (NEW.date + NEW.end_time) AT TIME ZONE 'Asia/Kathmandu';
    IF v_start < c_cutoff THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.therapist_id IS NOT DISTINCT FROM OLD.therapist_id
       AND NEW.date IS NOT DISTINCT FROM OLD.date AND NEW.start_time IS NOT DISTINCT FROM OLD.start_time
       AND NEW.end_time IS NOT DISTINCT FROM OLD.end_time AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
      RETURN NEW;
    END IF;
    v_bid := NEW.id; v_tid := NEW.therapist_id;
    IF EXISTS (
      SELECT 1 FROM public.booking_therapists bt JOIN public.bookings b2 ON b2.id = bt.booking_id
      WHERE bt.therapist_id = v_tid AND b2.id <> v_bid AND b2.status NOT IN ('Cancelled', 'No Show')
        AND tstzrange((b2.date + COALESCE(bt.start_time, b2.start_time)) AT TIME ZONE 'Asia/Kathmandu',
                      (b2.date + COALESCE(bt.end_time, b2.end_time)) AT TIME ZONE 'Asia/Kathmandu') && tstzrange(v_start, v_end)
    ) THEN
      RAISE EXCEPTION 'THERAPIST_CONFLICT: This therapist already has a booking at that time. Pick another time or person.'
        USING ERRCODE = '23P01', CONSTRAINT = 'excl_therapist_overlap';
    END IF;
    RETURN NEW;
  END IF;

  -- booking_therapists row against other bookings (primary) and other junction rows
  SELECT id, date, start_time, end_time, status INTO b FROM public.bookings WHERE id = NEW.booking_id;
  IF b.id IS NULL OR b.status IN ('Cancelled', 'No Show') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.booking_id IS NOT DISTINCT FROM OLD.booking_id
     AND NEW.therapist_id IS NOT DISTINCT FROM OLD.therapist_id
     AND NEW.start_time IS NOT DISTINCT FROM OLD.start_time
     AND NEW.end_time IS NOT DISTINCT FROM OLD.end_time THEN
    RETURN NEW;
  END IF;
  v_start := (b.date + COALESCE(NEW.start_time, b.start_time)) AT TIME ZONE 'Asia/Kathmandu';
  v_end   := (b.date + COALESCE(NEW.end_time, b.end_time)) AT TIME ZONE 'Asia/Kathmandu';
  IF v_start IS NULL OR v_end IS NULL OR v_start < c_cutoff THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.bookings b2
    WHERE b2.therapist_id = NEW.therapist_id AND b2.id <> NEW.booking_id AND b2.status NOT IN ('Cancelled', 'No Show')
      AND tstzrange(b2.start_datetime, b2.end_datetime) && tstzrange(v_start, v_end)
  ) OR EXISTS (
    SELECT 1 FROM public.booking_therapists bt JOIN public.bookings b2 ON b2.id = bt.booking_id
    WHERE bt.therapist_id = NEW.therapist_id AND bt.booking_id <> NEW.booking_id AND b2.status NOT IN ('Cancelled', 'No Show')
      AND tstzrange((b2.date + COALESCE(bt.start_time, b2.start_time)) AT TIME ZONE 'Asia/Kathmandu',
                    (b2.date + COALESCE(bt.end_time, b2.end_time)) AT TIME ZONE 'Asia/Kathmandu') && tstzrange(v_start, v_end)
  ) THEN
    RAISE EXCEPTION 'THERAPIST_CONFLICT: This therapist already has a booking at that time. Pick another time or person.'
      USING ERRCODE = '23P01', CONSTRAINT = 'excl_therapist_overlap';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_therapist_junction_overlap() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_booking_therapists_overlap ON public.booking_therapists;
CREATE TRIGGER trg_booking_therapists_overlap
  BEFORE INSERT OR UPDATE ON public.booking_therapists
  FOR EACH ROW EXECUTE FUNCTION public.enforce_therapist_junction_overlap();

-- named trg_zz_ so it fires AFTER trg_compute_datetimes (BEFORE triggers run in name order) and sees the final end_time
DROP TRIGGER IF EXISTS trg_bookings_therapist_junction_overlap ON public.bookings;
DROP TRIGGER IF EXISTS trg_zz_bookings_therapist_junction_overlap ON public.bookings;
CREATE TRIGGER trg_zz_bookings_therapist_junction_overlap
  BEFORE INSERT OR UPDATE OF therapist_id, date, start_time, end_time, status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_therapist_junction_overlap();

-- 3. booking_combo_items (migration 288 guards, only when missing) ---------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.booking_combo_items') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'excl_combo_item_room_overlap'
                   AND conrelid = 'public.booking_combo_items'::regclass) THEN
      ALTER TABLE public.booking_combo_items ADD CONSTRAINT excl_combo_item_room_overlap
        EXCLUDE USING gist (room_id WITH =, tstzrange(start_datetime, end_datetime) WITH &&)
        WHERE (room_id IS NOT NULL AND start_datetime IS NOT NULL AND start_datetime >= '2026-11-21 18:15:00+00'::timestamptz);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'excl_combo_item_therapist_overlap'
                   AND conrelid = 'public.booking_combo_items'::regclass) THEN
      ALTER TABLE public.booking_combo_items ADD CONSTRAINT excl_combo_item_therapist_overlap
        EXCLUDE USING gist (therapist_id WITH =, tstzrange(start_datetime, end_datetime) WITH &&)
        WHERE (therapist_id IS NOT NULL AND start_datetime IS NOT NULL AND start_datetime >= '2026-11-21 18:15:00+00'::timestamptz);
    END IF;
  END IF;
END $$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('414', 'therapist-overlap-guard')
ON CONFLICT (version) DO NOTHING;

COMMIT;
