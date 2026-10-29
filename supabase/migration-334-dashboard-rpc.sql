-- Migration 334: get_dashboard(p_branch_ids, p_date), one call for the whole dashboard (ZNLY-147, V36b)
--
-- Returns one jsonb: pulse, floor, needs_action, week, branches, money, loose_ends, tomorrow, my_day.
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
  v_is_today boolean := v_date = (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  v_money   boolean;
  v_ids     uuid[];
  v_mine    uuid[];
  d0 timestamptz; d1 timestamptz;
  v_pulse jsonb; v_floor jsonb := '[]'; v_needs jsonb; v_week jsonb; v_branches jsonb; v_money_j jsonb;
  v_loose jsonb; v_tomorrow jsonb; v_my jsonb;
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
           'headcount', (SELECT count(*) FROM jsonb_to_recordset(v_sh) AS x(branch_id uuid, therapist_id uuid, shift_date date, works boolean, start_time time, source text) WHERE x.branch_id = bid AND x.shift_date = v_date AND x.works AND x.start_time IS NOT NULL AND x.source IS DISTINCT FROM 'none'
                         AND EXISTS (SELECT 1 FROM public.therapists st WHERE st.id = x.therapist_id AND st.is_service_staff IS NOT FALSE)),  -- same population as 'working'
           'working', (SELECT count(*) FROM jsonb_array_elements(v_list) e WHERE e->>'branch_id' = bid::text),
           'therapists', (SELECT COALESCE(jsonb_agg(e ORDER BY (e->>'busy_minutes')::int DESC, e->>'name'), '[]')
                            FROM jsonb_array_elements(v_list) e WHERE e->>'branch_id' = bid::text))), '[]')
    INTO v_floor FROM unnest(v_ids) bid;

  -- needs_action ----------------------------------------------------------------------------------------------------
  SELECT jsonb_build_object(
           'pending_discounts', count(*) FILTER (WHERE bk.discount_status::text = 'pending'),
           'unconfirmed_today', count(*) FILTER (WHERE bk.date = v_date AND bk.status = 'Pending'),
           'unpaid_completed',  count(*) FILTER (WHERE bk.status = 'Completed' AND bk.payment_status <> 'paid' AND bk.date <= v_date),
           'tips_to_distribute', CASE WHEN v_money THEN (
                SELECT count(*) FROM public.booking_tips tp JOIN public.bookings tb ON tb.id = tp.booking_id
                 WHERE tb.branch_id = ANY (v_ids) AND tp.distributed_at IS NULL) END)
    INTO v_needs
    FROM public.bookings bk
   WHERE bk.branch_id = ANY (v_ids) AND bk.date BETWEEN v_date - 30 AND v_date AND bk.status <> 'Cancelled';

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
           'working',   (SELECT count(*) FROM jsonb_to_recordset(v_sh) AS x(branch_id uuid, therapist_id uuid, shift_date date, works boolean, start_time time, source text) WHERE x.branch_id = br.id AND x.shift_date = v_date AND x.works AND x.start_time IS NOT NULL AND x.source IS DISTINCT FROM 'none'
                         AND EXISTS (SELECT 1 FROM public.therapists st WHERE st.id = x.therapist_id AND st.is_service_staff IS NOT FALSE))
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

  -- loose ends: earlier days (last 7) that never reached a terminal state, plus completed-but-unpaid ----------------------
  SELECT jsonb_build_object(
           'open_past_bookings', count(*) FILTER (WHERE bk.status IN ('Pending', 'Confirmed', 'In-Progress')),
           'unpaid_past',        count(*) FILTER (WHERE bk.status = 'Completed' AND bk.payment_status <> 'paid'))
    INTO v_loose
    FROM public.bookings bk WHERE bk.branch_id = ANY (v_ids) AND bk.date >= v_date - 7 AND bk.date < v_date;

  -- tomorrow ----------------------------------------------------------------------------------------------------------
  SELECT jsonb_build_object(
           'bookings',    count(*) FILTER (WHERE bk.status <> 'Cancelled'),
           'unconfirmed', count(*) FILTER (WHERE bk.status = 'Pending'),
           'working', (SELECT count(*) FROM jsonb_to_recordset(v_sh) AS x(shift_date date, works boolean, start_time time) WHERE x.shift_date = v_date + 1 AND x.works AND x.start_time IS NOT NULL))
    INTO v_tomorrow FROM public.bookings bk WHERE bk.branch_id = ANY (v_ids) AND bk.date = v_date + 1;

  -- my_day: the caller's own bookings today (see header re ZNLY-150) ---------------------------------------------------
  v_mine := public._dashboard_my_therapist_ids();
  SELECT jsonb_build_object(
           'therapist_ids', to_jsonb(v_mine),
           'bookings', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', bk.id, 'number', bk.booking_number, 'branch_id', bk.branch_id,
                'start', to_char(COALESCE(bt.start_time, bk.start_time), 'HH24:MI'), 'end', to_char(COALESCE(bt.end_time, bk.end_time), 'HH24:MI'),
                'customer', bk.customer_name, 'service', bk.service_name_snapshot, 'status', bk.status)
                ORDER BY COALESCE(bt.start_time, bk.start_time))
              FROM public.booking_therapists bt JOIN public.bookings bk ON bk.id = bt.booking_id
             WHERE bt.therapist_id = ANY (v_mine) AND bk.date = v_date AND bk.branch_id = ANY (v_ids) AND bk.status <> 'Cancelled'), '[]'),
           'tips', (SELECT COALESCE(sum(tp.amount), 0) FROM public.booking_tips tp
                      JOIN public.bookings tb ON tb.id = tp.booking_id
                     WHERE tp.received_by = v_uid AND tb.branch_id = ANY (v_ids) AND tp.created_at >= d0 AND tp.created_at < d1),
           'commission', NULL,
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
           'pulse', v_pulse || jsonb_build_object('revenue_prev', v_prev_rev, 'booked_share_prev', v_prev_share), 'floor', v_floor, 'needs_action', v_needs, 'week', v_week, 'branches', v_branches,
           'money', v_money_j, 'loose_ends', v_loose, 'tomorrow', v_tomorrow, 'my_day', v_my);
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_dashboard(uuid[], date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard(uuid[], date) TO authenticated;
REVOKE ALL ON FUNCTION public._dashboard_my_therapist_ids() FROM PUBLIC, anon, authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('334', 'dashboard-rpc')
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
