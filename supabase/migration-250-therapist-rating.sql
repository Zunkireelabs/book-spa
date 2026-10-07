-- Migration 250: therapists.rating — admin-set, org-gated (additive, REVERSIBLE)
--
-- Scoped per the clarified ask: an org-level on/off toggle (migration-248's
-- enable_staff_ratings) plus a manually admin-set rating value per staff member — not a
-- customer review-collection system. No reviews table, no post-booking review flow; that
-- would be a much larger follow-up (moderation, aggregation) and isn't what was asked here.
--
-- Reversible:
--   ALTER TABLE public.therapists DROP CONSTRAINT IF EXISTS therapists_rating_check;
--   ALTER TABLE public.therapists DROP COLUMN IF EXISTS rating;

BEGIN;

ALTER TABLE public.therapists
  ADD COLUMN IF NOT EXISTS rating numeric(2,1);

ALTER TABLE public.therapists
  ADD CONSTRAINT therapists_rating_check
  CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5));

INSERT INTO public.schema_migrations (version, name)
VALUES ('250', 'therapist-rating')
ON CONFLICT (version) DO NOTHING;

COMMIT;
