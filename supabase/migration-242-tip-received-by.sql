-- Migration 242: tip attribution — which staff member actually received the tip.
--
-- Confirmed with the user: a tip doesn't always go to the assigned therapist —
-- a guest might hand it to whichever staff member (service or support/front-desk)
-- they interacted with. received_by is nullable (older rows + any flow that
-- doesn't collect it stay valid) and points at public.users, not
-- public.therapists, so support staff (who may have no therapists row at all)
-- are selectable too. No RLS change needed — this is just metadata on a row
-- already covered by booking_tips' existing INSERT policy (migration-240).
--
-- Reversible (manual):
--   ALTER TABLE public.booking_tips DROP COLUMN IF EXISTS received_by;

BEGIN;

ALTER TABLE public.booking_tips
  ADD COLUMN IF NOT EXISTS received_by uuid REFERENCES public.users(id);

CREATE INDEX IF NOT EXISTS idx_booking_tips_received_by ON public.booking_tips(received_by);

INSERT INTO public.schema_migrations (version, name)
VALUES ('242', 'tip-received-by')
ON CONFLICT (version) DO NOTHING;

COMMIT;
