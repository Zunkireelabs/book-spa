-- Migration 048: transfer_therapist also flips users.branch_id for STAFF (additive, REVERSIBLE)
--
-- Bug fix: the original transfer_therapist (migration-039, then migration-041) only updated
-- therapists.branch_id. The staff member's login profile (public.users.branch_id) was never
-- touched, so a transferred staffer kept seeing their old branch's dashboard until manually
-- SQL'd. (Surfaced 2026-06-18 with Roshan Rai — Lazimpat → Thamel — required a manual
-- UPDATE users SET branch_id = ... after the in-app transfer.)
--
-- This migration patches transfer_therapist() AND apply_due_staff_transfers() to also flip
-- the matching user's branch_id, scoped to:
--   - public.users.org_id    = the transfer's org_id
--   - public.users.role      = 'staff' ONLY (manager/admin are intentionally out of scope
--                              for now — those roles often staff multiple branches and the
--                              business rules for them aren't settled yet)
--   - public.users.full_name = therapists.name (case-insensitive, trimmed)
--   - exactly ONE staff user matches (multi-match is skipped with a NOTICE — manual SQL
--     fallback handles the ambiguous case)
--
-- Builds on migration-038 (staff_transfers + therapists.org_id), migration-039, and
-- migration-041 (scheduled transfers + apply_due_staff_transfers cron + 4-arg signature).
-- Idempotent (CREATE OR REPLACE / ON CONFLICT) and portable (no hardcoded UUIDs).
--
-- Production note (2026-06-18): prod is at 044 with 045/046/047 (membership) intentionally
-- held back. This migration depends ONLY on 038/039/041 — it does not touch membership
-- tables and is safe to apply to prod ahead of 045-047.
--
-- Reversible: re-run migration-041's CREATE OR REPLACE bodies for transfer_therapist()
-- and apply_due_staff_transfers(), and DROP FUNCTION public._sync_user_branch_for_transfer.

-- 1. Helper: flip a matching staff user's branch_id. Returns true if exactly one staff
--    user matched and was updated; false otherwise (zero matches, ambiguous, or matched
--    user is manager/admin — out of scope per business rule).
CREATE OR REPLACE FUNCTION public._sync_user_branch_for_transfer(
  p_therapist_id uuid,
  p_org_id       uuid,
  p_to_branch_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_name     text;
  v_match_id uuid;
  v_n_match  int;
BEGIN
  SELECT name INTO v_name FROM public.therapists WHERE id = p_therapist_id;
  IF v_name IS NULL THEN RETURN false; END IF;

  -- Only staff role, same org, name matches the therapist row.
  -- (Two-step instead of `count(*), max(id)` — Postgres has no max(uuid).)
  SELECT count(*) INTO v_n_match
    FROM public.users
   WHERE org_id = p_org_id
     AND role = 'staff'
     AND lower(trim(full_name)) = lower(trim(v_name));

  IF v_n_match = 0 THEN
    RAISE NOTICE 'transfer: no matching staff user for therapist % (%); users.branch_id unchanged', p_therapist_id, v_name;
    RETURN false;
  END IF;

  IF v_n_match > 1 THEN
    RAISE NOTICE 'transfer: % staff users match therapist % (%); ambiguous, users.branch_id unchanged — handle manually', v_n_match, p_therapist_id, v_name;
    RETURN false;
  END IF;

  SELECT id INTO v_match_id
    FROM public.users
   WHERE org_id = p_org_id
     AND role = 'staff'
     AND lower(trim(full_name)) = lower(trim(v_name));

  UPDATE public.users
     SET branch_id = p_to_branch_id
   WHERE id = v_match_id
     AND branch_id IS DISTINCT FROM p_to_branch_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public._sync_user_branch_for_transfer(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._sync_user_branch_for_transfer(uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public._sync_user_branch_for_transfer(uuid, uuid, uuid) FROM authenticated;
-- Only the SECURITY DEFINER caller functions invoke it; no client grant.

-- 2. Patched transfer_therapist: same as 041, with one new PERFORM line after the
--    immediate therapist UPDATE. Future-dated transfers do NOT touch users.branch_id
--    until apply_due_staff_transfers picks them up (kept symmetrical below).
CREATE OR REPLACE FUNCTION public.transfer_therapist(
  p_therapist_id   uuid,
  p_to_branch_id   uuid,
  p_note           text DEFAULT NULL,
  p_effective_date date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role          user_role;
  v_caller_org    uuid;
  v_caller_branch uuid;
  v_from_branch   uuid;
  v_therapist_org uuid;
  v_to_branch_org uuid;
  v_new_order     int;
  v_transfer_id   uuid;
  v_today         date;
  v_effective     date;
  v_immediate     boolean;
BEGIN
  v_role          := get_user_role();
  v_caller_org    := get_user_org_id();
  v_caller_branch := get_user_branch_id();
  v_today         := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  v_effective     := COALESCE(p_effective_date, v_today);

  SELECT branch_id, org_id INTO v_from_branch, v_therapist_org
  FROM public.therapists
  WHERE id = p_therapist_id;

  IF v_from_branch IS NULL THEN
    RAISE EXCEPTION 'transfer_therapist: therapist % not found', p_therapist_id;
  END IF;

  IF v_therapist_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'transfer_therapist: therapist is not in your organization';
  END IF;

  SELECT org_id INTO v_to_branch_org
  FROM public.branches
  WHERE id = p_to_branch_id;

  IF v_to_branch_org IS NULL THEN
    RAISE EXCEPTION 'transfer_therapist: destination branch % not found', p_to_branch_id;
  END IF;

  IF v_to_branch_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'transfer_therapist: destination branch is not in your organization';
  END IF;

  IF p_to_branch_id = v_from_branch THEN
    RAISE EXCEPTION 'transfer_therapist: staffer is already at that branch';
  END IF;

  IF NOT (
    v_role = 'admin'
    OR (v_role = 'manager' AND v_from_branch = v_caller_branch)
  ) THEN
    RAISE EXCEPTION 'transfer_therapist: only an admin or the current branch''s manager may transfer this staffer';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.staff_transfers
    WHERE therapist_id = p_therapist_id AND applied = false
  ) THEN
    RAISE EXCEPTION 'transfer_therapist: a scheduled transfer already exists for this staffer; cancel it first';
  END IF;

  v_immediate := v_effective <= v_today;

  IF v_immediate THEN
    SELECT COALESCE(max(display_order), -1) + 1 INTO v_new_order
    FROM public.therapists
    WHERE branch_id = p_to_branch_id;

    UPDATE public.therapists
       SET branch_id = p_to_branch_id,
           display_order = v_new_order
     WHERE id = p_therapist_id;

    -- migration-048: keep the staff user's login branch in sync (staff role only).
    PERFORM public._sync_user_branch_for_transfer(p_therapist_id, v_caller_org, p_to_branch_id);
  END IF;

  INSERT INTO public.staff_transfers
    (therapist_id, org_id, from_branch_id, to_branch_id, transferred_by, note, effective_date, applied)
  VALUES
    (p_therapist_id, v_caller_org, v_from_branch, p_to_branch_id, auth.uid(), p_note, v_effective, v_immediate)
  RETURNING id INTO v_transfer_id;

  RETURN v_transfer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_therapist(uuid, uuid, text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transfer_therapist(uuid, uuid, text, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.transfer_therapist(uuid, uuid, text, date) TO authenticated;

-- 3. Patched apply_due_staff_transfers: same as 041, with one new PERFORM line after the
--    deferred therapist flip. Keeps scheduled-transfer behaviour symmetrical with the
--    immediate path above.
CREATE OR REPLACE FUNCTION public.apply_due_staff_transfers()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_today          date := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  v_rec            record;
  v_new_order      int;
  v_current_branch uuid;
  v_count          int := 0;
BEGIN
  FOR v_rec IN
    SELECT * FROM public.staff_transfers
    WHERE applied = false AND effective_date <= v_today
    ORDER BY effective_date, transferred_at
  LOOP
    SELECT branch_id INTO v_current_branch
    FROM public.therapists WHERE id = v_rec.therapist_id;

    IF v_current_branch IS NULL THEN
      UPDATE public.staff_transfers SET applied = true WHERE id = v_rec.id;
      CONTINUE;
    END IF;

    IF v_current_branch IS DISTINCT FROM v_rec.to_branch_id THEN
      SELECT COALESCE(max(display_order), -1) + 1 INTO v_new_order
      FROM public.therapists WHERE branch_id = v_rec.to_branch_id;

      UPDATE public.therapists
         SET branch_id = v_rec.to_branch_id,
             display_order = v_new_order
       WHERE id = v_rec.therapist_id;

      -- migration-048: keep the staff user's login branch in sync (staff role only).
      PERFORM public._sync_user_branch_for_transfer(v_rec.therapist_id, v_rec.org_id, v_rec.to_branch_id);
    END IF;

    UPDATE public.staff_transfers SET applied = true WHERE id = v_rec.id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- apply_due_staff_transfers is invoked by cron (the postgres role); no client grant.
REVOKE ALL ON FUNCTION public.apply_due_staff_transfers() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_due_staff_transfers() FROM anon;
REVOKE ALL ON FUNCTION public.apply_due_staff_transfers() FROM authenticated;

-- 4. Record migration ---------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('048', 'transfer-syncs-user-branch')
ON CONFLICT (version) DO NOTHING;
