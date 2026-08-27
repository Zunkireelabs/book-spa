-- Migration 106: outreach_provider_config
--
-- Per-org, per-channel non-secret provider settings (e.g. which email
-- provider, which "from" address). NO API KEYS IN THIS TABLE — secrets
-- (API keys, tokens) stay in Edge Function environment variables, never in
-- a table readable via PostgREST/RLS. `settings` jsonb is for non-secret
-- config only (e.g. a from-name, a region).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS + recreate.

BEGIN;

CREATE TABLE IF NOT EXISTS public.outreach_provider_config (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  channel      text        NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp')),
  provider     text        NOT NULL,
  from_address text        NULL,
  -- Non-secret config only — NO API keys or tokens in this column. Secrets
  -- live in Edge Function env vars, not in a table exposed to PostgREST.
  settings     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_outreach_provider_config_org_channel UNIQUE (org_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_outreach_provider_config_org
  ON public.outreach_provider_config(org_id);

-- RLS: manager/admin only, read + write.
ALTER TABLE public.outreach_provider_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Manager/admin read outreach provider config" ON public.outreach_provider_config;
CREATE POLICY "Manager/admin read outreach provider config"
  ON public.outreach_provider_config FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id() AND get_user_role() IN ('manager', 'admin'));

DROP POLICY IF EXISTS "Manager/admin insert outreach provider config" ON public.outreach_provider_config;
CREATE POLICY "Manager/admin insert outreach provider config"
  ON public.outreach_provider_config FOR INSERT
  TO authenticated
  WITH CHECK (org_id = get_user_org_id() AND get_user_role() IN ('manager', 'admin'));

DROP POLICY IF EXISTS "Manager/admin update outreach provider config" ON public.outreach_provider_config;
CREATE POLICY "Manager/admin update outreach provider config"
  ON public.outreach_provider_config FOR UPDATE
  TO authenticated
  USING (org_id = get_user_org_id() AND get_user_role() IN ('manager', 'admin'))
  WITH CHECK (org_id = get_user_org_id() AND get_user_role() IN ('manager', 'admin'));

DROP POLICY IF EXISTS "Manager/admin delete outreach provider config" ON public.outreach_provider_config;
CREATE POLICY "Manager/admin delete outreach provider config"
  ON public.outreach_provider_config FOR DELETE
  TO authenticated
  USING (org_id = get_user_org_id() AND get_user_role() IN ('manager', 'admin'));

INSERT INTO public.schema_migrations (version, name)
VALUES ('106', 'outreach-provider-config')
ON CONFLICT (version) DO NOTHING;

COMMIT;
