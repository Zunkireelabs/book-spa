-- Migration 326: "now at" helpers derived from staff_transfers windows, window-aware branch helpers, therapists_at_branch RPC (ZNLY-113).
-- Home = therapists.branch_id / users.branch_id (mig 325 stops temp transfers flipping them). Where someone IS right now
-- comes from the open staff_transfers window.
--   _staff_transfer_windows(ids[])   internal: the transfers of those therapists as [ws, we) windows (same end rule as mig 317);
--                                    filters by therapist BEFORE the window function, so it stays on idx_staff_transfers_therapist
--   therapist_now_at(id, at)         branch a therapist is at at that instant (open window's destination, else home)
--   _user_effective_branch(user)     staff login with an open window -> receiving branch; everyone else -> users.branch_id
--   get_user_branch_id()             -> _user_effective_branch(auth.uid())       (signature/volatility/security unchanged)
--   get_user_branch_ids()            -> today's set UNION the open-window branch of the linked therapist
--   therapists_at_branch(branch, from, to)   home + visiting rows for a branch over a time range
-- Idempotent. Applied: stage - / prod -.

BEGIN;

-- A window ends at revert_at / reverted_at, or when the next transfer of the same therapist starts (mig 317).
-- Return-leg rows are included: they end an earlier window and make "home" explicit. Scheduled (not yet started) rows
-- simply have ws in the future.
CREATE OR REPLACE FUNCTION public._staff_transfer_windows(p_therapist_ids uuid[])
RETURNS TABLE(transfer_id uuid, therapist_id uuid, org_id uuid, from_branch_id uuid, to_branch_id uuid,
              ws timestamptz, we timestamptz, is_return_leg boolean, is_permanent boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH w AS (
    SELECT st.id, st.therapist_id, st.org_id, st.from_branch_id, st.to_branch_id, st.revert_at, st.reverted, st.reverted_at,
           st.is_return_leg, (st.is_permanent OR st.revert_at IS NULL) AS permanent,
           ((st.effective_date + COALESCE(st.start_time, '00:00'::time)) AT TIME ZONE 'Asia/Kathmandu') AS ws
      FROM public.staff_transfers st
     WHERE st.therapist_id = ANY(p_therapist_ids)
  )
  SELECT w.id, w.therapist_id, w.org_id, w.from_branch_id, w.to_branch_id, w.ws,
         LEAST(COALESCE(w.revert_at, 'infinity'::timestamptz),
               CASE WHEN w.reverted THEN COALESCE(w.reverted_at, w.ws) ELSE 'infinity'::timestamptz END,
               COALESCE(lead(w.ws) OVER (PARTITION BY w.therapist_id ORDER BY w.ws), 'infinity'::timestamptz)),
         w.is_return_leg, w.permanent
    FROM w;
$$;
REVOKE ALL ON FUNCTION public._staff_transfer_windows(uuid[]) FROM PUBLIC, anon, authenticated;

-- The destination of a TEMPORARY window covering p_at, or NULL (no window: they are home).
CREATE OR REPLACE FUNCTION public._therapist_open_window_branch(p_therapist_id uuid, p_at timestamptz DEFAULT now())
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT w.to_branch_id
    FROM public._staff_transfer_windows(ARRAY[p_therapist_id]) w
   WHERE NOT w.is_return_leg AND NOT w.is_permanent
     AND w.ws <= p_at AND p_at < w.we
   ORDER BY w.ws DESC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public._therapist_open_window_branch(uuid, timestamptz) FROM PUBLIC, anon, authenticated;

-- Internal (no org check): for SECURITY DEFINER callers such as cron notifications.
CREATE OR REPLACE FUNCTION public._therapist_now_at(p_therapist_id uuid, p_at timestamptz DEFAULT now())
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(public._therapist_open_window_branch(p_therapist_id, p_at),
                  (SELECT t.branch_id FROM public.therapists t WHERE t.id = p_therapist_id));
$$;
REVOKE ALL ON FUNCTION public._therapist_now_at(uuid, timestamptz) FROM PUBLIC, anon, authenticated;

-- Client-callable: NULL unless the therapist belongs to the caller's organization.
CREATE OR REPLACE FUNCTION public.therapist_now_at(p_therapist_id uuid, p_at timestamptz DEFAULT now())
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM public.therapists t WHERE t.id = p_therapist_id AND t.org_id = (SELECT public.get_user_org_id()))
              THEN public._therapist_now_at(p_therapist_id, p_at) END;
$$;
REVOKE ALL ON FUNCTION public.therapist_now_at(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.therapist_now_at(uuid, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public._user_effective_branch(p_user_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(
           CASE WHEN u.role = 'staff' AND u.therapist_id IS NOT NULL
                THEN public._therapist_open_window_branch(u.therapist_id, now()) END,
           u.branch_id)
    FROM public.users u WHERE u.id = p_user_id;
$$;
-- Internal: only the SECURITY DEFINER helpers/triggers call it. Never granted (it takes any user id).
REVOKE ALL ON FUNCTION public._user_effective_branch(uuid) FROM PUBLIC, anon, authenticated;

-- Same signature, volatility (STABLE) and security (DEFINER, no search_path override) as before.
CREATE OR REPLACE FUNCTION public.get_user_branch_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT public._user_effective_branch(auth.uid());
$function$;

CREATE OR REPLACE FUNCTION public.get_user_branch_ids()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ARRAY(
    SELECT branch_id FROM public.users WHERE id = auth.uid() AND branch_id IS NOT NULL
    UNION
    SELECT branch_id FROM public.user_branches WHERE user_id = auth.uid()
    UNION
    SELECT public._user_effective_branch(auth.uid())
  );
$function$;

-- Home rows: every active therapist whose home is the branch (window_* set when lent out during the range).
-- Visiting rows: temporary windows INTO the branch overlapping the range. Org-checked like therapist_shifts_for_range.
CREATE OR REPLACE FUNCTION public.therapists_at_branch(p_branch_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS TABLE(therapist_id uuid, role_here text, window_from timestamptz, window_to timestamptz, transfer_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.branches br WHERE br.id = p_branch_id AND br.org_id = (SELECT get_user_org_id())) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT t.id, 'home'::text, lent.ws, lent.we, lent.transfer_id
    FROM public.therapists t
    LEFT JOIN LATERAL (
      SELECT w.ws, w.we, w.transfer_id
        FROM public._staff_transfer_windows(ARRAY[t.id]) w
       WHERE NOT w.is_return_leg AND NOT w.is_permanent
         AND w.to_branch_id <> t.branch_id AND w.ws < p_to AND w.we > p_from
       ORDER BY w.ws LIMIT 1
    ) lent ON true
   WHERE t.branch_id = p_branch_id AND t.is_active = true
  UNION ALL
  SELECT w.therapist_id, 'visiting'::text, w.ws, w.we, w.transfer_id
    FROM public._staff_transfer_windows(
           ARRAY(SELECT DISTINCT st.therapist_id FROM public.staff_transfers st   -- pre-filter: only therapists with a transfer into this branch
                  WHERE st.to_branch_id = p_branch_id AND NOT st.is_return_leg)) w
    JOIN public.therapists t ON t.id = w.therapist_id AND t.is_active = true
   WHERE w.to_branch_id = p_branch_id AND NOT w.is_return_leg AND NOT w.is_permanent
     AND t.branch_id <> p_branch_id AND w.ws < p_to AND w.we > p_from;
END;
$$;
REVOKE ALL ON FUNCTION public.therapists_at_branch(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.therapists_at_branch(uuid, timestamptz, timestamptz) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('326', 'therapist-now-at-helpers')
ON CONFLICT (version) DO NOTHING;

COMMIT;
