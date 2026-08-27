-- Migration 112: outreach_cancel_message() + outreach_bulk_approve_messages()
--
-- outreach_messages ships with only a SELECT RLS policy (migration-104) —
-- all writes must go through a SECURITY DEFINER RPC (per migration-104's
-- header comment and the outreach_send_manual/outreach_approve_message
-- precedents in migration-110/111). cancelOutreachMessage() and
-- bulkApproveOutreach() in src/services/api.js were missed in that pass and
-- still wrote via raw client .update() calls:
--   - bulkApproveOutreach: RLS silently updates zero rows, no error
--     surfaces, function returns { data: [], error: null } — bulk approve
--     silently no-ops while the UI reports success.
--   - cancelOutreachMessage: zero rows back through .single() raises a
--     PGRST116 "no rows returned" error — Cancel always errors for the
--     operator and never actually cancels.
--
-- This migration adds two narrow SECURITY DEFINER RPCs mirroring the role +
-- org + status-gate discipline of outreach_approve_message (migration-111).
--
-- Idempotent: CREATE OR REPLACE FUNCTION.

BEGIN;

-- Cancellable from any non-terminal state (queued/review/approved), matching
-- the existing .in('status', ['queued', 'review', 'approved']) gate that
-- cancelOutreachMessage() already applied client-side. A message already
-- sent/delivered/failed/cancelled is terminal and should not be cancellable.
CREATE OR REPLACE FUNCTION public.outreach_cancel_message(
  p_message_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_role   text;
  v_caller_org_id uuid;
BEGIN
  SELECT role, org_id INTO v_caller_role, v_caller_org_id
  FROM public.users
  WHERE id = auth.uid();

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('manager', 'admin') THEN
    RAISE EXCEPTION 'outreach_cancel_message: caller is not authorized to cancel outreach messages';
  END IF;

  UPDATE public.outreach_messages
  SET status     = 'cancelled',
      updated_at = now()
  WHERE id = p_message_id
    AND org_id = v_caller_org_id
    AND status IN ('queued', 'review', 'approved');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'outreach_cancel_message: message % not found, not in caller''s organization, or not in a cancellable status', p_message_id;
  END IF;
END;
$$;

-- Bulk approve, 'review' status only — matches the single-message approve
-- gate. Returns the count of rows actually updated (via GET DIAGNOSTICS) so
-- the caller can detect ids that were already non-review and skipped.
CREATE OR REPLACE FUNCTION public.outreach_bulk_approve_messages(
  p_message_ids uuid[]
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_role   text;
  v_caller_org_id uuid;
  v_updated_count integer;
BEGIN
  SELECT role, org_id INTO v_caller_role, v_caller_org_id
  FROM public.users
  WHERE id = auth.uid();

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('manager', 'admin') THEN
    RAISE EXCEPTION 'outreach_bulk_approve_messages: caller is not authorized to approve outreach messages';
  END IF;

  UPDATE public.outreach_messages
  SET status     = 'approved',
      updated_at = now()
  WHERE id = ANY(p_message_ids)
    AND org_id = v_caller_org_id
    AND status = 'review';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  RETURN v_updated_count;
END;
$$;

-- Client-facing: manager/admin call these directly from an authenticated
-- session. The role + org + status checks above are what keep this safe to
-- grant broadly (mirrors outreach_send_manual/outreach_approve_message's
-- "internal check, then grant to authenticated" pattern).
REVOKE ALL ON FUNCTION public.outreach_cancel_message(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.outreach_cancel_message(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.outreach_cancel_message(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.outreach_bulk_approve_messages(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.outreach_bulk_approve_messages(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.outreach_bulk_approve_messages(uuid[]) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('112', 'outreach-cancel-and-bulk-approve-rpc')
ON CONFLICT (version) DO NOTHING;

COMMIT;
