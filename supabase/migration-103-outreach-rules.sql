-- Migration 103: outreach_rules
--
-- One rule per (org, trigger_type) for Phase 1 — deliberate simplification:
-- an org can have at most one win_back rule, one review_request rule, etc.
-- Multiple rules per trigger type (e.g. different lapsed_days per branch) is
-- explicitly out of scope for Phase 1 and would need a schema change (either
-- dropping the unique constraint and adding branch scoping, or a priority
-- column) in a later phase.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS + recreate.

BEGIN;

CREATE TABLE IF NOT EXISTS public.outreach_rules (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  trigger_type              text        NOT NULL CHECK (trigger_type IN
                                         ('win_back', 'review_request', 'renewal_reminder', 'birthday', 'rebooking')),
  enabled                   boolean     NOT NULL DEFAULT false,
  channel                   text        NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp')),
  template_id               uuid        NOT NULL REFERENCES public.outreach_templates(id),
  send_mode                 text        NOT NULL DEFAULT 'review' CHECK (send_mode IN ('auto', 'review')),
  use_ai                    boolean     NOT NULL DEFAULT false,
  lapsed_days               integer     NULL,
  review_delay_hours        integer     NULL DEFAULT 24,
  renewal_days_before       integer     NULL,
  rebooking_interval_days   integer     NULL,
  birthday_lead_days        integer     NULL,
  quiet_hours               jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  -- Phase 1 simplification: one rule per trigger type per org (see header).
  CONSTRAINT uq_outreach_rules_org_trigger UNIQUE (org_id, trigger_type)
);

CREATE INDEX IF NOT EXISTS idx_outreach_rules_org
  ON public.outreach_rules(org_id);

CREATE INDEX IF NOT EXISTS idx_outreach_rules_template
  ON public.outreach_rules(template_id);

-- RLS: any org member can read; only manager/admin can write ----------------
ALTER TABLE public.outreach_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members read outreach rules" ON public.outreach_rules;
CREATE POLICY "Org members read outreach rules"
  ON public.outreach_rules FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id());

DROP POLICY IF EXISTS "Manager/admin write outreach rules" ON public.outreach_rules;
CREATE POLICY "Manager/admin write outreach rules"
  ON public.outreach_rules FOR INSERT
  TO authenticated
  WITH CHECK (org_id = get_user_org_id() AND get_user_role() IN ('manager', 'admin'));

DROP POLICY IF EXISTS "Manager/admin update outreach rules" ON public.outreach_rules;
CREATE POLICY "Manager/admin update outreach rules"
  ON public.outreach_rules FOR UPDATE
  TO authenticated
  USING (org_id = get_user_org_id() AND get_user_role() IN ('manager', 'admin'))
  WITH CHECK (org_id = get_user_org_id() AND get_user_role() IN ('manager', 'admin'));

DROP POLICY IF EXISTS "Manager/admin delete outreach rules" ON public.outreach_rules;
CREATE POLICY "Manager/admin delete outreach rules"
  ON public.outreach_rules FOR DELETE
  TO authenticated
  USING (org_id = get_user_org_id() AND get_user_role() IN ('manager', 'admin'));

INSERT INTO public.schema_migrations (version, name)
VALUES ('103', 'outreach-rules')
ON CONFLICT (version) DO NOTHING;

COMMIT;
