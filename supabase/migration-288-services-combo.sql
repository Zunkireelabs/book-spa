-- Migration 288: fold combo packages into services
--
-- A prior session built a combo-package schema directly via SQL/dashboard
-- (combo_packages, combo_package_components, booking_combo_items,
-- bookings.combo_package_id, plus 3 trigger functions) — never tracked as a
-- migration file, so prod never got it and CI's RLS sweep (migration-281) had to
-- special-case it. This migration:
--
--   1. Brings that untracked schema under version control (idempotent — on
--      staging, where it already exists, every statement below is a no-op or a
--      safe repoint; on prod, it creates the schema fresh).
--   2. Restructures it per product decision: a combo is a SERVICE (services.is_combo
--      = true), not a separate catalog entity. combo_package_components now
--      references services(id) directly (renamed combo_service_id) instead of a
--      standalone combo_packages row. bookings.combo_package_id is dropped —
--      bookings.service_id already points at the combo service when is_combo=true,
--      so a second "which combo" column was redundant. combo_packages itself is
--      dropped (services.price_npr/offer_* already cover what it stored:
--      name/description/price/discount/is_active all exist on services).
--   3. Adds two per-component DEFAULTS admins set when defining the combo, so the
--      booking flow has sensible prefills (not DB-enforced — staff can still
--      override per booking): default_timing ('sequential' = starts after the
--      previous component ends, 'concurrent' = starts alongside it, needing its own
--      staff) and default_same_staff (prefill the same therapist as the booking's
--      primary, or require picking a separate one).
--
-- booking_combo_items (the per-booking instance table), its 3 trigger functions,
-- and its conflict-prevention exclusion constraints are untouched — they already
-- work against `service_id` + `therapist_id` + `start_time`/`end_time` per
-- component row, which is exactly the "same or different staff, same or different
-- time frame" mechanic this feature needs, and never referenced combo_packages.
--
-- All 3 combo tables are confirmed empty on staging (checked before writing this
-- migration) — safe to restructure without a data-migration step.
--
-- Idempotent: guarded with IF EXISTS/IF NOT EXISTS and information_schema checks
-- throughout so re-running this file on either database is always safe.
--
-- Reversible (manual, staging only — prod never had the old shape):
--   ALTER TABLE combo_package_components RENAME COLUMN combo_service_id TO combo_package_id;
--   ALTER TABLE combo_package_components DROP COLUMN IF EXISTS default_timing;
--   ALTER TABLE combo_package_components DROP COLUMN IF EXISTS default_same_staff;
--   ALTER TABLE services DROP COLUMN IF EXISTS is_combo;
--   -- then recreate combo_packages and its FKs/policies from the pre-288 shape.

BEGIN;

-- ============================================================
-- 1. services.is_combo
-- ============================================================

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS is_combo boolean NOT NULL DEFAULT false;

-- ============================================================
-- 2. combo_package_components — only create if this environment doesn't already
--    have the untracked schema (prod). On staging this whole block is skipped.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.combo_package_components (
  id             uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  combo_service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  service_id     uuid NOT NULL REFERENCES public.services(id),
  display_order  integer NOT NULL DEFAULT 0,
  default_timing text NOT NULL DEFAULT 'sequential' CHECK (default_timing IN ('sequential', 'concurrent')),
  default_same_staff boolean NOT NULL DEFAULT true,
  CONSTRAINT uq_combo_component_service UNIQUE (combo_service_id, service_id)
);

-- Repoint the pre-existing (staging) table from combo_packages to services, if it's
-- still in its old shape. Guarded on the old column name so this is a no-op once run.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'combo_package_components' AND column_name = 'combo_package_id'
  ) THEN
    ALTER TABLE public.combo_package_components RENAME COLUMN combo_package_id TO combo_service_id;

    ALTER TABLE public.combo_package_components
      DROP CONSTRAINT IF EXISTS combo_package_components_combo_package_id_fkey;
    ALTER TABLE public.combo_package_components
      ADD CONSTRAINT combo_package_components_combo_service_id_fkey
      FOREIGN KEY (combo_service_id) REFERENCES public.services(id) ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE public.combo_package_components
  ADD COLUMN IF NOT EXISTS default_timing text NOT NULL DEFAULT 'sequential';
ALTER TABLE public.combo_package_components
  DROP CONSTRAINT IF EXISTS combo_package_components_default_timing_check;
ALTER TABLE public.combo_package_components
  ADD CONSTRAINT combo_package_components_default_timing_check CHECK (default_timing IN ('sequential', 'concurrent'));

ALTER TABLE public.combo_package_components
  ADD COLUMN IF NOT EXISTS default_same_staff boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_combo_package_components_combo ON public.combo_package_components(combo_service_id);

ALTER TABLE public.combo_package_components ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin can manage combo components" ON public.combo_package_components;
CREATE POLICY "Admin can manage combo components"
  ON public.combo_package_components FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.services s
      WHERE s.id = combo_package_components.combo_service_id
        AND s.org_id = get_user_org_id()
        AND get_user_role() = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.services s
      WHERE s.id = combo_package_components.combo_service_id
        AND s.org_id = get_user_org_id()
        AND get_user_role() = 'admin'
    )
  );

DROP POLICY IF EXISTS "Anonymous can read active combo components" ON public.combo_package_components;
CREATE POLICY "Anonymous can read active combo components"
  ON public.combo_package_components FOR SELECT
  TO anon
  USING (
    EXISTS (SELECT 1 FROM public.services s WHERE s.id = combo_package_components.combo_service_id AND s.is_active = true)
  );

DROP POLICY IF EXISTS "Users can read own org combo components" ON public.combo_package_components;
CREATE POLICY "Users can read own org combo components"
  ON public.combo_package_components FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.services s WHERE s.id = combo_package_components.combo_service_id AND s.org_id = get_user_org_id())
  );

DROP POLICY IF EXISTS "customer reads own org combo components" ON public.combo_package_components;
CREATE POLICY "customer reads own org combo components"
  ON public.combo_package_components FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.services s
      WHERE s.id = combo_package_components.combo_service_id
        AND s.org_id IN (SELECT ca.org_id FROM public.customer_accounts ca WHERE ca.auth_user_id = auth.uid())
    )
  );

-- ============================================================
-- 3. booking_combo_items — create if missing (prod); untouched if present (staging).
--    Same shape the prior session already built: one row per component actually
--    booked, its own therapist/room/time, auto-computed end_time, and exclusion
--    constraints that prevent a double-booked therapist/room across this table,
--    booking_therapists, AND plain bookings all at once.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.booking_combo_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id         uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  component_id       uuid REFERENCES public.combo_package_components(id) ON DELETE SET NULL,
  service_id         uuid NOT NULL REFERENCES public.services(id),
  therapist_id       uuid REFERENCES public.therapists(id),
  room_id            uuid REFERENCES public.rooms(id),
  display_order      integer NOT NULL DEFAULT 0,
  date               date,
  start_time         time,
  end_time           time,
  start_datetime     timestamptz,
  end_datetime       timestamptz,
  commission_weight  numeric(10,2) NOT NULL DEFAULT 1,
  base_share_amount  numeric(10,2) NOT NULL DEFAULT 0,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_combo_items_booking ON public.booking_combo_items(booking_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'excl_combo_item_room_overlap'
  ) THEN
    ALTER TABLE public.booking_combo_items
      ADD CONSTRAINT excl_combo_item_room_overlap
      EXCLUDE USING gist (room_id WITH =, tstzrange(start_datetime, end_datetime) WITH &&)
      WHERE (room_id IS NOT NULL AND start_datetime IS NOT NULL);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'excl_combo_item_therapist_overlap'
  ) THEN
    ALTER TABLE public.booking_combo_items
      ADD CONSTRAINT excl_combo_item_therapist_overlap
      EXCLUDE USING gist (therapist_id WITH =, tstzrange(start_datetime, end_datetime) WITH &&)
      WHERE (therapist_id IS NOT NULL AND start_datetime IS NOT NULL);
  END IF;
END $$;

ALTER TABLE public.booking_combo_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can manage own org combo items" ON public.booking_combo_items;
CREATE POLICY "Staff can manage own org combo items"
  ON public.booking_combo_items FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b JOIN public.branches br ON br.id = b.branch_id
      WHERE b.id = booking_combo_items.booking_id AND br.org_id = get_user_org_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bookings b JOIN public.branches br ON br.id = b.branch_id
      WHERE b.id = booking_combo_items.booking_id AND br.org_id = get_user_org_id()
    )
  );

DROP POLICY IF EXISTS "Staff can read own org combo items" ON public.booking_combo_items;
CREATE POLICY "Staff can read own org combo items"
  ON public.booking_combo_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b JOIN public.branches br ON br.id = b.branch_id
      WHERE b.id = booking_combo_items.booking_id AND br.org_id = get_user_org_id()
    )
  );

DROP POLICY IF EXISTS "customer reads own booking combo items" ON public.booking_combo_items;
CREATE POLICY "customer reads own booking combo items"
  ON public.booking_combo_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = booking_combo_items.booking_id
        AND b.customer_account_id IN (SELECT ca.id FROM public.customer_accounts ca WHERE ca.auth_user_id = auth.uid())
    )
  );

CREATE OR REPLACE FUNCTION public.compute_combo_item_datetimes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $func$
DECLARE
  svc_duration integer;
BEGIN
  IF NEW.date IS NULL OR NEW.start_time IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT duration_minutes INTO svc_duration FROM services WHERE id = NEW.service_id;
  IF svc_duration IS NULL THEN
    RAISE EXCEPTION 'Service not found: %', NEW.service_id;
  END IF;

  NEW.end_time := NEW.start_time + (svc_duration * interval '1 minute');

  IF NEW.end_time <= NEW.start_time THEN
    RAISE EXCEPTION 'BOOKING_CROSSES_MIDNIGHT: A %-minute component starting at % would extend past midnight — please choose an earlier start time.',
      svc_duration, to_char(NEW.start_time, 'HH12:MI AM');
  END IF;

  NEW.start_datetime := (NEW.date + NEW.start_time) AT TIME ZONE 'Asia/Kathmandu';
  NEW.end_datetime := (NEW.date + NEW.end_time) AT TIME ZONE 'Asia/Kathmandu';

  RETURN NEW;
END;
$func$;

CREATE OR REPLACE FUNCTION public.check_booking_combo_item_room_capacity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $func$
DECLARE
  v_capacity integer;
  v_occupied integer;
  v_booking_status text;
BEGIN
  IF NEW.room_id IS NULL OR NEW.start_datetime IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT status INTO v_booking_status FROM bookings WHERE id = NEW.booking_id;
  IF v_booking_status IN ('Cancelled', 'No Show') THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(NEW.room_id::text || NEW.date::text));

  SELECT capacity INTO v_capacity FROM rooms WHERE id = NEW.room_id;

  SELECT
    (SELECT count(*)
       FROM bookings b
       WHERE b.room_id = NEW.room_id
         AND b.status NOT IN ('Cancelled', 'No Show')
         AND tstzrange(b.start_datetime, b.end_datetime) && tstzrange(NEW.start_datetime, NEW.end_datetime))
    +
    (SELECT count(*)
       FROM booking_therapists bt
       JOIN bookings b2 ON b2.id = bt.booking_id
       WHERE bt.room_id = NEW.room_id
         AND b2.status NOT IN ('Cancelled', 'No Show')
         AND tstzrange(
               (b2.date + COALESCE(bt.start_time, b2.start_time)) AT TIME ZONE 'Asia/Kathmandu',
               (b2.date + COALESCE(bt.end_time, b2.end_time)) AT TIME ZONE 'Asia/Kathmandu'
             ) && tstzrange(NEW.start_datetime, NEW.end_datetime))
    +
    (SELECT count(*)
       FROM booking_combo_items bci
       JOIN bookings b3 ON b3.id = bci.booking_id
       WHERE bci.room_id = NEW.room_id
         AND b3.status NOT IN ('Cancelled', 'No Show')
         AND (TG_OP = 'INSERT' OR bci.id != NEW.id)
         AND bci.start_datetime IS NOT NULL
         AND tstzrange(bci.start_datetime, bci.end_datetime) && tstzrange(NEW.start_datetime, NEW.end_datetime))
  INTO v_occupied;

  IF v_occupied >= COALESCE(v_capacity, 1) THEN
    RAISE EXCEPTION 'ROOM_AT_CAPACITY: Room is fully booked for this time range.'
      USING ERRCODE = 'P0003';
  END IF;

  RETURN NEW;
END;
$func$;

CREATE OR REPLACE FUNCTION public.check_booking_combo_item_therapist_conflict()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $func$
DECLARE
  v_conflict_count integer;
  v_booking_status text;
BEGIN
  IF NEW.therapist_id IS NULL OR NEW.start_datetime IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT status INTO v_booking_status FROM bookings WHERE id = NEW.booking_id;
  IF v_booking_status IN ('Cancelled', 'No Show') THEN
    RETURN NEW;
  END IF;

  SELECT
    (SELECT count(*)
       FROM bookings b
       WHERE b.therapist_id = NEW.therapist_id
         AND b.status NOT IN ('Cancelled', 'No Show')
         AND b.id != NEW.booking_id
         AND tstzrange(b.start_datetime, b.end_datetime) && tstzrange(NEW.start_datetime, NEW.end_datetime))
    +
    (SELECT count(*)
       FROM booking_therapists bt
       JOIN bookings b2 ON b2.id = bt.booking_id
       WHERE bt.therapist_id = NEW.therapist_id
         AND b2.status NOT IN ('Cancelled', 'No Show')
         AND bt.booking_id != NEW.booking_id
         AND tstzrange(
               (b2.date + COALESCE(bt.start_time, b2.start_time)) AT TIME ZONE 'Asia/Kathmandu',
               (b2.date + COALESCE(bt.end_time, b2.end_time)) AT TIME ZONE 'Asia/Kathmandu'
             ) && tstzrange(NEW.start_datetime, NEW.end_datetime))
    +
    (SELECT count(*)
       FROM booking_combo_items bci
       JOIN bookings b3 ON b3.id = bci.booking_id
       WHERE bci.therapist_id = NEW.therapist_id
         AND b3.status NOT IN ('Cancelled', 'No Show')
         AND (TG_OP = 'INSERT' OR bci.id != NEW.id)
         AND bci.start_datetime IS NOT NULL
         AND tstzrange(bci.start_datetime, bci.end_datetime) && tstzrange(NEW.start_datetime, NEW.end_datetime))
  INTO v_conflict_count;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'THERAPIST_CONFLICT: Therapist is already booked during this time slot.'
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$func$;

-- update_updated_at() already exists (schema.sql:318) and is used by several other
-- tables' triggers — reused as-is here, not redefined.

DROP TRIGGER IF EXISTS trg_0_compute_combo_item_datetimes ON public.booking_combo_items;
CREATE TRIGGER trg_0_compute_combo_item_datetimes
  BEFORE INSERT OR UPDATE OF date, start_time, service_id ON public.booking_combo_items
  FOR EACH ROW EXECUTE FUNCTION public.compute_combo_item_datetimes();

DROP TRIGGER IF EXISTS trg_booking_combo_item_room_capacity_check ON public.booking_combo_items;
CREATE TRIGGER trg_booking_combo_item_room_capacity_check
  BEFORE INSERT OR UPDATE OF room_id ON public.booking_combo_items
  FOR EACH ROW EXECUTE FUNCTION public.check_booking_combo_item_room_capacity();

DROP TRIGGER IF EXISTS trg_booking_combo_item_therapist_conflict_check ON public.booking_combo_items;
CREATE TRIGGER trg_booking_combo_item_therapist_conflict_check
  BEFORE INSERT OR UPDATE OF therapist_id, start_datetime, end_datetime ON public.booking_combo_items
  FOR EACH ROW EXECUTE FUNCTION public.check_booking_combo_item_therapist_conflict();

DROP TRIGGER IF EXISTS trg_combo_item_updated_at ON public.booking_combo_items;
CREATE TRIGGER trg_combo_item_updated_at
  BEFORE UPDATE ON public.booking_combo_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- 4. Drop the now-redundant combo_packages table + bookings.combo_package_id.
--    services.name/price_npr/offer_*/is_active already cover everything
--    combo_packages stored; bookings.service_id already identifies the combo
--    (when services.is_combo = true) without a second FK.
-- ============================================================

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_combo_package_id_fkey;
ALTER TABLE public.bookings DROP COLUMN IF EXISTS combo_package_id;

DROP TABLE IF EXISTS public.combo_packages;

-- ============================================================
-- MIGRATION 288 COMPLETE
-- ============================================================

INSERT INTO public.schema_migrations (version, name)
VALUES ('288', 'services-combo')
ON CONFLICT (version) DO NOTHING;

COMMIT;
