-- Seed: production Outreach configuration
--
-- Outreach became visible in production on 2026-09-25 (VITE_ENABLE_OUTREACH,
-- PR #336), but the feature was unusable: production had zero rows in
-- outreach_provider_config, outreach_templates and outreach_rules. The panel
-- rendered a correct empty state rather than erroring, but nothing could be
-- sent, and with no templates the Rules tab's template dropdowns stay disabled
-- ("No templates for this channel") so no rule can be saved either.
--
-- This seeds the minimum configuration that makes Outreach usable, for every
-- organization in production.
--
-- SAFETY -- read before running:
--
--   Every rule is seeded with enabled = false AND send_mode = 'review'.
--   Nothing is sent to a real customer as a result of running this script.
--   Staging's equivalent rows include an enabled, send_mode = 'auto' rule;
--   that shape is deliberately NOT reproduced here, because applying it to
--   production would immediately start emailing live customers. Turning
--   outreach on stays an explicit human action in the Outreach UI.
--
--   No credential is present in this file. outreach_provider_config has no
--   column for an API key by design (migration-106) -- the Resend key lives
--   server-side in the Edge Function environment. This table only records
--   which provider and From address to use.
--
-- PREREQUISITE: the From address domain below must be verified in the
-- production Resend account, otherwise sends will fail once enabled. Staging
-- uses the same address, so this is expected to already hold.
--
-- Idempotent: every statement is ON CONFLICT DO NOTHING against a real unique
-- constraint (org_id+channel / org_id+key / org_id+trigger_type), so re-running
-- changes nothing and existing rows are never overwritten.
-- Portable: organizations are resolved by slug, never by hardcoded UUID.

BEGIN;

-- 1. Email provider, one row per organization ---------------------------------

INSERT INTO public.outreach_provider_config (org_id, channel, provider, from_address, settings)
SELECT o.id, 'email', 'resend', 'noreply@zennly.io', '{}'::jsonb
FROM public.organizations o
ON CONFLICT (org_id, channel) DO NOTHING;

-- 2. Starter email templates ---------------------------------------------------
-- layout_id is left NULL, matching the working staging template. The three
-- global layouts (Simple / Branded Header / Promo Banner) can be attached later
-- from the Templates tab.

INSERT INTO public.outreach_templates (org_id, key, channel, subject, body, is_active)
SELECT o.id,
       'win_back',
       'email',
       'We miss you, {{customer_name}}!',
       '<p>Hi {{customer_name}}, it has been a while since your last visit to '
         || o.name || '. Come back and relax with us!</p>',
       true
FROM public.organizations o
ON CONFLICT (org_id, key) DO NOTHING;

INSERT INTO public.outreach_templates (org_id, key, channel, subject, body, is_active)
SELECT o.id,
       'review_request',
       'email',
       'How was your visit to ' || o.name || '?',
       '<p>Hi {{customer_name}}, thank you for visiting ' || o.name
         || '. We would love to hear how it went.</p>',
       true
FROM public.organizations o
ON CONFLICT (org_id, key) DO NOTHING;

-- 3. Rules -- created DISABLED and in review mode ------------------------------
-- These exist so the Rules tab is configurable rather than dead. They send
-- nothing until someone enables them deliberately.

INSERT INTO public.outreach_rules (org_id, trigger_type, channel, template_id, enabled, send_mode, use_ai)
SELECT o.id, 'win_back', 'email', t.id, false, 'review', false
FROM public.organizations o
JOIN public.outreach_templates t ON t.org_id = o.id AND t.key = 'win_back'
ON CONFLICT (org_id, trigger_type) DO NOTHING;

INSERT INTO public.outreach_rules (org_id, trigger_type, channel, template_id, enabled, send_mode, use_ai)
SELECT o.id, 'review_request', 'email', t.id, false, 'review', false
FROM public.organizations o
JOIN public.outreach_templates t ON t.org_id = o.id AND t.key = 'review_request'
ON CONFLICT (org_id, trigger_type) DO NOTHING;

-- 4. Verify --------------------------------------------------------------------

-- The inserts above hardcode enabled = false and send_mode = 'review', and
-- every one is ON CONFLICT DO NOTHING, so this script can never enable a rule
-- nor flip an existing one to auto-send. The report below is informational
-- only: it deliberately does NOT fail on finding enabled rules, because once
-- an operator turns outreach on in the UI that is the desired state, and a
-- re-run of this idempotent script must not start erroring at that point.

DO $$
DECLARE n_live int;
BEGIN
  SELECT count(*) INTO n_live
  FROM public.outreach_rules WHERE enabled AND send_mode = 'auto';

  RAISE NOTICE 'outreach seed: % provider row(s), % template(s), % rule(s)',
    (SELECT count(*) FROM public.outreach_provider_config),
    (SELECT count(*) FROM public.outreach_templates),
    (SELECT count(*) FROM public.outreach_rules);

  IF n_live > 0 THEN
    RAISE NOTICE 'note: % rule(s) are enabled and set to auto-send -- these were '
                 'turned on deliberately, not by this script', n_live;
  ELSE
    RAISE NOTICE 'no rule is enabled for auto-send; nothing will be sent until someone enables one';
  END IF;
END $$;

COMMIT;
