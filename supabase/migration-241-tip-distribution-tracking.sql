-- Migration 241: tip distribution tracking.
--
-- v1 (migration-240) only ever recorded a tip's amount — there was no way to
-- tell whether a recorded tip had actually been handed to staff yet. This adds
-- that status (distributed_at/distributed_by) plus an admin/manager-only RPC
-- to mark a branch's currently-pending tips as distributed, following the same
-- "no client UPDATE policy, mutation only via a SECURITY DEFINER RPC" posture
-- migration-237's admin_correct_payment_mode already established for the
-- sibling immutable `payments` table — booking_tips keeps its own "no
-- UPDATE/DELETE RLS policy" invariant from migration-240 unchanged; this RPC
-- is the only path that can ever flip distributed_at.
--
-- Scope: bulk, branch-wide ("mark everything currently pending for this
-- branch as distributed"), not per-tip — matches how the amount is surfaced
-- (a running pending/distributed total, not an itemized list) and keeps this
-- a single, auditable action rather than N individual writes.
--
-- Reversible (manual):
--   ALTER TABLE public.booking_tips DROP COLUMN IF EXISTS distributed_at, DROP COLUMN IF EXISTS distributed_by;
--   DROP FUNCTION IF EXISTS public.mark_tips_distributed(uuid);

BEGIN;

ALTER TABLE public.booking_tips
  ADD COLUMN IF NOT EXISTS distributed_at timestamptz,
  ADD COLUMN IF NOT EXISTS distributed_by uuid REFERENCES public.users(id);

CREATE INDEX IF NOT EXISTS idx_booking_tips_distributed_at ON public.booking_tips(distributed_at);

CREATE OR REPLACE FUNCTION public.mark_tips_distributed(p_branch_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role       user_role := get_user_role();
  v_caller_org uuid      := get_user_org_id();
  v_branch_org uuid;
  v_count      integer;
BEGIN
  IF v_role NOT IN ('admin', 'manager') THEN
    RAISE EXCEPTION 'mark_tips_distributed: admin or manager role required'
      USING ERRCODE = 'P0003';
  END IF;

  SELECT org_id INTO v_branch_org FROM public.branches WHERE id = p_branch_id;
  IF v_branch_org IS NULL THEN
    RAISE EXCEPTION 'mark_tips_distributed: branch % not found', p_branch_id
      USING ERRCODE = 'P0003';
  END IF;
  IF v_branch_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'mark_tips_distributed: branch is not in your organization'
      USING ERRCODE = 'P0003';
  END IF;

  WITH updated AS (
    UPDATE public.booking_tips bt
       SET distributed_at = now(),
           distributed_by = auth.uid()
      FROM public.bookings b
     WHERE b.id = bt.booking_id
       AND b.branch_id = p_branch_id
       AND bt.distributed_at IS NULL
    RETURNING bt.id
  )
  SELECT count(*) INTO v_count FROM updated;

  IF v_count > 0 THEN
    INSERT INTO public.audit_logs
      (branch_id, table_name, record_id, action_type, old_data, new_data, changed_by, reason)
    VALUES
      (p_branch_id, 'booking_tips', p_branch_id, 'TIPS_DISTRIBUTED',
       jsonb_build_object('count', v_count),
       jsonb_build_object('distributed_at', now()),
       auth.uid(), 'Bulk tip distribution for branch');
  END IF;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_tips_distributed(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_tips_distributed(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_tips_distributed(uuid) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('241', 'tip-distribution-tracking')
ON CONFLICT (version) DO NOTHING;

COMMIT;
