-- Migration 332: "Branches I hear from" (ZNLY-135 V35b).
-- Admins can limit which branches interrupt them (pop-up + sound). NULL = every branch. The Inbox always keeps everything.
-- RLS: notification_settings already allows own rows only (migration 331).

ALTER TABLE public.notification_settings
  ADD COLUMN IF NOT EXISTS heard_branch_ids uuid[];

-- Pop-up sound choice (V35b-fix9). One of the five built-in Web Audio sounds; default = the original chime.
ALTER TABLE public.notification_settings
  ADD COLUMN IF NOT EXISTS sound_choice text NOT NULL DEFAULT 'chime';

ALTER TABLE public.notification_settings
  DROP CONSTRAINT IF EXISTS notification_settings_sound_choice_check;
ALTER TABLE public.notification_settings
  ADD CONSTRAINT notification_settings_sound_choice_check
  CHECK (sound_choice IN ('chime', 'ding', 'twotone', 'marimba', 'woof'));

INSERT INTO public.schema_migrations (version, name)
VALUES ('332', 'notification-heard-branches')
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst, 'reload schema';
