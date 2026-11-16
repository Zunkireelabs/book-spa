-- Migration 358: login <-> therapist link (users.therapist_id) and a link-based user-branch sync (ZNLY-113).
-- Until now a staff login was tied to its therapist row only by a case-insensitive full_name match inside
-- _sync_user_branch_for_transfer (mig 048). Add a real, nullable, unique link, backfill it where the name match is
-- unambiguous on BOTH sides (never guess), and have the sync helper use the link.
-- Idempotent. Applied: stage - / prod -.

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS therapist_id uuid REFERENCES public.therapists(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_therapist_id_unique
  ON public.users (therapist_id) WHERE therapist_id IS NOT NULL;

-- Backfill: staff logins only, same org, exactly one therapist by name and that therapist claimed by exactly one login.
WITH cand AS (
  SELECT u.id AS user_id, t.id AS therapist_id,
         count(*) OVER (PARTITION BY u.id) AS per_user,
         count(*) OVER (PARTITION BY t.id) AS per_therapist
    FROM public.users u
    JOIN public.therapists t
      ON t.org_id = u.org_id AND lower(trim(t.name)) = lower(trim(u.full_name))
   WHERE u.role = 'staff' AND u.therapist_id IS NULL
)
UPDATE public.users u
   SET therapist_id = c.therapist_id
  FROM cand c
 WHERE u.id = c.user_id AND c.per_user = 1 AND c.per_therapist = 1
   AND NOT EXISTS (SELECT 1 FROM public.users x WHERE x.therapist_id = c.therapist_id);

-- Sync helper: now follows the link (no name match). Same signature and semantics: permanent moves only call it.
CREATE OR REPLACE FUNCTION public._sync_user_branch_for_transfer(
  p_therapist_id uuid,
  p_org_id       uuid,
  p_to_branch_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_n int;
BEGIN
  UPDATE public.users
     SET branch_id = p_to_branch_id
   WHERE therapist_id = p_therapist_id
     AND org_id = p_org_id
     AND role = 'staff'
     AND branch_id IS DISTINCT FROM p_to_branch_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n = 0 AND NOT EXISTS (SELECT 1 FROM public.users WHERE therapist_id = p_therapist_id AND org_id = p_org_id AND role = 'staff') THEN
    RAISE NOTICE 'transfer: no staff login linked to therapist %; users.branch_id unchanged', p_therapist_id;
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public._sync_user_branch_for_transfer(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._sync_user_branch_for_transfer(uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public._sync_user_branch_for_transfer(uuid, uuid, uuid) FROM authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('358', 'users-therapist-link')
ON CONFLICT (version) DO NOTHING;

COMMIT;
