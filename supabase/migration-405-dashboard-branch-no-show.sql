-- Migration 405 (ZNLY-276): the dashboard's per-branch rows carry no_show.
--
-- The Business view row ("Bookings 51 / 54") has to count a no-show as finished (src/lib/dayProgress.js: finished = Completed + No Show,
-- total = all except Cancelled), but get_dashboard's branches[] only returned 'completed'. This recreates _get_dashboard_unmasked with ONE
-- added key, 'no_show', next to 'completed' in the branches rows. Everything else is the function exactly as it is today.
-- Reversible: re-run the previous definition (migration-396 / latest) of _get_dashboard_unmasked.

BEGIN;

CREATE OR REPLACE FUNCTION public._get_dashboard_unmasked(p_branch_ids uuid[], p_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
           'revenue',     CASE WHEN v_money THEN public._dashboard_net(v_ids, v_date) END)
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
    v_prev_rev := CASE WHEN EXISTS (SELECT 1 FROM public._dashboard_money_in(v_ids, v_prev)) THEN public._dashboard_net(v_ids, v_prev) END;  -- no money in that day: "no data", not a 0 baseline
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
           'no_show',   (SELECT count(*) FROM public.bookings bk WHERE bk.branch_id = br.id AND bk.date = v_date AND bk.status = 'No Show'),
           'revenue',   CASE WHEN v_money THEN public._dashboard_net(ARRAY[br.id], v_date) END,
           'working',   public._dashboard_working(v_sh, ARRAY[br.id], v_date),
           -- scene D columns: manager, "x of y busy" (working = y), vs last same weekday, booked hours, unpaid
           'manager',   (SELECT u.full_name FROM public.users u
                          WHERE u.role = 'manager' AND (u.branch_id = br.id OR EXISTS (SELECT 1 FROM public.user_branches ub WHERE ub.user_id = u.id AND ub.branch_id = br.id))
                          ORDER BY u.full_name LIMIT 1),
           'busy_now',  (SELECT count(*) FROM jsonb_array_elements(v_list) e WHERE e->>'branch_id' = br.id::text AND e->>'state' = 'now'),
           'revenue_prev', CASE WHEN v_money AND EXISTS (SELECT 1 FROM public._dashboard_money_in(ARRAY[br.id], v_prev)) THEN public._dashboard_net(ARRAY[br.id], v_prev) END,
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
                 SELECT mi.payment_mode, sum(mi.amount) AS total FROM public._dashboard_money_in(v_ids, v_date) mi GROUP BY mi.payment_mode) m), '{}'),
             'refunds', public._dashboard_refunds(v_ids, v_date),
             'taken', public._dashboard_net(v_ids, v_date),
             -- money taken AFTER each branch's day was closed (not in the closed daily_reports row): ZNLY-234
             'after_close', (SELECT jsonb_build_object('amount', ac.amount, 'cash', ac.cash) FROM public._dashboard_after_close(v_ids, v_date) ac),
             'cash_expected', COALESCE((SELECT sum(mi.amount) FROM public._dashboard_money_in(v_ids, v_date) mi WHERE mi.payment_mode = 'Cash'), 0)
                  - public._dashboard_refunds(v_ids, v_date),
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
$function$;

INSERT INTO public.schema_migrations (version, name)
VALUES ('405', 'dashboard-branch-no-show')
ON CONFLICT (version) DO NOTHING;

COMMIT;
