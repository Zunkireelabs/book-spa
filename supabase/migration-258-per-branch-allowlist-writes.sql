-- Migration 258: fix per-branch allow-list disagreement + branch-scope allow-list writes
--
-- Follow-up to migration-257, found in review of #373:
--
-- 1. check_therapist_booking_guards (the BEFORE-trigger enforcement point) scoped the
-- "has an allow-list" check by the therapist's own live branch_id. The sibling RPC,
-- public_get_bookable_therapists, scopes it by the booking's branch (its p_branch_id
-- argument). Those two branches can legitimately differ: createBooking (api.js) allows
-- assigning a therapist whose live branch differs from the booking's branch during a
-- staff_transfers window (computeTherapistBranchAt()), and that is exactly the window
-- where the trigger and the RPC would disagree about eligibility. Fix: add p_branch_id
-- as an explicit parameter (signature change -> DROP + CREATE) and have both triggers
-- pass the *booking's* branch_id, not look it up from the therapist row.
--
-- Also closes a NULL hole while in here: if p_therapist_id doesn't resolve to a real
-- therapist row, the old code let v_therapist_name/v_branch_id end up NULL and the
-- allow-list predicate (`st_t.branch_id = v_branch_id`) silently never matched,
-- skipping the check instead of failing it. Now raises explicitly.
--
-- 2. set_service_therapists deleted WHERE service_id = p_service_id with no branch
-- predicate -- org-wide, even though the Eligible Staff picker that calls it
-- (ServiceManagementPanel.jsx) is already branch-scoped (it only ever lists this
-- branch's roster). So toggling restriction off at branch A silently wiped branch B's
-- allow-list rows too, and a branch-B manager reading "has rows => restricted, but none
-- of them cover me" saw the service as fully blocked rather than unrestricted-here.
-- Fix: add p_branch_id and scope both the ownership validation and the DELETE to rows
-- whose therapist belongs to that branch. Once writes are branch-scoped, migration-257's
-- "no allow-list rows for this branch = unrestricted at this branch" is a true statement
-- about configuration, not a fail-open artefact of org-wide deletes.
--
-- Reversible:
--   DROP FUNCTION IF EXISTS public.check_therapist_booking_guards(uuid, uuid, date, timestamptz, uuid);
--   DROP FUNCTION IF EXISTS public.set_service_therapists(uuid, uuid[], uuid);
--   -- recreate migration-257's check_therapist_booking_guards(uuid, uuid, date, timestamptz) body
--   -- recreate migration-253's set_service_therapists(uuid, uuid[]) body
--   -- CREATE OR REPLACE enforce_booking_therapist_guards / enforce_booking_therapist_junction_guards
--   -- back to migration-252's bodies (same signatures, no DROP needed for those two).
--
-- 3. Belt-and-braces: explicitly revoke PUBLIC's SELECT on therapists too, alongside
-- migration-256's anon-only revoke. Confirmed via \dp on staging that no PUBLIC grant
-- actually exists on this table today -- every role already goes through anon/
-- authenticated/service_role/postgres explicitly -- so this is not closing a live
-- hole, just removing the implicit path every role inherits through PUBLIC so a
-- future default-privileges change can't silently reopen one.
--
-- 4. booking_therapists_update (migration-254) is USING (true) WITH CHECK (true) --
-- the same permissive shape as migration-020's existing SELECT/INSERT/DELETE trio on
-- this table, so not a new class of hole. The BEFORE-INSERT-only guard trigger
-- (migration-252's trg_booking_therapists_guards_check) doesn't fire on this UPDATE
-- path, but that's safe by construction: the only UPDATE path is createBooking's
-- upsert with onConflict: 'booking_id,therapist_id' (api.js) -- therapist_id is part
-- of the conflict target, so Postgres can't let a DO UPDATE change it. No narrower
-- policy is needed; left as documentation rather than a behavior change.

BEGIN;

REVOKE SELECT ON public.therapists FROM PUBLIC;

-- 1a. check_therapist_booking_guards -- branch param comes from the caller (the
-- booking's own branch), not looked up from the therapist row.
DROP FUNCTION IF EXISTS public.check_therapist_booking_guards(uuid, uuid, date, timestamptz);

CREATE FUNCTION public.check_therapist_booking_guards(
  p_therapist_id uuid,
  p_service_id uuid,
  p_date date,
  p_start_datetime timestamptz,
  p_branch_id uuid
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
  v_on_allowlist   boolean;
  v_attendance     record;
BEGIN
  SELECT name INTO v_therapist_name FROM public.therapists WHERE id = p_therapist_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'THERAPIST_NOT_FOUND: therapist % does not exist.', p_therapist_id
      USING ERRCODE = 'P0006';
  END IF;

  SELECT name INTO v_service_name FROM public.services WHERE id = p_service_id;

  -- Branch-scoped by the booking's own branch (p_branch_id), matching
  -- public_get_bookable_therapists -- not the therapist's live branch, which can
  -- legitimately differ from the booking's branch during a staff_transfers window.
  SELECT EXISTS(
    SELECT 1
    FROM public.service_therapists st
    JOIN public.therapists st_t ON st_t.id = st.therapist_id
    WHERE st.service_id = p_service_id AND st_t.branch_id = p_branch_id
  ) INTO v_has_allowlist;
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

REVOKE ALL ON FUNCTION public.check_therapist_booking_guards(uuid, uuid, date, timestamptz, uuid) FROM PUBLIC, anon, authenticated;

-- 1b. Both call sites now pass the booking's own branch_id.
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

  PERFORM public.check_therapist_booking_guards(NEW.therapist_id, NEW.service_id, NEW.date, NEW.start_datetime, NEW.branch_id);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_booking_therapist_guards() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_booking_therapist_junction_guards()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_booking record;
BEGIN
  SELECT service_id, date, start_datetime, branch_id INTO v_booking
  FROM public.bookings WHERE id = NEW.booking_id;

  IF v_booking IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.check_therapist_booking_guards(NEW.therapist_id, v_booking.service_id, v_booking.date, v_booking.start_datetime, v_booking.branch_id);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_booking_therapist_junction_guards() FROM PUBLIC, anon, authenticated;

-- 2. set_service_therapists -- branch-scope the write.
DROP FUNCTION IF EXISTS public.set_service_therapists(uuid, uuid[]);

CREATE FUNCTION public.set_service_therapists(
  p_service_id uuid,
  p_therapist_ids uuid[],
  p_branch_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org_id uuid := get_user_org_id();
  v_role   text := get_user_role();
  v_count  integer;
BEGIN
  IF v_role NOT IN ('manager', 'admin') THEN
    RAISE EXCEPTION 'set_service_therapists: manager or admin only';
  END IF;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'set_service_therapists: no organization context';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.services s WHERE s.id = p_service_id AND s.org_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'set_service_therapists: service % not found in your organization', p_service_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.branches br WHERE br.id = p_branch_id AND br.org_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'set_service_therapists: branch % not found in your organization', p_branch_id;
  END IF;

  -- Every id must belong to the target branch (which, having just been validated
  -- above, is already known to belong to the caller's org) -- validated BEFORE
  -- writing anything, same atomicity rationale as migration-253.
  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_therapist_ids, ARRAY[]::uuid[])) AS tid
    WHERE NOT EXISTS (
      SELECT 1 FROM public.therapists t
      WHERE t.id = tid AND t.branch_id = p_branch_id
    )
  ) THEN
    RAISE EXCEPTION 'set_service_therapists: one or more therapist ids do not belong to the target branch';
  END IF;

  -- Scoped to this branch's therapists only -- a different branch's allow-list rows
  -- for the same service are untouched, so restricting/unrestricting at one branch
  -- can no longer wipe another branch's configuration.
  DELETE FROM public.service_therapists st
  USING public.therapists t
  WHERE st.service_id = p_service_id
    AND st.therapist_id = t.id
    AND t.branch_id = p_branch_id;

  INSERT INTO public.service_therapists (service_id, therapist_id)
  SELECT p_service_id, tid
  FROM unnest(COALESCE(p_therapist_ids, ARRAY[]::uuid[])) AS tid;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.set_service_therapists(uuid, uuid[], uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_service_therapists(uuid, uuid[], uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_service_therapists(uuid, uuid[], uuid) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('258', 'per-branch-allowlist-writes')
ON CONFLICT (version) DO NOTHING;

COMMIT;
