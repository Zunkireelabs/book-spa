-- Migration 109: notify_outreach_review()
--
-- notifications.type has no CHECK constraint (confirmed: plain text column,
-- migration-032), so no DDL is needed to add the 'outreach_review_pending'
-- type value itself — this migration only adds the function.
--
-- notify_outreach_review() copies enqueue_notification()'s shape
-- (migration-032): inserts one notifications row per manager/admin user in
-- the org, summarizing how many outreach_messages rows are currently
-- awaiting review. It is called from public.outreach_scan_winback()
-- (migration-108, the PREVIOUS file) at the end of a scan, whenever that
-- scan inserted at least one review-mode row — a forward reference from
-- 108 to this file's function, ruled not a defect (see migration-108's
-- header comment and progress.md's pre-flight scan: plpgsql function
-- bodies aren't validated against referenced objects until CALL time, and
-- both migrations land in the same deploy batch before cron ever runs).
--
-- Unlike enqueue_notification() (which is client-facing, callable by a
-- manager approving/declining a discount for a DIFFERENT user, so it needs
-- a role check), this function is only ever called internally from another
-- SECURITY DEFINER function — no explicit GRANT to authenticated is needed,
-- and no role check is required since there is no direct external caller to
-- gate.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.

BEGIN;

CREATE OR REPLACE FUNCTION public.notify_outreach_review(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pending_count integer;
BEGIN
  SELECT count(*) INTO v_pending_count
  FROM public.outreach_messages
  WHERE org_id = p_org_id
    AND status = 'review';

  IF v_pending_count = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, booking_id)
  SELECT
    u.id,
    'outreach_review_pending',
    'Outreach messages awaiting review',
    v_pending_count || ' outreach message' ||
      CASE WHEN v_pending_count = 1 THEN '' ELSE 's' END ||
      ' need your review before sending.',
    NULL
  FROM public.users u
  WHERE u.org_id = p_org_id
    AND u.role IN ('manager', 'admin');
END;
$$;

-- Internal call only (invoked from outreach_scan_winback, a SECURITY
-- DEFINER function) — not client-facing, so no GRANT to authenticated.
REVOKE ALL ON FUNCTION public.notify_outreach_review(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_outreach_review(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.notify_outreach_review(uuid) FROM authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('109', 'outreach-notifications-types')
ON CONFLICT (version) DO NOTHING;

COMMIT;
