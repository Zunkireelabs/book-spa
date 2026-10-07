-- Seed: rename sbal's branch from "Main Branch" (onboarding placeholder) to "Lazimpat"
-- (the actual neighborhood the business is in).
--
-- Data, not schema — stays a manual step per supabase/PROMOTION.md, run separately
-- against staging and production since they share no rows. Idempotent and resolves
-- by org slug (not UUID) so the same script runs on both databases.
--
-- Run this before (or in the same sitting as) seed-sbal-branch-address.sql — that
-- script's predicate already accepts both 'Main Branch' and 'Lazimpat' so it stays
-- re-runnable regardless of ordering.

UPDATE public.branches b
SET name = 'Lazimpat'
FROM public.organizations o
WHERE o.id = b.org_id
  AND o.slug = 'sbal'
  AND b.name = 'Main Branch';
