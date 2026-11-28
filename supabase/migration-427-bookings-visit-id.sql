-- Migration 427: bookings.visit_id + safe backfill (ZNLY-402, ships with ZNLY-401)
--
-- PURPOSE
--   A "visit" = one person's services created by one Save. visit_id links the booking rows of one
--   visit. NULL = the booking is its own visit (never guessed). booking_group_id keeps meaning
--   "party of several people" (group booking). Nothing in the app reads visit_id yet, so this
--   migration changes no behaviour. See temp_ss/gate2-401-402-logic.md (V1-V7, D1-D5).
--
-- DDL
--   bookings.visit_id uuid NULL (no default, no constraint) + partial index WHERE visit_id IS NOT NULL.
--   No new RLS policy needed: bookings is already RLS-on and org-scoped; a new column inherits it.
--   bookings_safe lists explicit columns, so it does not expose visit_id until a later piece adds it.
--
-- BACKFILL (only the safe case). visit_id := booking_group_id for groups where, counting ALL rows
--   incl. Cancelled: exactly 1 distinct non-null customer_id, no row with customer_id NULL, more than
--   1 row, all rows on one date, and the customer does not have booking rows on more than 30 distinct
--   dates (likely placeholder customer, ZNLY-328/ZNLY-419). Left NULL on purpose: single-row groups,
--   parties (several customers), customer_id NULL rows, multi-day groups, groups under 30+-day
--   customers (the 66 Nuad groups reviewed in ZNLY-419), and rows with no booking_group_id.
--   Expected on prod (read-only counts, owner approved): Nuad 1,094 groups, Sami's 50 groups.
--   The lead re-verifies prod counts before apply.
--
-- TRIGGERS / AUDIT (read this before applying)
--   (a) The backfill is intentionally NOT audited in audit_logs and does NOT bump updated_at.
--       To achieve that, and so that locked / Completed rows do not abort it, the 4 triggers below
--       are disabled for the duration of the UPDATE only, then restored to the exact state they had:
--         trg_audit_bookings, trg_updated_at, trg_enforce_booking_immutability,
--         trg_enforce_therapist_required
--       Each is looked up in pg_trigger on public.bookings; a missing/renamed trigger is skipped,
--       a trigger already disabled is left as it was. Everything runs in this one transaction, so
--       any failure rolls back the data AND the trigger state. The UPDATE sets visit_id only and only
--       WHERE visit_id IS NULL, so re-running changes nothing. Every other trigger on bookings is
--       column-scoped or does nothing for a link-only update (no notification is sent).
--   (b) LOCKS. The file is TWO transactions (migrate-apply.sh runs plain psql -f, no wrapping txn):
--       tx1 = ADD COLUMN + COMMENT + CREATE INDEX: a brief ACCESS EXCLUSIVE lock (milliseconds,
--       also blocks reads for that moment). tx2 = the trigger-guarded backfill + ledger insert:
--       DISABLE TRIGGER takes a SHARE ROW EXCLUSIVE lock that holds back writes (INSERT/UPDATE/
--       DELETE) on public.bookings until COMMIT (seconds); reads are NOT blocked in tx2.
--       Apply on prod in a quiet hour. Re-running is safe: tx1 is IF NOT EXISTS, tx2 is idempotent,
--       and the ledger row is written only at the end of tx2.
--   (c) Expected prod counts: Nuad 1,094 groups, Sami's 50 groups.
--   (d) Bookings created after this migration but before the new app code (piece 3) goes live will
--       have a NULL visit_id. The backfill UPDATE is idempotent, so it can be re-run once after release.
--
-- ROLLBACK (valid only until the app starts writing visit_id)
--   UPDATE public.bookings SET visit_id = NULL;  -- (same trigger care as above)
--   DROP INDEX IF EXISTS public.idx_bookings_visit_id;
--   ALTER TABLE public.bookings DROP COLUMN visit_id;
--
-- Idempotent and portable (no UUIDs, no org names).

BEGIN;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS visit_id uuid NULL;

COMMENT ON COLUMN public.bookings.visit_id IS
  'Links the booking rows of one visit (one person, one Save). NULL = the booking is its own visit. booking_group_id = party of several people.';

CREATE INDEX IF NOT EXISTS idx_bookings_visit_id
  ON public.bookings (visit_id) WHERE visit_id IS NOT NULL;

COMMIT;

-- Transaction 2: backfill (write lock only) + ledger row.
BEGIN;

DO $backfill$
DECLARE
  v_names   text[] := ARRAY['trg_audit_bookings', 'trg_updated_at',
                            'trg_enforce_booking_immutability', 'trg_enforce_therapist_required'];
  v_name    text;
  v_state   "char";
  v_saved   jsonb := '{}'::jsonb;   -- trigger name -> tgenabled recorded before we touch it
  v_rows    bigint;
BEGIN
  -- 1. Record + disable only the named triggers that exist and are currently enabled.
  FOREACH v_name IN ARRAY v_names LOOP
    SELECT t.tgenabled INTO v_state
      FROM pg_trigger t
     WHERE t.tgrelid = 'public.bookings'::regclass AND t.tgname = v_name AND NOT t.tgisinternal;
    IF FOUND THEN
      v_saved := v_saved || jsonb_build_object(v_name, v_state::text);
      IF v_state <> 'D' THEN
        EXECUTE format('ALTER TABLE public.bookings DISABLE TRIGGER %I', v_name);
      END IF;
    END IF;
  END LOOP;

  -- 2. The backfill: visit_id only, only where still NULL.
  WITH grp AS (
    SELECT booking_group_id AS gid
      FROM public.bookings
     WHERE booking_group_id IS NOT NULL
     GROUP BY booking_group_id
    HAVING count(*) > 1
       AND count(DISTINCT customer_id) = 1
       AND count(*) FILTER (WHERE customer_id IS NULL) = 0
       AND count(DISTINCT date) = 1
  ),
  busy AS (   -- customers with rows on more than 30 distinct dates (possible placeholders)
    SELECT customer_id
      FROM public.bookings
     WHERE customer_id IS NOT NULL
     GROUP BY customer_id
    HAVING count(DISTINCT date) > 30
  ),
  safe AS (
    SELECT g.gid
      FROM grp g
     WHERE NOT EXISTS (
       SELECT 1 FROM public.bookings b JOIN busy ON busy.customer_id = b.customer_id
        WHERE b.booking_group_id = g.gid)
  )
  UPDATE public.bookings b
     SET visit_id = b.booking_group_id
    FROM safe
   WHERE b.booking_group_id = safe.gid
     AND b.visit_id IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RAISE NOTICE 'migration 427: visit_id set on % booking rows', v_rows;

  -- 3. Restore every trigger we touched to the state recorded in step 1.
  FOR v_name, v_state IN SELECT key, value::"char" FROM jsonb_each_text(v_saved) LOOP
    EXECUTE format('ALTER TABLE public.bookings %s TRIGGER %I',
      CASE v_state WHEN 'O' THEN 'ENABLE' WHEN 'A' THEN 'ENABLE ALWAYS'
                   WHEN 'R' THEN 'ENABLE REPLICA' ELSE 'DISABLE' END, v_name);
  END LOOP;
END
$backfill$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('427', 'bookings-visit-id')
ON CONFLICT (version) DO NOTHING;

COMMIT;
