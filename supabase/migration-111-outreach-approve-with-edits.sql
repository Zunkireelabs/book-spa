-- Migration 111: outreach_approve_message() — approve-with-edits RPC
--
-- ReviewQueuePanel.jsx (Task 4) lets a manager/admin edit a queued message's
-- subject/body inline before approving it. outreach_messages has no client
-- UPDATE policy (write path is SECURITY DEFINER-only, per migration-104's
-- header comment and migration-110's outreach_send_manual precedent) so
-- Approve was previously a plain status flip that silently discarded any
-- inline edits. This migration adds a narrow SECURITY DEFINER RPC that
-- approves a message and, if the caller supplies overrides, persists the
-- edited subject/body in the same statement.
--
-- Only approvable from 'review' status, matching the existing state
-- discipline in approveOutreachMessage()/bulkApproveOutreach() (both filter
-- .eq('status', 'review')). p_subject/p_body are optional — omitting them
-- (or passing NULL) keeps the existing content via COALESCE, so plain
-- approve-with-no-edits call sites keep working unchanged.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.

BEGIN;

CREATE OR REPLACE FUNCTION public.outreach_approve_message(
  p_message_id uuid,
  p_subject    text DEFAULT NULL,
  p_body       text DEFAULT NULL
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
    RAISE EXCEPTION 'outreach_approve_message: caller is not authorized to approve outreach messages';
  END IF;

  UPDATE public.outreach_messages
  SET status     = 'approved',
      subject    = COALESCE(p_subject, subject),
      body       = COALESCE(p_body, body),
      updated_at = now()
  WHERE id = p_message_id
    AND org_id = v_caller_org_id
    AND status = 'review';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'outreach_approve_message: message % not found, not in caller''s organization, or not in review status', p_message_id;
  END IF;
END;
$$;

-- Client-facing: manager/admin call this directly from an authenticated
-- session. The role + org + status checks above are what keep this safe to
-- grant broadly (mirrors outreach_send_manual's "internal check, then grant
-- to authenticated" pattern, migration-110).
REVOKE ALL ON FUNCTION public.outreach_approve_message(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.outreach_approve_message(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.outreach_approve_message(uuid, text, text) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('111', 'outreach-approve-with-edits')
ON CONFLICT (version) DO NOTHING;

COMMIT;
