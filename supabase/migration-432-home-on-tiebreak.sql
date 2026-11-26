-- Migration 432: therapist_home_on — deterministic tie-break between same-instant "permanent" transfer windows.
-- Function-only; no table/data change. Idempotent (CREATE OR REPLACE + ON CONFLICT DO NOTHING).
-- Applied: stage HELD / prod HELD.
--
-- Bug: _staff_transfer_windows (360) calls a row permanent when is_permanent OR revert_at IS NULL. Legacy send/return pairs
-- (created before durations became mandatory, migration 145) have revert_at NULL, the same effective_date and a NULL
-- start_time, so both rows get an identical `ws`. therapist_home_on (362) ordered only by ws, so the pick between the two was
-- arbitrary — often the "send" row — and the person looked sent away and never returned (punch_in: "not working at this branch").
-- Fix: break ties on staff_transfers.transferred_at (the entry order): latest wins for the past window (DESC), earliest wins
-- for the scheduled-future window (ASC). _staff_transfer_windows is intentionally NOT changed (other helpers use its flags).
-- Rollback: re-apply the migration 362 body of therapist_home_on (identical minus the JOIN and the transferred_at tie-breakers).

BEGIN;

CREATE OR REPLACE FUNCTION public.therapist_home_on(p_therapist_id uuid, p_at timestamptz)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(
    (SELECT w.to_branch_id FROM public._staff_transfer_windows(ARRAY[p_therapist_id]) w
       JOIN public.staff_transfers st ON st.id = w.transfer_id
      WHERE NOT w.is_return_leg AND w.is_permanent AND w.ws <= p_at ORDER BY w.ws DESC, st.transferred_at DESC LIMIT 1),
    (SELECT w.from_branch_id FROM public._staff_transfer_windows(ARRAY[p_therapist_id]) w
       JOIN public.staff_transfers st ON st.id = w.transfer_id
      WHERE NOT w.is_return_leg AND w.is_permanent AND w.ws > p_at ORDER BY w.ws ASC, st.transferred_at ASC LIMIT 1),
    (SELECT t.branch_id FROM public.therapists t WHERE t.id = p_therapist_id));
$$;
REVOKE ALL ON FUNCTION public.therapist_home_on(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.therapist_home_on(uuid, timestamptz) TO service_role;

INSERT INTO public.schema_migrations (version, name)
VALUES ('432', 'home-on-tiebreak')
ON CONFLICT (version) DO NOTHING;

COMMIT;
