-- Migration 039: transfer_therapist() SECURITY DEFINER function (Phase 2, step 2 — additive, REVERSIBLE)
--
-- Implements the "single current branch + transfer" move from the staff centralization plan
-- (docs/feature/centralize-customer-staff-data.md, §6). A staffer is at exactly one branch at a
-- time (therapists.branch_id). Only the CURRENT branch's manager — or any org admin — may transfer
-- them to another branch in the same org. The move is atomic: flip branch_id, append an audit row
-- to staff_transfers (migration-038), and put the staffer at the end of the destination's order.
--
-- Why a SECURITY DEFINER function instead of relying on the table RLS: the existing therapists
-- UPDATE policy ("Manager can update org therapists") authorizes ANY org manager/admin to change a
-- therapist whose branch is in their org — it does NOT pin the actor to the staffer's CURRENT
-- branch. This function enforces that stricter rule and writes the tamper-proof audit row in the
-- same transaction (staff_transfers has no direct INSERT policy).
--
-- Idempotent (CREATE OR REPLACE) and portable (no hardcoded UUIDs).
--
-- Reversible:
--   DROP FUNCTION IF EXISTS public.transfer_therapist(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.transfer_therapist(
  p_therapist_id uuid,
  p_to_branch_id uuid,
  p_note         text DEFAULT NULL
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
BEGIN
  v_role          := get_user_role();
  v_caller_org    := get_user_org_id();
  v_caller_branch := get_user_branch_id();

  -- Load the staffer's current identity ------------------------------------
  SELECT branch_id, org_id INTO v_from_branch, v_therapist_org
  FROM public.therapists
  WHERE id = p_therapist_id;

  IF v_from_branch IS NULL THEN
    RAISE EXCEPTION 'transfer_therapist: therapist % not found', p_therapist_id;
  END IF;

  -- Staffer must belong to the caller's org --------------------------------
  IF v_therapist_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'transfer_therapist: therapist is not in your organization';
  END IF;

  -- Destination branch must exist and be in the same org -------------------
  SELECT org_id INTO v_to_branch_org
  FROM public.branches
  WHERE id = p_to_branch_id;

  IF v_to_branch_org IS NULL THEN
    RAISE EXCEPTION 'transfer_therapist: destination branch % not found', p_to_branch_id;
  END IF;

  IF v_to_branch_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'transfer_therapist: destination branch is not in your organization';
  END IF;

  -- No-op transfers are rejected (also matches the staff_transfers CHECK) ---
  IF p_to_branch_id = v_from_branch THEN
    RAISE EXCEPTION 'transfer_therapist: staffer is already at that branch';
  END IF;

  -- Authorization: admin anywhere, OR the manager of the CURRENT branch ----
  IF NOT (
    v_role = 'admin'
    OR (v_role = 'manager' AND v_from_branch = v_caller_branch)
  ) THEN
    RAISE EXCEPTION 'transfer_therapist: only an admin or the current branch''s manager may transfer this staffer';
  END IF;

  -- Place the staffer at the end of the destination branch's order ---------
  SELECT COALESCE(max(display_order), -1) + 1 INTO v_new_order
  FROM public.therapists
  WHERE branch_id = p_to_branch_id;

  -- Flip current branch + reorder ------------------------------------------
  UPDATE public.therapists
     SET branch_id = p_to_branch_id,
         display_order = v_new_order
   WHERE id = p_therapist_id;

  -- Append the audit row ---------------------------------------------------
  INSERT INTO public.staff_transfers
    (therapist_id, org_id, from_branch_id, to_branch_id, transferred_by, note)
  VALUES
    (p_therapist_id, v_caller_org, v_from_branch, p_to_branch_id, auth.uid(), p_note)
  RETURNING id INTO v_transfer_id;

  RETURN v_transfer_id;
END;
$$;

-- Only signed-in staff may call it; the function does its own role checks.
-- (Supabase's default privileges grant EXECUTE to anon/authenticated/service_role
--  on every new function, so revoke anon explicitly — REVOKE FROM PUBLIC alone
--  does NOT remove those role-specific grants.)
REVOKE ALL ON FUNCTION public.transfer_therapist(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transfer_therapist(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.transfer_therapist(uuid, uuid, text) TO authenticated;

-- Record migration -----------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('039', 'staff-transfer-fn')
ON CONFLICT (version) DO NOTHING;
