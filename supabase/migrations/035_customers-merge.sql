-- Migration 035: merge duplicate customers (Phase 1, step 3 — DESTRUCTIVE) ⚠️
--
-- Collapses duplicate customer rows so one person = one record per (org, normalized
-- phone). For each duplicate group the canonical row is the OLDEST (created_at, id);
-- every other row's bookings are repointed to the canonical, its email/notes are
-- coalesced onto the canonical if missing, and the redundant row is deleted.
--
-- IRREVERSIBLE without a backup. Safety layers:
--   * runs in ONE transaction (apply_migration wraps it) — any assert failure rolls back;
--   * every deleted row is snapshotted as jsonb into customer_merge_log BEFORE deletion;
--   * bookings.customer_id is the only FK to customers (NO ACTION) so a missed repoint
--     would block the DELETE instead of orphaning;
--   * full-table backups (customers_backup_<date>, bookings_custid_backup_<date>) are
--     taken right before running (on prod also confirm PITR).
--
-- Idempotent: re-running after a successful merge finds no duplicate groups and is a
-- no-op. Portable: groups by data, no hardcoded UUIDs.

-- 1. Permanent audit/undo log -----------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_merge_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merged_id    uuid NOT NULL,
  canonical_id uuid NOT NULL,
  org_id       uuid,
  nphone       text,
  merged_row   jsonb NOT NULL,
  merged_at    timestamptz NOT NULL DEFAULT now()
);
-- Holds customer PII; keep it out of the API (admin/service-role only).
ALTER TABLE public.customer_merge_log ENABLE ROW LEVEL SECURITY;

-- 2. Resolve canonical + merged ids for every duplicate group ----------------
CREATE TEMP TABLE _merge_map ON COMMIT DROP AS
WITH norm AS (
  SELECT id, org_id, created_at,
         NULLIF(regexp_replace(coalesce(phone,''), '\D', '', 'g'), '') AS nphone
  FROM public.customers
),
grp AS (
  SELECT org_id, nphone,
         (array_agg(id ORDER BY created_at, id))[1] AS canonical_id
  FROM norm
  WHERE nphone IS NOT NULL
  GROUP BY org_id, nphone
  HAVING count(*) > 1
)
SELECT n.id AS merged_id, g.canonical_id, g.org_id, g.nphone
FROM norm n
JOIN grp g ON g.org_id = n.org_id AND g.nphone = n.nphone
WHERE n.id <> g.canonical_id;

-- 3. Snapshot the rows we are about to delete --------------------------------
INSERT INTO public.customer_merge_log (merged_id, canonical_id, org_id, nphone, merged_row)
SELECT m.merged_id, m.canonical_id, m.org_id, m.nphone, to_jsonb(c)
FROM _merge_map m
JOIN public.customers c ON c.id = m.merged_id;

-- 4. Repoint bookings from each merged row to its canonical ------------------
UPDATE public.bookings b
   SET customer_id = m.canonical_id
  FROM _merge_map m
 WHERE b.customer_id = m.merged_id;

-- 5. Coalesce email/notes onto the canonical where it is missing them --------
UPDATE public.customers can
   SET email = COALESCE(can.email, src.email),
       notes = COALESCE(can.notes, src.notes)
  FROM (
    SELECT DISTINCT ON (m.canonical_id) m.canonical_id, c.email, c.notes
    FROM _merge_map m
    JOIN public.customers c ON c.id = m.merged_id
    WHERE c.email IS NOT NULL OR c.notes IS NOT NULL
    ORDER BY m.canonical_id, c.created_at
  ) src
 WHERE can.id = src.canonical_id;

-- 6. Delete the redundant rows ----------------------------------------------
DELETE FROM public.customers c
 USING _merge_map m
 WHERE c.id = m.merged_id;

-- 7. Assert integrity (else ROLLBACK) ---------------------------------------
DO $$
DECLARE v_expected int; v_remaining int; v_orphans int;
BEGIN
  SELECT count(*) INTO v_expected  FROM _merge_map;
  SELECT count(*) INTO v_remaining FROM public.customers c JOIN _merge_map m ON c.id = m.merged_id;
  IF v_remaining <> 0 THEN
    RAISE EXCEPTION 'migration-035: % merged customers still present after delete', v_remaining;
  END IF;
  SELECT count(*) INTO v_orphans FROM public.bookings b JOIN _merge_map m ON b.customer_id = m.merged_id;
  IF v_orphans <> 0 THEN
    RAISE EXCEPTION 'migration-035: % bookings still point at a deleted customer', v_orphans;
  END IF;
  RAISE NOTICE 'migration-035: merged % redundant customer row(s), 0 orphans', v_expected;
END $$;

-- 8. Record migration -------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('035', 'customers-merge')
ON CONFLICT (version) DO NOTHING;
