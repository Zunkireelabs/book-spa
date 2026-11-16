-- Migration 303: per-branch advance online-booking window
--
-- The customer-facing date picker (DateTimeSelection.jsx) has always generated exactly
-- 30 days of date chips, with only the first 14 directly clickable and the rest reachable
-- only via "check further ahead" + Quick Pick — both numbers are hardcoded constants, not
-- admin-configurable, and nothing on the server enforces them at all. A customer could
-- bypass the UI entirely with a direct Supabase insert into `bookings` for, say, 90 days
-- out, and it would succeed.
--
-- This adds a per-branch "how many days ahead can customers book online" setting
-- (branches.advance_booking_days, unset/NULL = the same 30-day default the frontend has
-- always hardcoded — no behavior change for any branch that doesn't touch this) and a
-- trigger — modeled directly on check_branch_online_capacity() (migration-138, fixed in
-- migration-159) — that rejects an anonymous online booking whose date falls beyond that
-- window. Unlike the capacity trigger this isn't a race/count problem (no concurrent
-- writers contend over a single resource), so no pg_advisory_xact_lock is needed — it's a
-- static per-row date comparison.
--
-- Anonymous-booking predicate mirrors migration-159's fix exactly: `created_by IS NULL`,
-- not `therapist_id IS NULL`. Picking "Any professional" in the customer flow still
-- submits a NULL therapist_id with no created_by, so that path stays subject to the
-- window; only genuinely staff-created bookings (which always set created_by) are
-- exempt. A therapist_id-only predicate would have wrongly exempted "Any professional"
-- customer bookings from this limit.
--
-- The 30-day default is baked into the trigger itself (not just the frontend) because the
-- trigger is the actual security boundary here — public_check_branch_bookings_range()
-- (migration-301) is left unchanged: it's SECURITY DEFINER and callable by anon, but it
-- only returns which slots *look* open for a caller-supplied date range; over-fetching
-- past the window can't let anyone actually book there, since this trigger is what blocks
-- the write. Changing that function's signature would also require a DROP + CREATE for no
-- security benefit.
--
-- Reversible (manual):
--   DROP TRIGGER IF EXISTS trg_advance_booking_window_check ON bookings;
--   DROP FUNCTION IF EXISTS public.check_branch_advance_booking_window();
--   DROP FUNCTION IF EXISTS public.update_branch_advance_booking_window(uuid, integer);
--   -- branches.advance_booking_days can stay (nullable, harmless) or:
--   ALTER TABLE branches DROP COLUMN IF EXISTS advance_booking_days;
--
-- Applied: stage PENDING / prod HELD.

BEGIN;

-- 1. Column. NULL = unset, defer to the 30-day default (today's hardcoded behavior,
-- unchanged) for any branch this isn't configured for yet.
ALTER TABLE branches ADD COLUMN IF NOT EXISTS advance_booking_days integer CHECK (advance_booking_days > 0);

-- 2. Race-free, static date-bound check for anonymous (online, customer-created) bookings
-- only. Trigger name alphabetically after 'trg_compute_datetimes' so NEW.date is already
-- populated when this runs (same reasoning as the room-capacity and online-capacity
-- triggers).
CREATE OR REPLACE FUNCTION check_branch_advance_booking_window()
RETURNS TRIGGER AS $$
DECLARE
  v_days integer;
BEGIN
  IF NEW.created_by IS NOT NULL OR NEW.status IN ('Cancelled', 'No Show') THEN
    RETURN NEW;
  END IF;

  SELECT advance_booking_days INTO v_days FROM branches WHERE id = NEW.branch_id;
  IF v_days IS NULL THEN
    v_days := 30; -- same default the frontend has always hardcoded
  END IF;

  IF NEW.date > (now() AT TIME ZONE 'Asia/Kathmandu')::date + v_days THEN
    RAISE EXCEPTION 'BRANCH_ADVANCE_BOOKING_WINDOW: Online bookings are not open that far in advance for this branch.'
      USING ERRCODE = 'P0007';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

DROP TRIGGER IF EXISTS trg_advance_booking_window_check ON bookings;
CREATE TRIGGER trg_advance_booking_window_check
  BEFORE INSERT OR UPDATE OF branch_id, date, status, created_by ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION check_branch_advance_booking_window();

-- 3. Admin-only write path. `branches` has RLS enabled with SELECT-only policies, so a
-- plain .update() from the admin UI would silently affect zero rows. Same shape as
-- update_branch_online_capacity() (migration-301), scoped to the caller's own org.
-- NULL clears back to the 30-day default.
CREATE OR REPLACE FUNCTION public.update_branch_advance_booking_window(
  p_branch_id uuid,
  p_days integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org_id uuid := get_user_org_id();
  v_role   text := get_user_role();
  v_found  uuid;
BEGIN
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'update_branch_advance_booking_window: admin only';
  END IF;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'update_branch_advance_booking_window: no organization context';
  END IF;

  IF p_days IS NOT NULL AND p_days < 1 THEN
    RAISE EXCEPTION 'update_branch_advance_booking_window: days must be at least 1, or blank for the default';
  END IF;

  UPDATE public.branches
  SET advance_booking_days = p_days
  WHERE id = p_branch_id
    AND org_id = v_org_id
  RETURNING id INTO v_found;

  IF v_found IS NULL THEN
    RAISE EXCEPTION 'update_branch_advance_booking_window: branch % not found in this organization', p_branch_id;
  END IF;

  RETURN p_days;
END;
$$;

REVOKE ALL ON FUNCTION public.update_branch_advance_booking_window(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_branch_advance_booking_window(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_branch_advance_booking_window(uuid, integer) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('303', 'branch-advance-booking-window')
ON CONFLICT (version) DO NOTHING;

COMMIT;
