-- Migration 032: in-app notifications
--
-- Delivers a persistent notification to a discount requester when a
-- manager/admin approves or declines their request. A row survives the
-- requester being offline, and (unlike a realtime-only ping) still works for
-- declines, where rejectDiscount() wipes discount_requested_by on the booking.
--
-- Rows are created only through enqueue_notification() (SECURITY DEFINER) so a
-- manager can address a notification to a DIFFERENT user (the requester)
-- without granting a broad INSERT policy. Recipients can read/update only their
-- own rows.
--
-- Idempotent: IF NOT EXISTS, DROP POLICY IF EXISTS before CREATE, guarded
-- publication add.

-- 1. Table -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type       text NOT NULL,
  title      text NOT NULL,
  body       text,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  read       boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications(user_id, created_at DESC);

-- 2. RLS ---------------------------------------------------------------------
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own notifications" ON public.notifications;
CREATE POLICY "Users read own notifications"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users update own notifications" ON public.notifications;
CREATE POLICY "Users update own notifications"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- No INSERT policy: inserts happen only through enqueue_notification() below.

-- 3. Secure insert -----------------------------------------------------------
-- Lets an approver (manager/admin) create a notification for the requester.
-- SECURITY DEFINER bypasses the missing INSERT policy; the role guard keeps
-- ordinary staff from spamming arbitrary users.
CREATE OR REPLACE FUNCTION public.enqueue_notification(
  p_user_id    uuid,
  p_type       text,
  p_title      text,
  p_body       text,
  p_booking_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF (SELECT role FROM public.users WHERE id = auth.uid())
       NOT IN ('manager', 'admin') THEN
    RAISE EXCEPTION 'Not authorized to enqueue notifications'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, booking_id)
  VALUES (p_user_id, p_type, p_title, p_body, p_booking_id)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION
  public.enqueue_notification(uuid, text, text, text, uuid) TO authenticated;

-- 4. Realtime ----------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;

-- 5. Record migration --------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('032', 'notifications')
ON CONFLICT (version) DO NOTHING;
