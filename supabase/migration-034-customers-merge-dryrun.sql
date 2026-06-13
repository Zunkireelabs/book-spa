-- Migration 034: customer merge DRY-RUN report (Phase 1, step 2 — READ ONLY, NON-DESTRUCTIVE)
--
-- Reports which customer rows WOULD be merged in migration-035, without changing
-- anything. Re-runnable on staging and production. Identity key = the org plus the
-- customer's phone with all non-digits stripped (matches the JS replace(/\D/g,'')
-- and the partial unique index added later in migration-036).
--
-- Canonical row in each duplicate group = the OLDEST (created_at, then id); every
-- other row in the group is a "row to merge" (its bookings get repointed, then it is
-- deleted, in migration-035). Phoneless customers are listed separately and are
-- NEVER auto-merged.
--
-- This file makes NO schema changes and does NOT record into schema_migrations.

-- A. Duplicate phone-groups that WOULD be merged --------------------------------
WITH norm AS (
  SELECT id, org_id, branch_id, full_name, phone, email, created_at,
         NULLIF(regexp_replace(coalesce(phone,''), '\D', '', 'g'), '') AS nphone
  FROM public.customers
),
grp AS (
  SELECT org_id,
         nphone,
         count(*)                                   AS dup_count,
         count(*) - 1                               AS rows_to_merge,
         (array_agg(id   ORDER BY created_at, id))[1] AS canonical_id,
         (array_agg(full_name ORDER BY created_at, id))[1] AS canonical_name,
         array_agg(id    ORDER BY created_at, id)   AS all_ids,
         array_agg(full_name ORDER BY created_at, id) AS all_names
  FROM norm
  WHERE nphone IS NOT NULL
  GROUP BY org_id, nphone
  HAVING count(*) > 1
)
SELECT * FROM grp
ORDER BY dup_count DESC, org_id, nphone;

-- B. Summary totals -------------------------------------------------------------
-- WITH norm/grp as above; returns: dup_groups, total_rows_to_merge, phoneless_count.

-- C. Phoneless customers (surfaced for awareness; never auto-merged) -------------
-- SELECT id, org_id, full_name, email, created_at FROM public.customers
-- WHERE NULLIF(regexp_replace(coalesce(phone,''),'\D','','g'),'') IS NULL
-- ORDER BY org_id, created_at;
