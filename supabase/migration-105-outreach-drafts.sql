-- Migration 105: outreach_drafts (AI staging)
--
-- Unused by any Phase-1 code path — this schema ships now per the design doc
-- so Phase 3 (AI-drafted outreach) doesn't need a new migration to add it.
-- One row per AI-generated draft attached to an outreach_messages row,
-- capturing the raw model output plus what a manager/admin edited it to
-- before approving.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS + recreate.

BEGIN;

CREATE TABLE IF NOT EXISTS public.outreach_drafts (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  message_id     uuid        NOT NULL REFERENCES public.outreach_messages(id) ON DELETE CASCADE,
  model          text        NULL,
  input_tokens   integer     NULL,
  output_tokens  integer     NULL,
  ai_raw         jsonb       NULL,
  edited_subject text        NULL,
  edited_body    text        NULL,
  reviewed_by    uuid        NULL REFERENCES public.users(id),
  reviewed_at    timestamptz NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outreach_drafts_org
  ON public.outreach_drafts(org_id);

CREATE INDEX IF NOT EXISTS idx_outreach_drafts_message
  ON public.outreach_drafts(message_id);

-- RLS: same pattern as outreach_messages — manager/admin read only, no
-- broad write policy. Writes will go through a SECURITY DEFINER function
-- added when Phase 3 wires up the AI drafting flow.
ALTER TABLE public.outreach_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Manager/admin read outreach drafts" ON public.outreach_drafts;
CREATE POLICY "Manager/admin read outreach drafts"
  ON public.outreach_drafts FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id() AND get_user_role() IN ('manager', 'admin'));

INSERT INTO public.schema_migrations (version, name)
VALUES ('105', 'outreach-drafts')
ON CONFLICT (version) DO NOTHING;

COMMIT;
