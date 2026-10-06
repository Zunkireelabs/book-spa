-- Migration 252: public staff selection — bookable therapists + per-therapist
-- availability + close the anon off-list/absent/checked-out insert hole (additive,
-- REVERSIBLE)
--
-- Consumes plumbing already live from earlier sessions (migrations 246-251):
-- therapists.photo_url/bio/experience_years/rating, service_therapists allow-list,
-- organizations.settings.show_staff_selection. This migration finally gives
-- customers a "Select professional" step.
--
-- Security hole closed: createBooking() (src/services/api.js) enforces
-- THERAPIST_NOT_ELIGIBLE / THERAPIST_ABSENT / THERAPIST_CHECKED_OUT by reading
-- service_therapists / therapist_attendance directly from the browser — tables an
-- anonymous customer has no SELECT policy on. Every one of those reads returns `[]`
-- for anon, so all three guards silently pass, and anon_insert_bookings is
-- `WITH CHECK (true)` — today an anonymous caller can insert ANY therapist_id. This
-- was latent while customers never picked a therapist; it becomes reachable the
-- moment they can. Moved into a BEFORE INSERT/UPDATE trigger, the only place an
-- anon client write can't skip. Per decision, the allow-list is enforced for
-- everyone (staff included) — a manager who needs to assign someone off-list edits
-- the service's eligible-staff list first (Service Management already supports
-- this), so the error names that fix explicitly.
--
-- public_get_bookable_therapists is a new RPC, not a client-side query, because the
-- anon RLS policy on `therapists` is org-unscoped (`USING (is_active = true)`,
-- migration-012/093) — a direct query would leak every tenant's staff. It also
-- applies the eligibility allow-list in SQL (anon cannot read service_therapists).
--
-- public_check_therapist_bookings_range is a NEW sibling to
-- public_check_branch_bookings_range (migration-213/131), not a change to it: that
-- RPC's RETURNS TABLE can't gain a column via CREATE OR REPLACE (needs DROP+CREATE),
-- and more importantly its rows feed buildOccupancy()'s room/gender capacity math —
-- adding therapist rows there would silently alter other tenants' slot
-- availability. Cost of the split: two SQL definitions of "what blocks a slot" —
-- cross-referenced here and in migration-213.
--
-- Known, accepted: picking a specific therapist bypasses check_branch_online_capacity
-- (migration-138 — it early-returns once therapist_id IS NOT NULL). That's fine:
-- excl_therapist_overlap is a strictly stronger per-person constraint, and the
-- branch cap exists precisely because *unassigned* online bookings have no such
-- constraint. "Any professional" keeps therapist_id NULL, so the cap still applies
-- there.
--
-- Also known, accepted: whole-location manual blocks (room_id IS NULL AND
-- therapist_id IS NULL) previously did nothing for a roomless (enable_rooms=false)
-- branch like sbal's — migration-213 only fans them across rooms. This migration
-- fans them across the branch's service staff too, so sbal starts honoring them;
-- availability may legitimately shrink there. Half-day attendance statuses
-- ('1st-Half Day'/'2nd-Half Day') are intentionally NOT modeled here (same gap as
-- createBooking's existing JS check) — check_out_time partially covers the real
-- case for anyone who actually checks out early.
--
-- Reversible:
--   DROP TRIGGER IF EXISTS trg_booking_therapists_guards_check ON public.booking_therapists;
--   DROP TRIGGER IF EXISTS trg_therapist_guards_check ON public.bookings;
--   DROP TRIGGER IF EXISTS trg_sync_booking_therapists ON public.bookings;
--   DROP FUNCTION IF EXISTS public.enforce_booking_therapist_junction_guards();
--   DROP FUNCTION IF EXISTS public.enforce_booking_therapist_guards();
--   DROP FUNCTION IF EXISTS public.check_therapist_booking_guards(uuid, uuid, date, timestamptz);
--   DROP FUNCTION IF EXISTS public.sync_booking_therapists_from_booking();
--   DROP FUNCTION IF EXISTS public.public_check_therapist_bookings_range(uuid, date, date);
--   DROP FUNCTION IF EXISTS public.public_cancel_booking_group(uuid);
--   DROP FUNCTION IF EXISTS public.public_get_bookable_therapists(text, uuid, uuid[]);

BEGIN;

-- 1. public_get_bookable_therapists — org-scoped (fixes the anon-policy org leak),
-- allow-list-aware staff roster for the "Select professional" step.
--
-- Takes an ARRAY of service ids because a visit can now bundle several services into
-- one back-to-back group booking, and a single professional covers the whole visit —
-- so a therapist only qualifies if they're eligible for EVERY selected service. An
-- empty/NULL array means "no service chosen yet", i.e. the unfiltered roster.
DROP FUNCTION IF EXISTS public.public_get_bookable_therapists(text, uuid, uuid);
CREATE OR REPLACE FUNCTION public.public_get_bookable_therapists(
  p_org_slug text,
  p_branch_id uuid,
  p_service_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  id                uuid,
  name              text,
  "position"        text,
  photo_url         text,
  rating            numeric,
  experience_years  integer,
  bio               text,
  display_order     integer
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
  SELECT
    t.id,
    t.name,
    t.position,
    t.photo_url,
    t.rating,
    t.experience_years,
    t.bio,
    t.display_order
  FROM public.therapists t
  JOIN public.branches b ON b.id = t.branch_id
  JOIN public.organizations o ON o.id = b.org_id
  WHERE o.slug = p_org_slug
    AND o.is_active = true
    AND t.branch_id = p_branch_id
    AND t.is_active = true
    AND t.is_service_staff = true
    -- Eligible for every selected service: there must be no selected service that has
    -- an allow-list which this therapist is missing from. Services with no allow-list
    -- rows stay unrestricted, same "empty = unrestricted" convention as before.
    AND (
      p_service_ids IS NULL
      OR cardinality(p_service_ids) = 0
      OR NOT EXISTS (
        SELECT 1
        FROM unnest(p_service_ids) AS sid
        WHERE EXISTS (SELECT 1 FROM public.service_therapists st WHERE st.service_id = sid)
          AND NOT EXISTS (
            SELECT 1 FROM public.service_therapists st
            WHERE st.service_id = sid AND st.therapist_id = t.id
          )
      )
    )
  ORDER BY COALESCE(t.display_order, 2147483647), t.name;
$$;

REVOKE ALL ON FUNCTION public.public_get_bookable_therapists(text, uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_get_bookable_therapists(text, uuid, uuid[]) TO anon, authenticated;

-- A logged-in staff member previewing /:orgSlug/book otherwise gets an empty service
-- list — public_get_bookable_services (migration-211) was granted to anon only.
GRANT EXECUTE ON FUNCTION public.public_get_bookable_services(text) TO authenticated;

-- 2. public_check_therapist_bookings_range — "what blocks this therapist" over a date
-- range: assigned bookings, companion assignments, unassigned online bookings (NULL
-- therapist — what makes "Any professional" honest), therapist-scoped manual blocks,
-- whole-location blocks fanned across the branch's service staff, and attendance
-- (leave-like full-day rows + a checkout-to-midnight tail).
CREATE OR REPLACE FUNCTION public.public_check_therapist_bookings_range(
  p_branch_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  therapist_id      uuid,
  busy_date         date,
  start_time        time,
  duration_minutes  integer,
  source            text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
  -- a) Directly-assigned bookings
  SELECT
    b.therapist_id,
    b.date AS busy_date,
    b.start_time,
    GREATEST(1, (EXTRACT(EPOCH FROM (b.end_time - b.start_time)) / 60)::int) AS duration_minutes,
    'booking'::text AS source
  FROM public.bookings b
  WHERE b.branch_id = p_branch_id
    AND b.therapist_id IS NOT NULL
    AND b.date BETWEEN p_start_date AND p_end_date
    AND b.status NOT IN ('Cancelled', 'No Show')

  UNION ALL

  -- b) booking_therapists junction rows (couple/companion assignments) — per-therapist
  -- start/end within the booking window.
  SELECT
    bt.therapist_id,
    b.date AS busy_date,
    bt.start_time,
    GREATEST(1, (EXTRACT(EPOCH FROM (bt.end_time - bt.start_time)) / 60)::int) AS duration_minutes,
    'booking'::text AS source
  FROM public.booking_therapists bt
  JOIN public.bookings b ON b.id = bt.booking_id
  WHERE b.branch_id = p_branch_id
    AND bt.start_time IS NOT NULL
    AND bt.end_time IS NOT NULL
    AND b.date BETWEEN p_start_date AND p_end_date
    AND b.status NOT IN ('Cancelled', 'No Show')

  UNION ALL

  -- c) Unassigned online bookings — NULL therapist_id on purpose: this is what lets
  -- "Any professional" see pending, not-yet-assigned demand instead of ignoring it.
  SELECT
    NULL::uuid AS therapist_id,
    b.date AS busy_date,
    b.start_time,
    GREATEST(1, (EXTRACT(EPOCH FROM (b.end_time - b.start_time)) / 60)::int) AS duration_minutes,
    'unassigned'::text AS source
  FROM public.bookings b
  WHERE b.branch_id = p_branch_id
    AND b.therapist_id IS NULL
    AND b.created_by IS NULL
    AND b.date BETWEEN p_start_date AND p_end_date
    AND b.status NOT IN ('Cancelled', 'No Show')

  UNION ALL

  -- d) Therapist-scoped manual blocks (migration-212's recurrence expansion, reused —
  -- migration-213 explicitly excludes these from the room-capacity RPC).
  SELECT
    mb.therapist_id,
    occ.occ_date AS busy_date,
    mb.start_time,
    mb.duration_minutes,
    'block'::text AS source
  FROM public.manual_blocks mb
  CROSS JOIN LATERAL (
    SELECT public.manual_block_occurrence_date(mb.block_date, mb.recurrence_freq, mb.recurrence_interval, n) AS occ_date
    FROM generate_series(0, CASE WHEN mb.recurrence_freq IS NULL THEN 0 ELSE LEAST(COALESCE(mb.recurrence_count, 500) - 1, 500) END) AS n
  ) occ
  WHERE mb.branch_id = p_branch_id
    AND mb.therapist_id IS NOT NULL
    AND mb.prevent_online_booking = true
    AND mb.is_cancelled = false
    AND occ.occ_date BETWEEN p_start_date AND p_end_date
    AND (mb.recurrence_end_date IS NULL OR occ.occ_date <= mb.recurrence_end_date)
    AND NOT EXISTS (
      SELECT 1 FROM public.manual_block_exceptions mbe
      WHERE mbe.series_id = mb.series_id AND mbe.exception_date = occ.occ_date
    )

  UNION ALL

  -- e) Whole-location blocks (no room, no therapist) fanned across every active
  -- service-staff therapist at the branch — same mechanism as (d), different scope.
  SELECT
    t.id AS therapist_id,
    occ.occ_date AS busy_date,
    mb.start_time,
    mb.duration_minutes,
    'block'::text AS source
  FROM public.manual_blocks mb
  JOIN public.therapists t
    ON t.branch_id = mb.branch_id AND t.is_active = true AND t.is_service_staff = true
  CROSS JOIN LATERAL (
    SELECT public.manual_block_occurrence_date(mb.block_date, mb.recurrence_freq, mb.recurrence_interval, n) AS occ_date
    FROM generate_series(0, CASE WHEN mb.recurrence_freq IS NULL THEN 0 ELSE LEAST(COALESCE(mb.recurrence_count, 500) - 1, 500) END) AS n
  ) occ
  WHERE mb.branch_id = p_branch_id
    AND mb.room_id IS NULL
    AND mb.therapist_id IS NULL
    AND mb.prevent_online_booking = true
    AND mb.is_cancelled = false
    AND occ.occ_date BETWEEN p_start_date AND p_end_date
    AND (mb.recurrence_end_date IS NULL OR occ.occ_date <= mb.recurrence_end_date)
    AND NOT EXISTS (
      SELECT 1 FROM public.manual_block_exceptions mbe
      WHERE mbe.series_id = mb.series_id AND mbe.exception_date = occ.occ_date
    )

  UNION ALL

  -- f) Attendance: leave-like statuses block the whole day (half-day statuses
  -- deliberately not modeled — same gap as createBooking's existing JS guard).
  SELECT
    ta.therapist_id,
    ta.date AS busy_date,
    '00:00'::time AS start_time,
    1440 AS duration_minutes,
    'absence'::text AS source
  FROM public.therapist_attendance ta
  WHERE ta.branch_id = p_branch_id
    AND ta.date BETWEEN p_start_date AND p_end_date
    AND ta.status IN ('Absent', 'Leave', 'Annual Leave', 'Sick Leave', 'Day Off')

  UNION ALL

  -- f2) Checkout tail: from the moment they checked out to the end of that day.
  SELECT
    ta.therapist_id,
    ta.date AS busy_date,
    (ta.check_out_time AT TIME ZONE 'Asia/Kathmandu')::time AS start_time,
    GREATEST(1, 1440 - (EXTRACT(HOUR FROM (ta.check_out_time AT TIME ZONE 'Asia/Kathmandu')) * 60
      + EXTRACT(MINUTE FROM (ta.check_out_time AT TIME ZONE 'Asia/Kathmandu')))::int) AS duration_minutes,
    'checkout'::text AS source
  FROM public.therapist_attendance ta
  WHERE ta.branch_id = p_branch_id
    AND ta.date BETWEEN p_start_date AND p_end_date
    AND ta.check_out_time IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.public_check_therapist_bookings_range(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_check_therapist_bookings_range(uuid, date, date) TO anon, authenticated;

-- 3. Shared guard logic — called from both the bookings trigger and the
-- booking_therapists (companion) trigger so the two paths can't drift.
CREATE OR REPLACE FUNCTION public.check_therapist_booking_guards(
  p_therapist_id uuid,
  p_service_id uuid,
  p_date date,
  p_start_datetime timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_therapist_name text;
  v_service_name   text;
  v_has_allowlist  boolean;
  v_on_allowlist    boolean;
  v_attendance      record;
BEGIN
  SELECT name INTO v_therapist_name FROM public.therapists WHERE id = p_therapist_id;
  SELECT name INTO v_service_name FROM public.services WHERE id = p_service_id;

  SELECT EXISTS(SELECT 1 FROM public.service_therapists WHERE service_id = p_service_id) INTO v_has_allowlist;
  IF v_has_allowlist THEN
    SELECT EXISTS(
      SELECT 1 FROM public.service_therapists
      WHERE service_id = p_service_id AND therapist_id = p_therapist_id
    ) INTO v_on_allowlist;

    IF NOT v_on_allowlist THEN
      RAISE EXCEPTION 'THERAPIST_NOT_ELIGIBLE: % is not on the eligible staff list for %. Update the service''s eligible staff in Service Management to allow this.',
        COALESCE(v_therapist_name, 'This therapist'), COALESCE(v_service_name, 'this service')
        USING ERRCODE = 'P0006';
    END IF;
  END IF;

  SELECT status, check_out_time INTO v_attendance
  FROM public.therapist_attendance
  WHERE therapist_id = p_therapist_id AND date = p_date;

  IF v_attendance.status IS NOT NULL AND v_attendance.status::text IN ('Absent', 'Leave', 'Annual Leave', 'Sick Leave', 'Day Off') THEN
    RAISE EXCEPTION 'THERAPIST_ABSENT: % is marked as % on this date.',
      COALESCE(v_therapist_name, 'This therapist'), v_attendance.status
      USING ERRCODE = 'P0006';
  END IF;

  IF v_attendance.check_out_time IS NOT NULL AND p_start_datetime >= v_attendance.check_out_time THEN
    RAISE EXCEPTION 'THERAPIST_CHECKED_OUT: % already checked out for this date.',
      COALESCE(v_therapist_name, 'This therapist')
      USING ERRCODE = 'P0006';
  END IF;
END;
$$;

-- REVOKE ... FROM PUBLIC alone does not remove Supabase's default-privileges direct
-- grant to anon/authenticated on every newly created function — same gotcha the
-- repo's migration-245/248 already revoke explicitly. This helper is SECURITY
-- DEFINER, so leaving anon's grant in place would let an anonymous caller invoke it
-- directly and read back staff names/leave-status via its exception messages,
-- bypassing the RLS that normally hides therapist_attendance.
REVOKE ALL ON FUNCTION public.check_therapist_booking_guards(uuid, uuid, date, timestamptz) FROM PUBLIC, anon, authenticated;

-- 4. BEFORE INSERT OR UPDATE OF therapist_id ON bookings — the unskippable
-- enforcement point. Only fires when therapist_id is actually in the SET list, so
-- plain resizes/status changes are untouched (per decision, this does cover staff
-- reassignment, since that updates therapist_id).
CREATE OR REPLACE FUNCTION public.enforce_booking_therapist_guards()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.therapist_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.check_therapist_booking_guards(NEW.therapist_id, NEW.service_id, NEW.date, NEW.start_datetime);
  RETURN NEW;
END;
$$;

-- Trigger functions take no caller-supplied args and only run as attached triggers
-- (calling them directly errors — they reference NEW), but revoke anyway so every
-- function's ACL here matches intent rather than leaning on that implicit protection.
REVOKE ALL ON FUNCTION public.enforce_booking_therapist_guards() FROM PUBLIC, anon, authenticated;

-- Name sorts after 'trg_compute_datetimes' and 'trg_online_capacity_check' (same
-- precedent as migration-138) so NEW.start_datetime is already populated when this
-- runs.
DROP TRIGGER IF EXISTS trg_therapist_guards_check ON public.bookings;
CREATE TRIGGER trg_therapist_guards_check
  BEFORE INSERT OR UPDATE OF therapist_id ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_booking_therapist_guards();

-- 5. Sibling trigger closing the companion-assignment path (booking_therapists).
CREATE OR REPLACE FUNCTION public.enforce_booking_therapist_junction_guards()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_booking record;
BEGIN
  SELECT service_id, date, start_datetime INTO v_booking
  FROM public.bookings WHERE id = NEW.booking_id;

  IF v_booking IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.check_therapist_booking_guards(NEW.therapist_id, v_booking.service_id, v_booking.date, v_booking.start_datetime);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_booking_therapist_junction_guards() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_booking_therapists_guards_check ON public.booking_therapists;
CREATE TRIGGER trg_booking_therapists_guards_check
  BEFORE INSERT ON public.booking_therapists
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_booking_therapist_junction_guards();

-- 6. booking_therapists' own RLS (migration-020) is TO authenticated only, so
-- createBooking's junction insert fails silently (console.warn) for anon — a
-- customer-picked therapist would land in bookings.therapist_id but never in the
-- junction table. Mirror it server-side instead of opening an anon INSERT policy
-- (rejected: anon could then write arbitrary rows against any booking_id).
CREATE OR REPLACE FUNCTION public.sync_booking_therapists_from_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.therapist_id IS NOT NULL THEN
    INSERT INTO public.booking_therapists (booking_id, therapist_id, start_time, end_time)
    VALUES (NEW.id, NEW.therapist_id, NEW.start_time, NEW.end_time)
    ON CONFLICT (booking_id, therapist_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_booking_therapists_from_booking() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_booking_therapists ON public.bookings;
CREATE TRIGGER trg_sync_booking_therapists
  AFTER INSERT ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_booking_therapists_from_booking();

-- 7. public_cancel_booking_group — compensation path for a partially-created
-- multi-service group booking.
--
-- A multi-service visit writes one bookings row per service. If a later one fails
-- (its slot was taken in the seconds since the customer picked a time), the rows
-- already written have to be released or the customer is left silently half-booked.
-- The customer is anonymous, and updateBookingStatus() requires an authenticated staff
-- user while bookings has no anon UPDATE policy — so without this RPC the rollback
-- would fail for every real customer, which is precisely the case it exists for.
--
-- Deliberately narrow: only Pending rows, only online bookings (created_by IS NULL),
-- only within 10 minutes of creation, and only for one booking_group_id — a UUID the
-- client generated moments earlier, so it acts as an unguessable capability rather
-- than something enumerable.
CREATE OR REPLACE FUNCTION public.public_cancel_booking_group(p_booking_group_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_booking_group_id IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.bookings
  SET status = 'Cancelled',
      cancellation_reason = 'Automatically released - another service in the same booking could not be scheduled.'
  WHERE booking_group_id = p_booking_group_id
    AND status = 'Pending'
    AND created_by IS NULL
    AND created_at > now() - interval '10 minutes';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.public_cancel_booking_group(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_cancel_booking_group(uuid) TO anon, authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('252', 'public-staff-selection')
ON CONFLICT (version) DO NOTHING;

COMMIT;
