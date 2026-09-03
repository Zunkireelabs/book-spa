-- Migration 142: extend an ACTIVE staff transfer's duration (additive, REVERSIBLE)
--
-- Lets the destination branch's manager (or an admin) push a currently-active transfer's
-- revert_at further out — e.g. the therapist needs to stay 2 more hours — WITHOUT creating a
-- second transfer row. This is deliberately a distinct operation from transfer_therapist():
-- extending modifies the existing in-flight loan; a brand-new transfer_therapist() call is used
-- once a loan has completed (reverted) and the therapist is needed again later.
--
-- Builds on migration-145 (required-duration transfers + revert_at/reverted columns).
--
-- Reversible: DROP FUNCTION IF EXISTS public.extend_staff_transfer(uuid, integer, text);

CREATE OR REPLACE FUNCTION public.extend_staff_transfer(
  p_transfer_id     uuid,
  p_additional_value integer,
  p_additional_unit  text
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role       user_role;
  v_caller_org uuid;
  v_caller_branch uuid;
  v_rec        record;
  v_new_revert_at timestamptz;
BEGIN
  IF p_additional_value IS NULL OR p_additional_value <= 0 THEN
    RAISE EXCEPTION 'extend_staff_transfer: additional duration must be a positive number';
  END IF;

  IF p_additional_unit IS NULL OR p_additional_unit NOT IN ('minute','hour','day','week') THEN
    RAISE EXCEPTION 'extend_staff_transfer: duration unit must be one of minute, hour, day, week';
  END IF;

  v_role          := get_user_role();
  v_caller_org    := get_user_org_id();
  v_caller_branch := get_user_branch_id();

  SELECT * INTO v_rec FROM public.staff_transfers WHERE id = p_transfer_id;

  IF v_rec.id IS NULL THEN
    RAISE EXCEPTION 'extend_staff_transfer: transfer not found';
  END IF;

  IF v_rec.org_id IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'extend_staff_transfer: not your organization';
  END IF;

  IF v_rec.revert_at IS NULL THEN
    RAISE EXCEPTION 'extend_staff_transfer: this transfer has no scheduled return time';
  END IF;

  -- Authorization mirrors transfer_therapist(): the manager of the staffer's CURRENT
  -- branch may act. During an active transfer, "current branch" is the DESTINATION
  -- (to_branch_id) — that's who is actually benefiting from the extra time.
  IF NOT (
    v_role = 'admin'
    OR (v_role = 'manager' AND v_rec.to_branch_id = v_caller_branch)
  ) THEN
    RAISE EXCEPTION 'extend_staff_transfer: only an admin or the destination branch''s manager may extend this transfer';
  END IF;

  -- Atomic, race-safe: re-checks applied/reverted/revert_at against the CURRENT row at
  -- UPDATE time (not the stale SELECT above), so a concurrent apply_due_staff_reverts()
  -- tick that reverts this row between our SELECT and UPDATE is caught correctly —
  -- the UPDATE simply matches zero rows and we report a clean "already ended" error.
  UPDATE public.staff_transfers
     SET revert_at = v_rec.revert_at + (p_additional_value || ' ' || p_additional_unit || 's')::interval,
         note = trim(both ' ' from
           COALESCE(v_rec.note || ' ', '') ||
           format('[+%s %s%s added %s]', p_additional_value, p_additional_unit, CASE WHEN p_additional_value = 1 THEN '' ELSE 's' END, to_char(now() AT TIME ZONE 'Asia/Kathmandu', 'DD Mon HH24:MI'))
         )
   WHERE id = p_transfer_id
     AND applied = true
     AND reverted = false
     AND revert_at > now()
  RETURNING revert_at INTO v_new_revert_at;

  IF v_new_revert_at IS NULL THEN
    RAISE EXCEPTION 'extend_staff_transfer: this transfer has already ended; start a new transfer instead';
  END IF;

  RETURN v_new_revert_at;
END;
$$;

REVOKE ALL ON FUNCTION public.extend_staff_transfer(uuid, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.extend_staff_transfer(uuid, integer, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.extend_staff_transfer(uuid, integer, text) TO authenticated;

-- Record migration ---------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('146', 'extend-staff-transfer')
ON CONFLICT (version) DO NOTHING;
