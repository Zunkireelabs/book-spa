-- Migration 038: staff org_id + staff_transfers audit table (Phase 2, step 1 — additive, REVERSIBLE)
--
-- First step of the staff "single current branch + transfer" model (see
-- docs/feature/centralize-customer-staff-data.md). Adds therapists.org_id as the org-level
-- identity while KEEPING therapists.branch_id NOT NULL as the staffer's CURRENT branch. A
-- transfer (migration-039) flips branch_id to another branch in the same org and writes an
-- audit row here. No row merge, no constraint swap — purely additive.
--
-- Idempotent + portable: resolves org through the branches FK (no hardcoded UUIDs), so the
-- same file runs unchanged on staging and production.
--
-- Reversible (no data loss beyond the new column/table):
--   DROP TABLE IF EXISTS public.staff_transfers;
--   DROP INDEX IF EXISTS public.idx_therapists_org;
--   ALTER TABLE public.therapists DROP COLUMN IF EXISTS org_id;

-- 1. Add therapists.org_id (nullable first so we can backfill) ----------------
ALTER TABLE public.therapists
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id);

-- 2. Backfill from each therapist's current branch ---------------------------
UPDATE public.therapists t
   SET org_id = b.org_id
  FROM public.branches b
 WHERE b.id = t.branch_id
   AND t.org_id IS DISTINCT FROM b.org_id;

-- 3. Verify zero NULLs BEFORE locking the column -----------------------------
DO $$
DECLARE n_null int;
BEGIN
  SELECT count(*) INTO n_null FROM public.therapists WHERE org_id IS NULL;
  IF n_null > 0 THEN
    RAISE EXCEPTION 'migration-038: % therapists still have NULL org_id; aborting before SET NOT NULL', n_null;
  END IF;
END $$;

-- 4. Lock it in --------------------------------------------------------------
ALTER TABLE public.therapists ALTER COLUMN org_id SET NOT NULL;

-- 5. Index for org-scoped reads ----------------------------------------------
CREATE INDEX IF NOT EXISTS idx_therapists_org ON public.therapists(org_id);

-- 6. Audit table: where each staffer has been transferred --------------------
CREATE TABLE IF NOT EXISTS public.staff_transfers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  therapist_id   uuid NOT NULL REFERENCES public.therapists(id) ON DELETE CASCADE,
  org_id         uuid NOT NULL REFERENCES public.organizations(id),
  from_branch_id uuid NOT NULL REFERENCES public.branches(id),
  to_branch_id   uuid NOT NULL REFERENCES public.branches(id),
  transferred_by uuid REFERENCES public.users(id),
  transferred_at timestamptz NOT NULL DEFAULT now(),
  note           text,
  CONSTRAINT staff_transfers_distinct_branches CHECK (from_branch_id <> to_branch_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_transfers_therapist ON public.staff_transfers(therapist_id);
CREATE INDEX IF NOT EXISTS idx_staff_transfers_org        ON public.staff_transfers(org_id);

-- 7. RLS: org members may READ their org's transfer history. Writes happen ONLY
--    through the SECURITY DEFINER transfer function (migration-039) — no direct
--    INSERT/UPDATE/DELETE policy is created, so the audit trail can't be forged.
ALTER TABLE public.staff_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own org transfers" ON public.staff_transfers;
CREATE POLICY "Users can read own org transfers"
  ON public.staff_transfers FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id());

-- 8. Record migration --------------------------------------------------------
INSERT INTO public.schema_migrations (version, name)
VALUES ('038', 'staff-org-id-and-transfers')
ON CONFLICT (version) DO NOTHING;
