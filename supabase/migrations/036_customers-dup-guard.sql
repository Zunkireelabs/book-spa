-- Migration 036: customer dup-guard — partial unique index (Phase 1, step 4 — REVERSIBLE)
--
-- First-ever enforcement of "one customer per phone per org." Adds a PARTIAL UNIQUE
-- index on (org_id, normalized phone) so duplicate rows can no longer re-form after the
-- migration-035 merge. The normalization matches migration-034/035 and the JS
-- replace(/\D/g,'') exactly: strip every non-digit, NULL out the empty result.
--
-- Phoneless customers are EXCLUDED by the WHERE clause (a NULL normalized phone is never
-- unique-checked), so multiple phoneless rows per org remain allowed — they are surfaced
-- for human review, never auto-merged.
--
-- Safe to add only AFTER 035 has collapsed duplicates (0 dup groups remain); otherwise the
-- CREATE would fail on the first colliding pair. Idempotent (IF NOT EXISTS) + portable.
--
-- Reversible (no data loss):
--   DROP INDEX IF EXISTS public.customers_org_nphone_uniq;

-- 1. One phone per org (phoneless rows excluded) ----------------------------
CREATE UNIQUE INDEX IF NOT EXISTS customers_org_nphone_uniq
  ON public.customers
  (org_id, (NULLIF(regexp_replace(coalesce(phone,''), '\D', '', 'g'), '')))
  WHERE NULLIF(regexp_replace(coalesce(phone,''), '\D', '', 'g'), '') IS NOT NULL;

-- 2. Record migration -------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('036', 'customers-dup-guard')
ON CONFLICT (version) DO NOTHING;
