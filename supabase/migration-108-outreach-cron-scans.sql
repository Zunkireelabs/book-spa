-- Migration 108: outreach cron scan / drain functions (the execution spine)
--
-- Copies migration-040's SECURITY DEFINER cron-function structure: functions
-- own = postgres, bypass RLS internally, are NOT exposed to PostgREST
-- (REVOKE ALL FROM anon/authenticated), and are invoked only by pg_cron.
--
-- outreach_scan_winback() calls public.notify_outreach_review(), which is
-- defined in migration-109 (the NEXT file, not this one) — a forward
-- reference across migration files. This is intentional, not a defect:
-- plpgsql function bodies are only checked for the *existence* of referenced
-- objects when the function is actually CALLED, not when it is CREATEd, and
-- both migration-108 and migration-109 land in the same deploy batch, well
-- before pg_cron ever fires outreach-scan-winback. See
-- .superpowers/sdd/outreach-phase1-plan/progress.md pre-flight scan.
--
-- Idempotent: CREATE OR REPLACE FUNCTION, named cron jobs (unschedule then
-- reschedule), guarded private-schema/table creation.

BEGIN;

-- 0. Private config for the drain function's HTTP call -----------------------
-- Single-row table holding the send-message Edge Function's base URL and the
-- bearer token outreach_drain_outbox() sends as Authorization: Bearer <token>.
-- Lives in a `private` schema (not `public`, not in the PostgREST exposed
-- schema list, no RLS policies needed) so it is unreachable from the REST
-- API regardless of role — simpler than adding RLS-with-zero-policies to a
-- public-schema table and forgetting to also keep it out of the exposed
-- schema config.
CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.outreach_function_config (
  function_base_url text NOT NULL,
  cron_bearer_token text NOT NULL
);

-- 1. outreach_scan_winback() ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.outreach_scan_winback()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer := 0;
  v_review_org_ids uuid[];
  v_org_id uuid;
BEGIN
  WITH win_back_rules AS (
    SELECT r.id AS rule_id, r.org_id, r.channel, r.template_id, r.send_mode, r.lapsed_days
    FROM public.outreach_rules r
    WHERE r.trigger_type = 'win_back'
      AND r.enabled = true
      AND r.lapsed_days IS NOT NULL
  ),
  last_completed AS (
    -- Most recent Completed booking per customer, restricted to customers
    -- whose org has an enabled win_back rule.
    SELECT DISTINCT ON (b.customer_id)
      b.customer_id,
      b.org_id,
      b.updated_at AS completed_at
    FROM public.bookings b
    JOIN win_back_rules wr ON wr.org_id = b.org_id
    WHERE b.status = 'Completed'
      AND b.customer_id IS NOT NULL
    ORDER BY b.customer_id, b.updated_at DESC
  ),
  candidates AS (
    SELECT
      lc.customer_id,
      lc.org_id,
      lc.completed_at,
      wr.rule_id,
      wr.channel,
      wr.template_id,
      wr.send_mode
    FROM last_completed lc
    JOIN win_back_rules wr ON wr.org_id = lc.org_id
    WHERE lc.completed_at < now() - (wr.lapsed_days || ' days')::interval
  ),
  eligible AS (
    SELECT
      c.*,
      cu.full_name AS customer_name,
      cu.email     AS customer_email,
      'win_back:' || c.customer_id || ':' || to_char(c.completed_at, 'YYYY-MM-DD') AS dedupe_key
    FROM candidates c
    JOIN public.customers cu ON cu.id = c.customer_id
    WHERE cu.email IS NOT NULL AND btrim(cu.email) <> ''
  ),
  templated AS (
    SELECT
      e.*,
      t.subject AS template_subject,
      t.body    AS template_body
    FROM eligible e
    JOIN public.outreach_templates t ON t.id = e.template_id
  ),
  inserted AS (
    INSERT INTO public.outreach_messages (
      org_id, rule_id, customer_id, booking_id, channel, to_address,
      subject, body, status, source, dedupe_key
    )
    SELECT
      tp.org_id,
      tp.rule_id,
      tp.customer_id,
      NULL,
      tp.channel,
      tp.customer_email,
      replace(tp.template_subject, '{{customer_name}}', tp.customer_name),
      replace(tp.template_body, '{{customer_name}}', tp.customer_name),
      CASE WHEN tp.send_mode = 'auto' THEN 'queued' ELSE 'review' END,
      'template',
      tp.dedupe_key
    FROM templated tp
    ON CONFLICT (org_id, dedupe_key) DO NOTHING
    RETURNING org_id, status
  )
  SELECT count(*), array_agg(DISTINCT org_id) FILTER (WHERE status = 'review')
    INTO v_count, v_review_org_ids
  FROM inserted;

  -- Notify managers/admins in every org that got at least one review-mode
  -- row from THIS run (array captured directly off the INSERT...RETURNING
  -- above, no re-query / timing heuristic needed).
  IF v_review_org_ids IS NOT NULL THEN
    FOREACH v_org_id IN ARRAY v_review_org_ids LOOP
      PERFORM public.notify_outreach_review(v_org_id);
    END LOOP;
  END IF;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.outreach_scan_winback() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.outreach_scan_winback() FROM anon;
REVOKE ALL ON FUNCTION public.outreach_scan_winback() FROM authenticated;

-- 2. outreach_drain_outbox() ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.outreach_drain_outbox()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cfg          private.outreach_function_config;
  v_msg          record;
  v_count        integer := 0;
  v_request_id   bigint;
BEGIN
  -- Stale-send requeue: any row stuck in 'sending' for >10 minutes (the
  -- Edge Function call fired but we never heard back — fire-and-forget risk
  -- per the design doc) goes back to 'queued' so the next drain retries it.
  UPDATE public.outreach_messages
     SET status = 'queued',
         updated_at = now()
   WHERE status = 'sending'
     AND updated_at < now() - interval '10 minutes';

  SELECT * INTO v_cfg FROM private.outreach_function_config LIMIT 1;
  IF v_cfg IS NULL THEN
    -- No provider config yet (e.g. fresh environment before the operator
    -- seeds private.outreach_function_config) — nothing to drain.
    RETURN 0;
  END IF;

  FOR v_msg IN
    SELECT id
    FROM public.outreach_messages
    WHERE status IN ('queued', 'approved')
      AND scheduled_for <= now()
    ORDER BY scheduled_for
    LIMIT 50
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.outreach_messages
       SET status = 'sending',
           updated_at = now()
     WHERE id = v_msg.id;

    SELECT net.http_post(
      url     := v_cfg.function_base_url || '/send-message',
      headers := jsonb_build_object(
                   'Authorization', 'Bearer ' || v_cfg.cron_bearer_token,
                   'Content-Type', 'application/json'
                 ),
      body    := jsonb_build_object('message_id', v_msg.id)
    ) INTO v_request_id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.outreach_drain_outbox() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.outreach_drain_outbox() FROM anon;
REVOKE ALL ON FUNCTION public.outreach_drain_outbox() FROM authenticated;

-- 3. outreach_enqueue_for_completed(p_booking_id) -------------------------------
-- Called by the frontend (supabase.rpc) when a booking transitions to
-- Completed. This is the one function in this file callable from an
-- authenticated staff session — it does NOT get revoked from authenticated.
CREATE OR REPLACE FUNCTION public.outreach_enqueue_for_completed(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_booking  public.bookings;
  v_rule     public.outreach_rules;
  v_template public.outreach_templates;
  v_customer public.customers;
  v_delay_hours integer;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF v_booking IS NULL THEN
    RETURN;
  END IF;

  IF v_booking.customer_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_rule
  FROM public.outreach_rules
  WHERE org_id = (SELECT org_id FROM public.branches WHERE id = v_booking.branch_id)
    AND trigger_type = 'review_request'
    AND enabled = true;

  IF v_rule IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_template FROM public.outreach_templates WHERE id = v_rule.template_id;
  IF v_template IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_customer FROM public.customers WHERE id = v_booking.customer_id;
  IF v_customer IS NULL OR v_customer.email IS NULL OR btrim(v_customer.email) = '' THEN
    RETURN;
  END IF;

  v_delay_hours := COALESCE(v_rule.review_delay_hours, 24);

  INSERT INTO public.outreach_messages (
    org_id, rule_id, customer_id, booking_id, channel, to_address,
    subject, body, status, source, dedupe_key, scheduled_for
  )
  VALUES (
    v_rule.org_id,
    v_rule.id,
    v_customer.id,
    v_booking.id,
    v_rule.channel,
    v_customer.email,
    replace(v_template.subject, '{{customer_name}}', v_customer.full_name),
    replace(v_template.body, '{{customer_name}}', v_customer.full_name),
    CASE WHEN v_rule.send_mode = 'auto' THEN 'queued' ELSE 'review' END,
    'template',
    'review_request:' || p_booking_id,
    now() + (v_delay_hours || ' hours')::interval
  )
  ON CONFLICT (org_id, dedupe_key) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.outreach_enqueue_for_completed(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.outreach_enqueue_for_completed(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.outreach_enqueue_for_completed(uuid) TO authenticated;

-- 4. Cron schedule --------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'outreach-scan-winback') THEN
    PERFORM cron.unschedule('outreach-scan-winback');
  END IF;
  -- '15 0 * * *' UTC = 06:00 Asia/Kathmandu (UTC+5:45), matching
  -- migration-040's own choice of expression for the same target local time.
  PERFORM cron.schedule(
    'outreach-scan-winback',
    '15 0 * * *',
    'SELECT public.outreach_scan_winback();'
  );
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'outreach-drain-outbox') THEN
    PERFORM cron.unschedule('outreach-drain-outbox');
  END IF;
  PERFORM cron.schedule(
    'outreach-drain-outbox',
    '*/5 * * * *',
    'SELECT public.outreach_drain_outbox();'
  );
END $$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('108', 'outreach-cron-scans')
ON CONFLICT (version) DO NOTHING;

COMMIT;
