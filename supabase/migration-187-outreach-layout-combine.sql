-- Migration 187: combine outreach_layouts into the two send-time functions
--
-- Extends outreach_scan_winback() and outreach_enqueue_for_completed()
-- (both originally defined in migration-108) so a template's layout_id (if
-- set) wraps the body before the existing {{customer_name}} substitution
-- runs. A template with layout_id NULL falls back to the literal string
-- '{{content}}' as the "wrapper" (a no-op passthrough), so untouched
-- templates behave identically to before this migration.
--
-- Also adds a {{org_name}} merge field (substituted from organizations.name,
-- same replace() pattern as {{customer_name}}) — needed because the seeded
-- "Branded Header" built-in layout (migration-186) shows the org's name in
-- its header and must not hardcode one specific org's name.
--
-- CREATE OR REPLACE with the SAME parameter list as migration-108 (no new
-- overload risk here, unlike issue_package in migration-185 — neither
-- function's signature changes, only their bodies).
--
-- Idempotent: CREATE OR REPLACE FUNCTION.

BEGIN;

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
    SELECT DISTINCT ON (b.customer_id)
      b.id AS booking_id,
      b.customer_id,
      br.org_id,
      b.updated_at AS completed_at
    FROM public.bookings b
    JOIN public.branches br ON br.id = b.branch_id
    JOIN win_back_rules wr ON wr.org_id = br.org_id
    WHERE b.status = 'Completed'
      AND b.customer_id IS NOT NULL
    ORDER BY b.customer_id, b.updated_at DESC
  ),
  candidates AS (
    SELECT
      lc.booking_id,
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
      t.subject   AS template_subject,
      t.body      AS template_body,
      l.html      AS layout_html,
      org.name    AS org_name
    FROM eligible e
    JOIN public.outreach_templates t ON t.id = e.template_id
    LEFT JOIN public.outreach_layouts l ON l.id = t.layout_id
    JOIN public.organizations org ON org.id = e.org_id
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
      tp.booking_id,
      tp.channel,
      tp.customer_email,
      replace(
        replace(tp.template_subject, '{{customer_name}}', tp.customer_name),
        '{{org_name}}', tp.org_name
      ),
      replace(
        replace(
          replace(COALESCE(tp.layout_html, '{{content}}'), '{{content}}', tp.template_body),
          '{{customer_name}}', tp.customer_name
        ),
        '{{org_name}}', tp.org_name
      ),
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
  v_layout   public.outreach_layouts;
  v_customer public.customers;
  v_org_name text;
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

  IF v_template.layout_id IS NOT NULL THEN
    SELECT * INTO v_layout FROM public.outreach_layouts WHERE id = v_template.layout_id;
  END IF;

  SELECT * INTO v_customer FROM public.customers WHERE id = v_booking.customer_id;
  IF v_customer IS NULL OR v_customer.email IS NULL OR btrim(v_customer.email) = '' THEN
    RETURN;
  END IF;

  SELECT name INTO v_org_name FROM public.organizations WHERE id = v_rule.org_id;

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
    replace(
      replace(v_template.subject, '{{customer_name}}', v_customer.full_name),
      '{{org_name}}', v_org_name
    ),
    replace(
      replace(
        replace(COALESCE(v_layout.html, '{{content}}'), '{{content}}', v_template.body),
        '{{customer_name}}', v_customer.full_name
      ),
      '{{org_name}}', v_org_name
    ),
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

INSERT INTO public.schema_migrations (version, name)
VALUES ('187', 'outreach-layout-combine')
ON CONFLICT (version) DO NOTHING;

COMMIT;
