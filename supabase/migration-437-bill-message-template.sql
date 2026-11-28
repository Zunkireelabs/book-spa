-- Migration 437 (ZNLY-410 step 2, part C): default "Bill" message per org, edited in Outreach → Rules.
-- One outreach_templates row per channel ((org_id, key) is unique): bill_ready = email, bill_ready_whatsapp = WhatsApp.
-- Wording never has an amount; only {first_name}, {business}, {bill_number}. Orgs created later need no row: the app falls back to this same text.
-- Idempotent (ON CONFLICT DO NOTHING keeps an admin's edits). Reversible: DELETE FROM public.outreach_templates WHERE key IN ('bill_ready','bill_ready_whatsapp');
BEGIN;

INSERT INTO public.outreach_templates (org_id, key, channel, subject, body, is_active)
SELECT o.id, 'bill_ready', 'email', 'Your bill {bill_number} from {business}',
       'Hi {first_name}, thank you for visiting {business} today. Your bill {bill_number} is ready.', true
FROM public.organizations o
ON CONFLICT (org_id, key) DO NOTHING;

INSERT INTO public.outreach_templates (org_id, key, channel, subject, body, is_active)
SELECT o.id, 'bill_ready_whatsapp', 'whatsapp', NULL,
       'Hi {first_name}, thank you for visiting {business} today. Your bill {bill_number} is ready.', true
FROM public.organizations o
ON CONFLICT (org_id, key) DO NOTHING;

INSERT INTO public.schema_migrations (version, name)
VALUES ('437', 'bill-message-template')
ON CONFLICT (version) DO NOTHING;

COMMIT;
