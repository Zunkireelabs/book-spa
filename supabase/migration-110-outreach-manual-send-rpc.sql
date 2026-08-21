-- Migration 110: outreach_send_manual() — one-off manual outreach send RPC
--
-- outreach_messages (migration-104) deliberately has NO INSERT policy for
-- authenticated/anon — every row is written by a SECURITY DEFINER function
-- (outreach_scan_winback / outreach_enqueue_for_completed, migration-108).
-- Task 3's `sendCustomerMessage()` (src/services/api.js) needs a one-off,
-- staff-triggered send path (e.g. "message this customer now" from the UI)
-- that does not go through a rule or a cron scan. Rather than open a broad
-- client-writable INSERT policy on the outbox table, this migration adds a
-- narrow SECURITY DEFINER RPC that inserts exactly one row after checking
-- the caller's role and org, keeping the "insert-via-function only"
-- discipline intact (same reasoning as migration-104's header comment).
--
-- dedupe_key is caller-supplied (Task 3 generates it client-side as
-- `manual:${customerId}:${Date.now()}`, since PostgREST/RPC callers can't
-- invoke gen_random_uuid() server-side from the client) — this function does
-- not attempt to generate one itself, it just relies on the table's
-- (org_id, dedupe_key) UNIQUE constraint to reject an accidental replay.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.

BEGIN;

CREATE OR REPLACE FUNCTION public.outreach_send_manual(
  p_customer_id uuid,
  p_booking_id  uuid,
  p_channel     text,
  p_to_address  text,
  p_subject     text,
  p_body        text,
  p_dedupe_key  text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_role   text;
  v_caller_org_id uuid;
  v_customer_org  uuid;
  v_message_id    uuid;
BEGIN
  SELECT role, org_id INTO v_caller_role, v_caller_org_id
  FROM public.users
  WHERE id = auth.uid();

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('staff', 'manager', 'admin') THEN
    RAISE EXCEPTION 'outreach_send_manual: caller is not authorized to send outreach messages';
  END IF;

  SELECT org_id INTO v_customer_org
  FROM public.customers
  WHERE id = p_customer_id;

  IF v_customer_org IS NULL THEN
    RAISE EXCEPTION 'outreach_send_manual: customer % not found', p_customer_id;
  END IF;

  IF v_customer_org <> v_caller_org_id THEN
    RAISE EXCEPTION 'outreach_send_manual: customer does not belong to caller''s organization';
  END IF;

  IF p_channel NOT IN ('email', 'sms', 'whatsapp') THEN
    RAISE EXCEPTION 'outreach_send_manual: invalid channel %', p_channel;
  END IF;

  IF p_to_address IS NULL OR btrim(p_to_address) = '' THEN
    RAISE EXCEPTION 'outreach_send_manual: to_address is required';
  END IF;

  IF p_body IS NULL OR btrim(p_body) = '' THEN
    RAISE EXCEPTION 'outreach_send_manual: body is required';
  END IF;

  -- booking_id is optional but if provided must belong to the same org
  -- (resolved via branches, same pattern as outreach_enqueue_for_completed).
  IF p_booking_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.bookings b
      JOIN public.branches br ON br.id = b.branch_id
      WHERE b.id = p_booking_id
        AND br.org_id = v_caller_org_id
    ) THEN
      RAISE EXCEPTION 'outreach_send_manual: booking % not found in caller''s organization', p_booking_id;
    END IF;
  END IF;

  INSERT INTO public.outreach_messages (
    org_id, rule_id, customer_id, booking_id, channel, to_address,
    subject, body, status, source, dedupe_key
  )
  VALUES (
    v_caller_org_id,
    NULL,
    p_customer_id,
    p_booking_id,
    p_channel,
    p_to_address,
    p_subject,
    p_body,
    'queued',
    'template',
    COALESCE(p_dedupe_key, 'manual:' || p_customer_id || ':' || extract(epoch FROM now())::text)
  )
  RETURNING id INTO v_message_id;

  RETURN v_message_id;
END;
$$;

-- Client-facing: staff/manager/admin call this directly from an
-- authenticated session. The role + org checks above are what keep this
-- safe to grant broadly (mirrors credit_pending_referral_for_booking /
-- outreach_enqueue_for_completed's "internal check, then grant to
-- authenticated" pattern rather than a client-side-only guard).
REVOKE ALL ON FUNCTION public.outreach_send_manual(uuid, uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.outreach_send_manual(uuid, uuid, text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.outreach_send_manual(uuid, uuid, text, text, text, text, text) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('110', 'outreach-manual-send-rpc')
ON CONFLICT (version) DO NOTHING;

COMMIT;
