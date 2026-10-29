-- Migration 334: get_dashboard(p_branch_ids, p_date), one call for the whole dashboard (ZNLY-147, V36b)
--
-- Returns one jsonb: pulse, floor, week, branches (each with its `needs` counts), money, tomorrow, my_day.
--  * Tenant + branch scope: the requested branches are cut down to the caller's org, and for manager/staff to the branches
--    they work at (get_user_branch_ids()). Anything outside that is silently dropped. No session -> empty.
--  * Money (revenue, payments by method, tips, cash expected) is null for staff. admin_viewer sees it (read-only Business view).
--  * Availability: shifts, breaks, leave and transfers come from therapist_shifts_for_range (the ZNLY-100 rule), not a new one.
--  * my_day: there is NO user -> therapist link yet (ZNLY-150). _dashboard_my_therapist_ids() matches the caller's therapist by
--    EXACT name (users.full_name = therapists.name, same org). It is the only place that does so; swap its body when ZNLY-150 lands.
--    Tips use the caller's own received tips (booking_tips.received_by = auth.uid(), mig #405 split), no name match.
--    Commission: the formula lives in JS (src/services/payrollCalc.js: computeCommissionParts / totalCommissionEarned over
--    staff_compensation), not in SQL, and a second SQL copy would drift. So my_day.commission stays null and my_day.commission_inputs
--    hands the client what that formula needs (own completed+paid service revenue today, referral rows, the caller's rates).
--    It still needs the name match (ZNLY-150) because staff_compensation is keyed by therapist. Product commission is a month-level
--    base (computeProductCommissionBase) and is not in these inputs.
--  * "Needs someone" (ZNLY-156): ONE rule, _dashboard_need_kind(). Each booking falls in exactly one kind, checked in this order:
--    discount (discount_status pending) > owed (Completed, balance > 0, any date) > not_closed (Pending/Confirmed/In-Progress whose
--    date + end_time has passed, any date) > unconfirmed (Pending, not ended, created over 2h ago) > unassigned (today, not started,
--    Pending/Confirmed, no booking_therapists). JS twin: src/lib/dashboardNeeds.js classifyNeed(). Change both together.
--    branches[].needs = {discount, owed, not_closed, unconfirmed, unassigned, total, oldest_not_closed}. Bookings from today back, any status.
--  * "Working" (staff on shift that day): ONE rule, _dashboard_working(), used by headcount, branches[].working and tomorrow.working.
-- All dates are Nepal days. STABLE SECURITY DEFINER, read-only. Idempotent.
-- Applied: stage - / prod -.

BEGIN;

-- The one place that turns "the caller" into therapist ids (ZNLY-150 replaces this body).
CREATE OR REPLACE FUNCTION public._dashboard_my_therapist_ids()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(array_agg(t.id), '{}')
    FROM public.users u
    JOIN public.therapists t ON t.name = u.full_name AND t.org_id = u.org_id AND t.is_active
   WHERE u.id = auth.uid();
$$;

-- The one "needs someone" rule (see header). JS twin: classifyNeed() in src/lib/dashboardNeeds.js. NULL = nothing needed.
CREATE OR REPLACE FUNCTION public._dashboard_need_kind(p_bk public.bookings, p_now timestamptz, p_today date)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_bk.discount_status::text = 'pending' THEN 'discount'
    WHEN p_bk.status = 'Completed' AND p_bk.payment_status <> 'paid'
         AND p_bk.final_amount - COALESCE((SELECT sum(p.amount) FROM public.payments p WHERE p.booking_id = p_bk.id), 0) > 0 THEN 'owed'
    WHEN p_bk.status IN ('Pending', 'Confirmed', 'In-Progress')
         AND ((p_bk.date + p_bk.end_time) AT TIME ZONE 'Asia/Kathmandu') <= p_now THEN 'not_closed'
    WHEN p_bk.status = 'Pending' AND p_bk.created_at < p_now - interval '2 hours' THEN 'unconfirmed'
    WHEN p_bk.date = p_today AND p_bk.status IN ('Pending', 'Confirmed')
         AND ((p_bk.date + p_bk.start_time) AT TIME ZONE 'Asia/Kathmandu') > p_now
         AND NOT EXISTS (SELECT 1 FROM public.booking_therapists bt WHERE bt.booking_id = p_bk.id) THEN 'unassigned'
  END;
$$;

-- The one "working" rule: therapists on a real shift (not "No hours set"), service staff only, on p_day in p_branches, from a shifts jsonb.
CREATE OR REPLACE FUNCTION public._dashboard_working(p_sh jsonb, p_branches uuid[], p_day date)
RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT count(*)::int
    FROM jsonb_to_recordset(p_sh) AS x(branch_id uuid, therapist_id uuid, shift_date date, works boolean, start_time time, source text)
   WHERE x.branch_id = ANY (p_branches) AND x.shift_date = p_day AND x.works AND x.start_time IS NOT NULL AND x.source IS DISTINCT FROM 'none'
     AND EXISTS (SELECT 1 FROM public.therapists st WHERE st.id = x.therapist_id AND st.is_service_staff IS NOT FALSE);
$$;

-- Booked share of therapist hours for one branch-day, from a shifts jsonb (therapist_shifts_for_range rows + branch_id). NULL without hours.
CREATE OR REPLACE FUNCTION public._dashboard_booked_share(p_branch uuid, p_day date, p_sh jsonb)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE WHEN a.avail > 0 THEN round(b.booked::numeric / a.avail, 3) END
    FROM (SELECT COALESCE(sum(GREATEST(0, (EXTRACT(EPOCH FROM x.end_time - x.start_time) / 60)::int
                 - COALESCE((SELECT sum((y->>'end_min')::int - (y->>'start_min')::int) FROM jsonb_array_elements(x.breaks) y), 0)
                 - COALESCE((SELECT sum((y->>'end_min')::int - (y->>'start_min')::int) FROM jsonb_array_elements(x.off) y), 0))), 0)::int AS avail
            FROM jsonb_to_recordset(p_sh) AS x(branch_id uuid, shift_date date, works boolean, start_time time, end_time time, breaks jsonb, off jsonb)
           WHERE x.branch_id = p_branch AND x.shift_date = p_day AND x.works AND x.start_time IS NOT NULL) a,
         (SELECT COALESCE(sum((EXTRACT(EPOCH FROM COALESCE(bt.end_time, b2.end_time) - COALESCE(bt.start_time, b2.start_time)) / 60)::int), 0)::int AS booked
            FROM public.booking_therapists bt JOIN public.bookings b2 ON b2.id = bt.booking_id
           WHERE b2.branch_id = p_branch AND b2.date = p_day AND b2.status NOT IN ('Cancelled', 'No Show')) b;
$$;

CREATE OR REPLACE FUNCTION public.get_dashboard(p_branch_ids uuid[], p_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_role    text;
  v_org     uuid;
  v_date    date := COALESCE(p_date, (now() AT TIME ZONE 'Asia/Kathmandu')::date);
  v_now_min int  := (EXTRACT(EPOCH FROM (now() AT TIME ZONE 'Asia/Kathmandu')::time) / 60)::int;
  v_now     timestamptz := now();
  v_is_today boolean := v_date = (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  v_money   boolean;
  v_ids     uuid[];
  v_mine    uuid[];
  d0 timestamptz; d1 timestamptz;
  v_pulse jsonb; v_floor jsonb := '[]'; v_week jsonb; v_branches jsonb; v_money_j jsonb;
  v_tomorrow jsonb; v_my jsonb;
  r record; rr jsonb; v_cursor int; v_busy int; v_blocks jsonb; v_gaps jsonb; v_state text; v_list jsonb := '[]'; v_sh jsonb;
  v_f int; v_e int; v_k text;
  v_prev date; v_sh_prev jsonb; v_prev_rev numeric; v_prev_share numeric;
BEGIN
  SELECT u.role::text, u.org_id INTO v_role, v_org FROM public.users u WHERE u.id = v_uid;
  IF v_role IS NULL THEN RETURN '{}'::jsonb; END IF;
  v_money := v_role IN ('manager', 'admin', 'admin_viewer');
  d0 := v_date::timestamp AT TIME ZONE 'Asia/Kathmandu';
  d1 := (v_date + 1)::timestamp AT TIME ZONE 'Asia/Kathmandu';

  SELECT COALESCE(array_agg(br.id), '{}') INTO v_ids
    FROM public.branches br
   WHERE br.org_id = v_org
     AND br.id = ANY (COALESCE(p_branch_ids, '{}'))
     AND (v_role IN ('admin', 'admin_viewer') OR br.id = ANY (public.get_user_branch_ids()));
  IF cardinality(v_ids) = 0 THEN RETURN '{}'::jsonb; END IF;

  -- pulse: today's bookings by state, and (money roles) what was collected --------------------------------------------
  SELECT jsonb_build_object(
           'bookings',    count(*) FILTER (WHERE bk.status <> 'Cancelled'),
           'pending',     count(*) FILTER (WHERE bk.status = 'Pending'),
           'confirmed',   count(*) FILTER (WHERE bk.status = 'Confirmed'),
           'in_progress', count(*) FILTER (WHERE bk.status = 'In-Progress'),
           'completed',   count(*) FILTER (WHERE bk.status = 'Completed'),
           'cancelled',   count(*) FILTER (WHERE bk.status = 'Cancelled'),
           'no_show',     count(*) FILTER (WHERE bk.status = 'No Show'),
           -- late: start time passed (Nepal time) and still Pending/Confirmed, so "to come" = pending + confirmed - late
           'late',        count(*) FILTER (WHERE v_is_today AND bk.status IN ('Pending', 'Confirmed') AND bk.start_time < (now() AT TIME ZONE 'Asia/Kathmandu')::time),
           'revenue',     CASE WHEN v_money THEN (
                            SELECT COALESCE(sum(p.amount), 0) - COALESCE((SELECT sum(rf.amount) FROM public.payment_refunds rf
                                     JOIN public.bookings rb ON rb.id = rf.booking_id
                                    WHERE rb.branch_id = ANY (v_ids) AND rf.created_at >= d0 AND rf.created_at < d1), 0)
                              FROM public.payments p JOIN public.bookings pb ON pb.id = p.booking_id
                             WHERE pb.branch_id = ANY (v_ids) AND p.created_at >= d0 AND p.created_at < d1) END)
    INTO v_pulse
    FROM public.bookings bk WHERE bk.branch_id = ANY (v_ids) AND bk.date = v_date;

  -- shifts: the availability rule once per branch for the whole 7-day window; floor, week, branches and tomorrow all read this ----
  SELECT COALESCE(jsonb_agg(to_jsonb(s) || jsonb_build_object('branch_id', bid)), '[]') INTO v_sh
    FROM unnest(v_ids) bid CROSS JOIN LATERAL public.therapist_shifts_for_range(bid, v_date, v_date + 6) s;

  -- same weekday last week, for the pulse comparisons (revenue only for money roles; booked share from the same shift rule)
  v_prev := v_date - 7;
  SELECT COALESCE(jsonb_agg(to_jsonb(s) || jsonb_build_object('branch_id', bid)), '[]') INTO v_sh_prev
    FROM unnest(v_ids) bid CROSS JOIN LATERAL public.therapist_shifts_for_range(bid, v_prev, v_prev) s;
  IF v_money THEN
    SELECT COALESCE(sum(p.amount), 0) - COALESCE((SELECT sum(rf.amount) FROM public.payment_refunds rf JOIN public.bookings rb ON rb.id = rf.booking_id
             WHERE rb.branch_id = ANY (v_ids) AND rf.created_at >= (v_prev::timestamp AT TIME ZONE 'Asia/Kathmandu') AND rf.created_at < ((v_prev + 1)::timestamp AT TIME ZONE 'Asia/Kathmandu')), 0)
      INTO v_prev_rev
      FROM public.payments p JOIN public.bookings pb ON pb.id = p.booking_id
     WHERE pb.branch_id = ANY (v_ids) AND p.created_at >= (v_prev::timestamp AT TIME ZONE 'Asia/Kathmandu') AND p.created_at < ((v_prev + 1)::timestamp AT TIME ZONE 'Asia/Kathmandu');
    IF NOT EXISTS (SELECT 1 FROM public.payments p JOIN public.bookings pb ON pb.id = p.booking_id
                    WHERE pb.branch_id = ANY (v_ids) AND p.created_at >= (v_prev::timestamp AT TIME ZONE 'Asia/Kathmandu') AND p.created_at < ((v_prev + 1)::timestamp AT TIME ZONE 'Asia/Kathmandu')) THEN
      v_prev_rev := NULL;  -- no payments that day: "no data", not a 0 baseline
    END IF;
  END IF;
  SELECT CASE WHEN a.avail > 0 THEN round(COALESCE(bk.booked, 0)::numeric / a.avail, 3) END INTO v_prev_share
    FROM (SELECT COALESCE(sum(GREATEST(0, (EXTRACT(EPOCH FROM x.end_time - x.start_time) / 60)::int
                 - COALESCE((SELECT sum((y->>'end_min')::int - (y->>'start_min')::int) FROM jsonb_array_elements(x.breaks) y), 0)
                 - COALESCE((SELECT sum((y->>'end_min')::int - (y->>'start_min')::int) FROM jsonb_array_elements(x.off) y), 0))), 0)::int AS avail
            FROM jsonb_to_recordset(v_sh_prev) AS x(works boolean, start_time time, end_time time, breaks jsonb, off jsonb)
           WHERE x.works AND x.start_time IS NOT NULL) a,
         (SELECT COALESCE(sum((EXTRACT(EPOCH FROM COALESCE(bt.end_time, b2.end_time) - COALESCE(bt.start_time, b2.start_time)) / 60)::int), 0)::int AS booked
            FROM public.booking_therapists bt JOIN public.bookings b2 ON b2.id = bt.booking_id
           WHERE b2.branch_id = ANY (v_ids) AND b2.date = v_prev AND b2.status NOT IN ('Cancelled', 'No Show')) bk;

  -- floor: per branch, the therapists working that day with their blocks and gaps >= 1h, busiest first ---------------
  FOR r IN
    WITH sh AS (
      SELECT x.branch_id, x.therapist_id, x.start_time, x.end_time, x.breaks, x.off
        FROM jsonb_to_recordset(v_sh) AS x(branch_id uuid, therapist_id uuid, shift_date date, works boolean, start_time time, end_time time, source text, breaks jsonb, off jsonb)
       WHERE x.shift_date = v_date AND x.works AND x.start_time IS NOT NULL AND x.source IS DISTINCT FROM 'none'  -- Therapists page rule: a real shift, not "No hours set"
         AND EXISTS (SELECT 1 FROM public.therapists st WHERE st.id = x.therapist_id AND st.is_service_staff IS NOT FALSE)  -- support staff are not bookable
    )
    SELECT sh.branch_id, sh.therapist_id, t.name, t.position,
           (EXTRACT(EPOCH FROM sh.start_time) / 60)::int AS s_min,
           LEAST(1440, (EXTRACT(EPOCH FROM sh.end_time) / 60)::int + CASE WHEN sh.end_time = '23:59:59' THEN 1 ELSE 0 END) AS e_min,
           (SELECT COALESCE(jsonb_agg(jsonb_build_object('k', q.k, 'f', q.f, 'e', q.e, 'id', q.bid, 'label', q.lbl) ORDER BY q.f, q.e), '[]') FROM (
              SELECT CASE bk.status WHEN 'Completed' THEN 'done' WHEN 'In-Progress' THEN 'now' WHEN 'Confirmed' THEN 'booked' ELSE 'unconfirmed' END AS k,
                     (EXTRACT(EPOCH FROM COALESCE(bt.start_time, bk.start_time)) / 60)::int AS f,
                     (EXTRACT(EPOCH FROM COALESCE(bt.end_time, bk.end_time)) / 60)::int AS e,
                     bk.id AS bid, concat_ws(' · ', bk.customer_name, bk.service_name_snapshot) AS lbl
                FROM public.booking_therapists bt JOIN public.bookings bk ON bk.id = bt.booking_id
               WHERE bt.therapist_id = sh.therapist_id AND bk.date = v_date AND bk.status NOT IN ('Cancelled', 'No Show')
              UNION ALL
              SELECT 'break', (y->>'start_min')::int, (y->>'end_min')::int, NULL::uuid, 'Break' FROM jsonb_array_elements(COALESCE(sh.breaks, '[]')) y
              UNION ALL
              SELECT 'leave', (y->>'start_min')::int, (y->>'end_min')::int, NULL::uuid, 'Off' FROM jsonb_array_elements(COALESCE(sh.off, '[]')) y
           ) q) AS ranges
      FROM sh JOIN public.therapists t ON t.id = sh.therapist_id
  LOOP
    v_blocks := '[]'; v_gaps := '[]'; v_cursor := r.s_min; v_busy := 0;
    FOR rr IN SELECT e FROM jsonb_array_elements(r.ranges) e LOOP
      v_k := rr->>'k'; v_f := (rr->>'f')::int; v_e := (rr->>'e')::int;
      IF v_f - v_cursor >= 60 THEN
        v_gaps := v_gaps || jsonb_build_object('from', public.minutes_to_hhmm(v_cursor), 'to', public.minutes_to_hhmm(v_f), 'from_min', v_cursor, 'to_min', v_f);
      END IF;
      v_blocks := v_blocks || jsonb_build_object('kind', v_k, 'from', public.minutes_to_hhmm(v_f), 'to', public.minutes_to_hhmm(v_e),
                                                 'from_min', v_f, 'to_min', v_e, 'booking_id', rr->>'id', 'label', rr->>'label');
      IF v_k NOT IN ('break', 'leave') THEN v_busy := v_busy + GREATEST(0, v_e - v_f); END IF;
      v_cursor := GREATEST(v_cursor, v_e);
    END LOOP;
    IF r.e_min - v_cursor >= 60 THEN
      v_gaps := v_gaps || jsonb_build_object('from', public.minutes_to_hhmm(v_cursor), 'to', public.minutes_to_hhmm(r.e_min), 'from_min', v_cursor, 'to_min', r.e_min);
    END IF;
    v_state := CASE WHEN v_is_today AND v_blocks @> '[{"kind":"now"}]' THEN 'now' END;
    v_list := v_list || jsonb_build_object('branch_id', r.branch_id, 'therapist_id', r.therapist_id, 'name', r.name, 'position', r.position,
                'shift_from', public.minutes_to_hhmm(r.s_min), 'shift_to', public.minutes_to_hhmm(r.e_min), 'shift_from_min', r.s_min, 'shift_to_min', r.e_min,
                'busy_minutes', v_busy, 'state', v_state,
                'checked_in',  EXISTS (SELECT 1 FROM public.therapist_attendance ta WHERE ta.therapist_id = r.therapist_id AND ta.date = v_date AND ta.check_in_time IS NOT NULL AND ta.check_out_time IS NULL),
                'checked_out', EXISTS (SELECT 1 FROM public.therapist_attendance ta WHERE ta.therapist_id = r.therapist_id AND ta.date = v_date AND ta.check_out_time IS NOT NULL), 'blocks', v_blocks, 'gaps', v_gaps);
  END LOOP;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'branch_id', bid,
           'headcount', public._dashboard_working(v_sh, ARRAY[bid], v_date),  -- same population as 'working'
           'working', (SELECT count(*) FROM jsonb_array_elements(v_list) e WHERE e->>'branch_id' = bid::text),
           'therapists', (SELECT COALESCE(jsonb_agg(e ORDER BY (e->>'busy_minutes')::int DESC, e->>'name'), '[]')
                            FROM jsonb_array_elements(v_list) e WHERE e->>'branch_id' = bid::text))), '[]')
    INTO v_floor FROM unnest(v_ids) bid;

  -- week: booked share of therapist hours, 7 days from p_date ---------------------------------------------------------
  WITH sh AS (
    SELECT x.shift_date, x.start_time, x.end_time, x.breaks, x.off
      FROM jsonb_to_recordset(v_sh) AS x(shift_date date, works boolean, start_time time, end_time time, breaks jsonb, off jsonb)
     WHERE x.works AND x.start_time IS NOT NULL
  ), avail AS (
    SELECT sh.shift_date AS day,
           sum(GREATEST(0, (EXTRACT(EPOCH FROM sh.end_time - sh.start_time) / 60)::int
               - COALESCE((SELECT sum((y->>'end_min')::int - (y->>'start_min')::int) FROM jsonb_array_elements(sh.breaks) y), 0)
               - COALESCE((SELECT sum((y->>'end_min')::int - (y->>'start_min')::int) FROM jsonb_array_elements(sh.off) y), 0)))::int AS avail
      FROM sh GROUP BY sh.shift_date
  ), booked AS (
    SELECT bk.date AS day, sum((EXTRACT(EPOCH FROM COALESCE(bt.end_time, bk.end_time) - COALESCE(bt.start_time, bk.start_time)) / 60)::int)::int AS booked
      FROM public.booking_therapists bt JOIN public.bookings bk ON bk.id = bt.booking_id
     WHERE bk.branch_id = ANY (v_ids) AND bk.date BETWEEN v_date AND v_date + 6 AND bk.status NOT IN ('Cancelled', 'No Show')
     GROUP BY bk.date
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('date', a.day, 'available_minutes', a.avail, 'booked_minutes', COALESCE(bd.booked, 0),
           'booked_share', CASE WHEN a.avail > 0 THEN round(COALESCE(bd.booked, 0)::numeric / a.avail, 3) END) ORDER BY a.day), '[]')
    INTO v_week FROM avail a LEFT JOIN booked bd ON bd.day = a.day;

  -- branches: one row per branch (scene D) ----------------------------------------------------------------------------
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'branch_id', br.id, 'name', br.name,
           'bookings',  (SELECT count(*) FROM public.bookings bk WHERE bk.branch_id = br.id AND bk.date = v_date AND bk.status <> 'Cancelled'),
           'completed', (SELECT count(*) FROM public.bookings bk WHERE bk.branch_id = br.id AND bk.date = v_date AND bk.status = 'Completed'),
           'revenue',   CASE WHEN v_money THEN (SELECT COALESCE(sum(p.amount), 0) FROM public.payments p JOIN public.bookings pb ON pb.id = p.booking_id
                                                 WHERE pb.branch_id = br.id AND p.created_at >= d0 AND p.created_at < d1) END,
           'working',   public._dashboard_working(v_sh, ARRAY[br.id], v_date),
           -- scene D columns: manager, "x of y busy" (working = y), vs last same weekday, booked hours, unpaid
           'manager',   (SELECT u.full_name FROM public.users u
                          WHERE u.role = 'manager' AND (u.branch_id = br.id OR EXISTS (SELECT 1 FROM public.user_branches ub WHERE ub.user_id = u.id AND ub.branch_id = br.id))
                          ORDER BY u.full_name LIMIT 1),
           'busy_now',  (SELECT count(*) FROM jsonb_array_elements(v_list) e WHERE e->>'branch_id' = br.id::text AND e->>'state' = 'now'),
           'revenue_prev', CASE WHEN v_money AND EXISTS (SELECT 1 FROM public.payments p JOIN public.bookings pb ON pb.id = p.booking_id
                                   WHERE pb.branch_id = br.id AND p.created_at >= (v_prev::timestamp AT TIME ZONE 'Asia/Kathmandu') AND p.created_at < ((v_prev + 1)::timestamp AT TIME ZONE 'Asia/Kathmandu'))
                           THEN (SELECT COALESCE(sum(p.amount), 0) FROM public.payments p JOIN public.bookings pb ON pb.id = p.booking_id
                                  WHERE pb.branch_id = br.id AND p.created_at >= (v_prev::timestamp AT TIME ZONE 'Asia/Kathmandu') AND p.created_at < ((v_prev + 1)::timestamp AT TIME ZONE 'Asia/Kathmandu')) END,
           'booked_share',      public._dashboard_booked_share(br.id, v_date, v_sh),
           'booked_share_prev', public._dashboard_booked_share(br.id, v_prev, v_sh_prev),
           'unpaid',    CASE WHEN v_money THEN (SELECT COALESCE(sum(GREATEST(bk.final_amount - COALESCE((SELECT sum(p.amount) FROM public.payments p WHERE p.booking_id = bk.id), 0), 0)), 0)
                                  FROM public.bookings bk WHERE bk.branch_id = br.id AND bk.status = 'Completed' AND bk.payment_status <> 'paid' AND bk.date <= v_date) END,
           -- needs someone: per-kind counts of the one rule (_dashboard_need_kind)
           'needs',     (SELECT jsonb_build_object('discount', count(*) FILTER (WHERE q.k = 'discount'), 'owed', count(*) FILTER (WHERE q.k = 'owed'),
                                'not_closed', count(*) FILTER (WHERE q.k = 'not_closed'), 'unconfirmed', count(*) FILTER (WHERE q.k = 'unconfirmed'),
                                'unassigned', count(*) FILTER (WHERE q.k = 'unassigned'), 'total', count(*),
                                'oldest_not_closed', min(q.d) FILTER (WHERE q.k = 'not_closed'))
                           FROM (SELECT bk.date AS d, public._dashboard_need_kind(bk, v_now, v_date) AS k FROM public.bookings bk
                                  WHERE bk.branch_id = br.id AND bk.date <= v_date
                                    AND (bk.status IN ('Pending', 'Confirmed', 'In-Progress') OR bk.discount_status::text = 'pending'
                                         OR (bk.status = 'Completed' AND bk.payment_status <> 'paid'))) q
                          WHERE q.k IS NOT NULL)
         ) ORDER BY br.name), '[]')
    INTO v_branches FROM public.branches br WHERE br.id = ANY (v_ids);

  -- money: by method, cash expected, tips (not revenue) ---------------------------------------------------------------
  IF v_money THEN
    SELECT jsonb_build_object(
             'by_method', COALESCE((SELECT jsonb_object_agg(m.payment_mode, m.total) FROM (
                 SELECT p.payment_mode, sum(p.amount) AS total FROM public.payments p JOIN public.bookings pb ON pb.id = p.booking_id
                  WHERE pb.branch_id = ANY (v_ids) AND p.created_at >= d0 AND p.created_at < d1 GROUP BY p.payment_mode) m), '{}'),
             'cash_expected', COALESCE((SELECT sum(p.amount) FROM public.payments p JOIN public.bookings pb ON pb.id = p.booking_id
                  WHERE pb.branch_id = ANY (v_ids) AND p.payment_mode = 'Cash' AND p.created_at >= d0 AND p.created_at < d1), 0)
                  - COALESCE((SELECT sum(rf.amount) FROM public.payment_refunds rf JOIN public.bookings rb ON rb.id = rf.booking_id
                  WHERE rb.branch_id = ANY (v_ids) AND rf.created_at >= d0 AND rf.created_at < d1), 0),
             'tips', COALESCE((SELECT sum(tp.amount) FROM public.booking_tips tp JOIN public.bookings tb ON tb.id = tp.booking_id
                  WHERE tb.branch_id = ANY (v_ids) AND tp.created_at >= d0 AND tp.created_at < d1), 0))
      INTO v_money_j;
  END IF;

  -- tomorrow ----------------------------------------------------------------------------------------------------------
  SELECT jsonb_build_object(
           'bookings',    count(*) FILTER (WHERE bk.status <> 'Cancelled'),
           'unconfirmed', count(*) FILTER (WHERE bk.status = 'Pending'),
           'working', public._dashboard_working(v_sh, v_ids, v_date + 1))
    INTO v_tomorrow FROM public.bookings bk WHERE bk.branch_id = ANY (v_ids) AND bk.date = v_date + 1;

  -- my_day: the caller's own bookings today (see header re ZNLY-150) ---------------------------------------------------
  v_mine := public._dashboard_my_therapist_ids();
  SELECT jsonb_build_object(
           'therapist_ids', to_jsonb(v_mine),
           'bookings', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', bk.id, 'number', bk.booking_number, 'branch_id', bk.branch_id,
                'start', to_char(COALESCE(bt.start_time, bk.start_time), 'HH24:MI'), 'end', to_char(COALESCE(bt.end_time, bk.end_time), 'HH24:MI'),
                'customer', bk.customer_name, 'service', bk.service_name_snapshot, 'status', bk.status, 'room', bk.room_name_snapshot,
                'visit', CASE WHEN bk.customer_id IS NULL THEN NULL ELSE (SELECT count(*) FROM public.bookings pv
                           WHERE pv.customer_id = bk.customer_id AND pv.status NOT IN ('Cancelled', 'No Show') AND (pv.date, pv.start_time) <= (bk.date, bk.start_time)) END)
                ORDER BY COALESCE(bt.start_time, bk.start_time))
              FROM public.booking_therapists bt JOIN public.bookings bk ON bk.id = bt.booking_id
             WHERE bt.therapist_id = ANY (v_mine) AND bk.date = v_date AND bk.branch_id = ANY (v_ids) AND bk.status <> 'Cancelled'), '[]'),
           'tips', (SELECT COALESCE(sum(tp.amount), 0) FROM public.booking_tips tp
                      JOIN public.bookings tb ON tb.id = tp.booking_id
                     WHERE tp.received_by = v_uid AND tb.branch_id = ANY (v_ids) AND tp.created_at >= d0 AND tp.created_at < d1),
           'tips_month', (SELECT COALESCE(sum(tp.amount), 0) FROM public.booking_tips tp
                      JOIN public.bookings tb ON tb.id = tp.booking_id
                     WHERE tp.received_by = v_uid AND tb.branch_id = ANY (v_ids) AND tp.created_at >= (date_trunc('month', v_date)::timestamp AT TIME ZONE 'Asia/Kathmandu') AND tp.created_at < d1),
           'commission', NULL,
           'commission_inputs_month', jsonb_build_object(
              'service_revenue', (SELECT COALESCE(sum(bk.final_amount), 0) FROM public.bookings bk
                                   WHERE bk.therapist_id = ANY (v_mine) AND bk.date BETWEEN date_trunc('month', v_date)::date AND v_date AND bk.status = 'Completed' AND bk.payment_status = 'paid'),
              'referral_rows', COALESCE((SELECT jsonb_agg(jsonb_build_object('final_amount', bk.final_amount, 'type', bk.referral_commission_type,
                                              'value', bk.referral_commission_value))
                                   FROM public.bookings bk JOIN public.therapists mt ON mt.id = ANY (v_mine)
                                  WHERE bk.date BETWEEN date_trunc('month', v_date)::date AND v_date AND bk.status = 'Completed' AND bk.payment_status = 'paid'
                                    AND bk.branch_id = ANY (v_ids) AND lower(btrim(bk.referred_by)) = lower(btrim(mt.name))), '[]')),
           'commission_inputs', jsonb_build_object(
              'service_revenue', (SELECT COALESCE(sum(bk.final_amount), 0) FROM public.bookings bk
                                   WHERE bk.therapist_id = ANY (v_mine) AND bk.date = v_date AND bk.status = 'Completed' AND bk.payment_status = 'paid'),
              'referral_rows', COALESCE((SELECT jsonb_agg(jsonb_build_object('final_amount', bk.final_amount, 'type', bk.referral_commission_type,
                                              'value', bk.referral_commission_value))
                                   FROM public.bookings bk JOIN public.therapists mt ON mt.id = ANY (v_mine)
                                  WHERE bk.date = v_date AND bk.status = 'Completed' AND bk.payment_status = 'paid'
                                    AND bk.branch_id = ANY (v_ids) AND lower(btrim(bk.referred_by)) = lower(btrim(mt.name))), '[]'),
              'commission_rate', (SELECT sc.commission_rate FROM public.staff_compensation sc WHERE sc.therapist_id = ANY (v_mine) LIMIT 1)))
    INTO v_my;

  RETURN jsonb_build_object('date', v_date, 'role', v_role, 'branch_ids', to_jsonb(v_ids),
           'pulse', v_pulse || jsonb_build_object('revenue_prev', v_prev_rev, 'booked_share_prev', v_prev_share), 'floor', v_floor, 'week', v_week, 'branches', v_branches,
           'money', v_money_j, 'tomorrow', v_tomorrow, 'my_day', v_my);
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_dashboard(uuid[], date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard(uuid[], date) TO authenticated;
REVOKE ALL ON FUNCTION public._dashboard_my_therapist_ids() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._dashboard_need_kind(public.bookings, timestamptz, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._dashboard_working(jsonb, uuid[], date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._dashboard_booked_share(uuid, date, jsonb) FROM PUBLIC, anon, authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('334', 'dashboard-rpc')
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
