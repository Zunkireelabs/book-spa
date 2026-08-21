-- Migration 104: outreach_messages (the outbox + send log)
--
-- Every outbound outreach message — queued, awaiting review, sent, or failed
-- — is one row here. Rows are written ONLY by SECURITY DEFINER functions
-- (outreach_scan_winback / outreach_enqueue_for_completed, migration-108) or
-- a manual-send RPC added in Task 3 — never directly by client INSERT/UPDATE,
-- mirroring the notifications (migration-032) / voucher_payments
-- (migration-100) "insert-via-function, no broad write policy" pattern.
--
-- dedupe_key + the (org_id, dedupe_key) unique constraint is what makes the
-- cron scans safe to re-run: ON CONFLICT DO NOTHING on that key prevents
-- double-sending the same trigger occurrence.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS + recreate.

BEGIN;

CREATE TABLE IF NOT EXISTS public.outreach_messages (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rule_id             uuid        NULL REFERENCES public.outreach_rules(id) ON DELETE SET NULL,
  customer_id         uuid        NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  booking_id          uuid        NULL REFERENCES public.bookings(id) ON DELETE SET NULL,
  channel             text        NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp')),
  to_address          text        NOT NULL,
  subject             text        NULL,
  body                text        NOT NULL,
  status              text        NOT NULL DEFAULT 'queued' CHECK (status IN
                                   ('queued', 'review', 'approved', 'sending', 'sent', 'delivered', 'failed', 'cancelled')),
  source              text        NOT NULL DEFAULT 'template' CHECK (source IN ('template', 'ai')),
  provider            text        NULL,
  provider_message_id text        NULL,
  error               text        NULL,
  dedupe_key          text        NOT NULL,
  scheduled_for       timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_outreach_messages_org_dedupe UNIQUE (org_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_outreach_messages_org_status_scheduled
  ON public.outreach_messages(org_id, status, scheduled_for);

CREATE INDEX IF NOT EXISTS idx_outreach_messages_org_customer_created
  ON public.outreach_messages(org_id, customer_id, created_at DESC);

-- RLS: manager/admin read only for Phase 1 (staff don't need the outreach
-- log). NO INSERT/UPDATE policy for authenticated/anon — all writes go
-- through SECURITY DEFINER functions (migration-108) or a manual-send RPC
-- (Task 3). Grant nothing extra.
ALTER TABLE public.outreach_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Manager/admin read outreach messages" ON public.outreach_messages;
CREATE POLICY "Manager/admin read outreach messages"
  ON public.outreach_messages FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id() AND get_user_role() IN ('manager', 'admin'));

INSERT INTO public.schema_migrations (version, name)
VALUES ('104', 'outreach-messages')
ON CONFLICT (version) DO NOTHING;

COMMIT;
