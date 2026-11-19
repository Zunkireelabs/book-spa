-- Migration 365: notifications get a branch + category, plus per-user pop-up/sound prefs (ZNLY-135, V35a)
--
-- * notifications.branch_id (nullable FK) and notifications.category (bookings|approvals|team|stock|guests).
--   A BEFORE INSERT trigger fills both when the producer left them NULL, so no existing producer changes:
--   category from `type` (notification_category_for), branch from bookings.branch_id when booking_id is set.
--   Old rows are backfilled the same way.
-- * notification_prefs (user_id, category, popup, sound): one row per person per category. No row = the app defaults
--   (src/lib/notificationRules.js DEFAULT_PREFS: Bookings/Approvals pop-up+sound, Team pop-up only, Stock/Guests neither).
-- * notification_settings (user_id PK): global switches (sound on, quiet outside the branch's opening hours).
-- RLS: own rows only on both new tables.
-- Idempotent. Applied: stage - / prod -.

BEGIN;

-- 1. Columns -------------------------------------------------------------------
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS category text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_category_check') THEN
    ALTER TABLE public.notifications ADD CONSTRAINT notifications_category_check
      CHECK (category IS NULL OR category IN ('bookings', 'approvals', 'team', 'stock', 'guests'));
  END IF;
END $$;

-- 2. type -> category (every type a producer writes today; unknown types fall back to bookings) ---------------
CREATE OR REPLACE FUNCTION public.notification_category_for(p_type text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_type IN ('new_online_booking', 'booking_cancelled_by_guest', 'booking_rescheduled_by_guest') THEN 'bookings'
    WHEN p_type IN ('discount', 'discount_request', 'discount_approved', 'discount_declined', 'discount_fyi') THEN 'approvals'
    WHEN p_type IN ('transferred_staff_reminder', 'attendance_gap') THEN 'team'
    WHEN p_type IN ('low_stock') THEN 'stock'
    WHEN p_type IN ('outreach_review_pending', 'renewal_due') THEN 'guests'
    ELSE 'bookings'
  END
$$;

-- 3. Fill trigger --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notifications_fill_defaults()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.category IS NULL THEN
    NEW.category := public.notification_category_for(NEW.type);
  END IF;
  IF NEW.branch_id IS NULL AND NEW.booking_id IS NOT NULL THEN
    SELECT b.branch_id INTO NEW.branch_id FROM public.bookings b WHERE b.id = NEW.booking_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notifications_fill_defaults() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notifications_fill_defaults ON public.notifications;
CREATE TRIGGER trg_notifications_fill_defaults
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_fill_defaults();

-- 4. Backfill ------------------------------------------------------------------
UPDATE public.notifications SET category = public.notification_category_for(type) WHERE category IS NULL;
UPDATE public.notifications n SET branch_id = b.branch_id
  FROM public.bookings b WHERE n.branch_id IS NULL AND n.booking_id = b.id;

CREATE INDEX IF NOT EXISTS idx_notifications_user_read_created
  ON public.notifications(user_id, read, created_at DESC);

-- 5. Prefs ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_prefs (
  user_id  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('bookings', 'approvals', 'team', 'stock', 'guests')),
  popup    boolean NOT NULL,
  sound    boolean NOT NULL,
  PRIMARY KEY (user_id, category)
);

CREATE TABLE IF NOT EXISTS public.notification_settings (
  user_id               uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  sound_enabled         boolean NOT NULL DEFAULT true,
  quiet_outside_hours   boolean NOT NULL DEFAULT true
);

ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own notification prefs" ON public.notification_prefs;
CREATE POLICY "Users manage own notification prefs"
  ON public.notification_prefs FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users manage own notification settings" ON public.notification_settings;
CREATE POLICY "Users manage own notification settings"
  ON public.notification_settings FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_prefs, public.notification_settings TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('365', 'notifications-category-prefs')
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
