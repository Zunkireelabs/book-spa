-- Migration 102: outreach_templates
--
-- Message templates used by outreach rules (migration-103) to render
-- outreach_messages (migration-104). A template is either org-wide
-- (branch_id NULL) or scoped to one branch. body is plain text with
-- mustache-style {{customer_name}} placeholders — Postgres does no
-- templating, callers do a simple string replace (see outreach_scan_winback,
-- migration-108).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS + recreate.

BEGIN;

CREATE TABLE IF NOT EXISTS public.outreach_templates (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id               uuid        NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  key                     text        NOT NULL,
  channel                 text        NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp')),
  subject                 text        NULL,
  body                    text        NOT NULL,
  whatsapp_template_name  text        NULL,
  whatsapp_template_lang  text        NULL,
  is_active               boolean     NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_outreach_templates_org_key UNIQUE (org_id, key)
);

CREATE INDEX IF NOT EXISTS idx_outreach_templates_org
  ON public.outreach_templates(org_id);

-- RLS: any org member can read; only manager/admin can write ----------------
ALTER TABLE public.outreach_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members read outreach templates" ON public.outreach_templates;
CREATE POLICY "Org members read outreach templates"
  ON public.outreach_templates FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id());

DROP POLICY IF EXISTS "Manager/admin write outreach templates" ON public.outreach_templates;
CREATE POLICY "Manager/admin write outreach templates"
  ON public.outreach_templates FOR INSERT
  TO authenticated
  WITH CHECK (org_id = get_user_org_id() AND get_user_role() IN ('manager', 'admin'));

DROP POLICY IF EXISTS "Manager/admin update outreach templates" ON public.outreach_templates;
CREATE POLICY "Manager/admin update outreach templates"
  ON public.outreach_templates FOR UPDATE
  TO authenticated
  USING (org_id = get_user_org_id() AND get_user_role() IN ('manager', 'admin'))
  WITH CHECK (org_id = get_user_org_id() AND get_user_role() IN ('manager', 'admin'));

DROP POLICY IF EXISTS "Manager/admin delete outreach templates" ON public.outreach_templates;
CREATE POLICY "Manager/admin delete outreach templates"
  ON public.outreach_templates FOR DELETE
  TO authenticated
  USING (org_id = get_user_org_id() AND get_user_role() IN ('manager', 'admin'));

INSERT INTO public.schema_migrations (version, name)
VALUES ('102', 'outreach-templates')
ON CONFLICT (version) DO NOTHING;

COMMIT;
