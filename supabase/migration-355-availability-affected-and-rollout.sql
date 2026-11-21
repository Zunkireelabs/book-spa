-- Migration 355: read helpers for the availability rule (ZNLY-100, V29a)
--  * availability_affected_bookings(therapist, change jsonb): upcoming (Nepal today onward) open bookings of the
--    therapist (own or companion) that would fall outside a PROPOSED change. SECURITY INVOKER, so RLS limits the rows
--    to what the caller can already see. change.type is one of
--      hours   {day_of_week 0=Mon, is_day_off, start, end, breaks:[{start,end}]}   (dates with a roster change are skipped)
--      roster  {date, is_day_off, start, end, breaks:[{start,end}]}
--      block   {date, start, duration_minutes}
--      leave   {from, to, off_start?, off_end?}   (no off_* = full days)
--      transfer{from_ts, to_ts?, to_branch_id}
--    Times are 'HH:MM'. Returns booking_id, booking_number, booking_date, start_time, end_time, customer_name, service, reason.
--  * availability_rollout_check(org): admin/manager of the org only. Counts upcoming bookings that would fall outside
--    the rule today, by code, and lists therapists with no weekly hours / only some weekdays set (missing weekday = branch hours only), by name,
--    plus how many bookings are outside branch hours for therapists with nothing set.
-- Reversible (manual): DROP FUNCTION both.
BEGIN;

CREATE OR REPLACE FUNCTION public.availability_affected_bookings(p_therapist_id uuid, p_change jsonb)
RETURNS TABLE(booking_id uuid, booking_number text, booking_date date, start_time time without time zone,
              end_time time without time zone, customer_name text, service text, reason text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$
DECLARE
  v_type  text := p_change->>'type';
  v_today date := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  v_s     int;
  v_e     int;
BEGIN
  IF v_type NOT IN ('hours', 'roster', 'block', 'leave', 'transfer') THEN
    RAISE EXCEPTION 'availability_affected_bookings: unknown change type %', v_type;
  END IF;

  RETURN QUERY
  WITH cand AS (
    SELECT b.id, b.booking_number, b.date, b.start_time, b.end_time, b.customer_name, b.service_name_snapshot,
           b.branch_id, b.start_datetime, b.end_datetime,
           (EXTRACT(EPOCH FROM b.start_time) / 60)::int AS s, (EXTRACT(EPOCH FROM b.end_time) / 60)::int AS e
      FROM public.bookings b
     WHERE b.date >= v_today AND b.date <= v_today + 1830
       AND b.status NOT IN ('Cancelled', 'No Show', 'Completed')
       AND (b.therapist_id = p_therapist_id
            OR EXISTS (SELECT 1 FROM public.booking_therapists bt WHERE bt.booking_id = b.id AND bt.therapist_id = p_therapist_id))
  )
  SELECT c.id, c.booking_number, c.date, c.start_time, c.end_time, c.customer_name, c.service_name_snapshot,
         CASE v_type
           WHEN 'block' THEN 'block' WHEN 'leave' THEN 'leave' WHEN 'transfer' THEN 'other_branch'
           ELSE CASE WHEN COALESCE((p_change->>'is_day_off')::boolean, false) THEN 'day_off'
                     WHEN c.s < (EXTRACT(EPOCH FROM (p_change->>'start')::time) / 60)::int THEN 'before_shift'
                     WHEN c.e > (EXTRACT(EPOCH FROM (p_change->>'end')::time) / 60)::int THEN 'after_shift'
                     ELSE 'break' END
         END
    FROM cand c
   WHERE CASE v_type
     WHEN 'hours' THEN
       EXTRACT(ISODOW FROM c.date)::int - 1 = (p_change->>'day_of_week')::int
       AND NOT EXISTS (SELECT 1 FROM public.staff_roster_overrides ro WHERE ro.therapist_id = p_therapist_id AND ro.override_date = c.date)
       AND (COALESCE((p_change->>'is_day_off')::boolean, false)
            OR c.s < (EXTRACT(EPOCH FROM (p_change->>'start')::time) / 60)::int
            OR c.e > (EXTRACT(EPOCH FROM (p_change->>'end')::time) / 60)::int
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_change->'breaks', '[]'::jsonb)) x
                        WHERE (EXTRACT(EPOCH FROM (x->>'start')::time) / 60)::int < c.e
                          AND (EXTRACT(EPOCH FROM (x->>'end')::time) / 60)::int > c.s))
     WHEN 'roster' THEN
       c.date = (p_change->>'date')::date
       AND (COALESCE((p_change->>'is_day_off')::boolean, false)
            OR c.s < (EXTRACT(EPOCH FROM (p_change->>'start')::time) / 60)::int
            OR c.e > (EXTRACT(EPOCH FROM (p_change->>'end')::time) / 60)::int
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_change->'breaks', '[]'::jsonb)) x
                        WHERE (EXTRACT(EPOCH FROM (x->>'start')::time) / 60)::int < c.e
                          AND (EXTRACT(EPOCH FROM (x->>'end')::time) / 60)::int > c.s))
     WHEN 'block' THEN
       c.date = (p_change->>'date')::date
       AND (EXTRACT(EPOCH FROM (p_change->>'start')::time) / 60)::int < c.e
       AND (EXTRACT(EPOCH FROM (p_change->>'start')::time) / 60)::int + (p_change->>'duration_minutes')::int > c.s
     WHEN 'leave' THEN
       c.date BETWEEN (p_change->>'from')::date AND COALESCE((p_change->>'to')::date, (p_change->>'from')::date)
       AND (p_change->>'off_start' IS NULL
            OR ((EXTRACT(EPOCH FROM (p_change->>'off_start')::time) / 60)::int < c.e
                AND (EXTRACT(EPOCH FROM (p_change->>'off_end')::time) / 60)::int > c.s))
     ELSE
       c.branch_id <> (p_change->>'to_branch_id')::uuid
       AND c.end_datetime > (p_change->>'from_ts')::timestamptz
       AND (p_change->>'to_ts' IS NULL OR c.start_datetime < (p_change->>'to_ts')::timestamptz)
     END
   ORDER BY c.date, c.start_time;
END;
$$;
GRANT EXECUTE ON FUNCTION public.availability_affected_bookings(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.availability_rollout_check(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_today   date := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  v_counts  jsonb;
  v_checked int;
  v_branch_only int;
BEGIN
  IF p_org_id IS DISTINCT FROM (SELECT get_user_org_id())
     OR (SELECT get_user_role()) NOT IN ('admin', 'manager') THEN
    RAISE EXCEPTION 'availability_rollout_check: admin or manager of this organization only' USING ERRCODE = '42501';
  END IF;

  WITH bk AS (
    SELECT b.id, b.therapist_id, b.date, b.branch_id, b.start_datetime, b.end_datetime
      FROM public.bookings b JOIN public.branches br ON br.id = b.branch_id
     WHERE br.org_id = p_org_id AND b.therapist_id IS NOT NULL AND b.date >= v_today
       AND b.status NOT IN ('Cancelled', 'No Show', 'Completed')
  ), v AS (
    SELECT bk.id, public.therapist_shift_for(bk.therapist_id, bk.date, bk.branch_id)->>'source' AS src, (SELECT u.code
                     FROM public.therapist_unavailable_ranges(bk.therapist_id, bk.date, bk.branch_id, bk.id) u
                    WHERE u.code <> 'OVERLAP'
                      AND u.start_min < LEAST(1440, CEIL(EXTRACT(EPOCH FROM (bk.end_datetime - (bk.date::timestamp AT TIME ZONE 'Asia/Kathmandu'))) / 60)::int)
                      AND u.end_min > GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (bk.start_datetime - (bk.date::timestamp AT TIME ZONE 'Asia/Kathmandu'))) / 60)::int)
                    ORDER BY CASE u.code WHEN 'ON_LEAVE' THEN 1 WHEN 'OTHER_BRANCH' THEN 2 WHEN 'BLOCKED' THEN 3 WHEN 'ON_BREAK' THEN 4 ELSE 5 END
                    LIMIT 1) AS code
      FROM bk
  )
  SELECT (SELECT count(*) FROM bk), (SELECT count(*) FROM v WHERE v.src = 'none' AND v.code = 'OFF_SHIFT'),
         COALESCE(jsonb_object_agg(code, n) FILTER (WHERE code IS NOT NULL), '{}'::jsonb)
    INTO v_checked, v_branch_only, v_counts
    FROM (SELECT code, count(*) AS n FROM v GROUP BY code) s;


  RETURN jsonb_build_object(
    'upcoming_checked', v_checked,
    'outside_by_code', v_counts,
    'outside_branch_hours_no_shift_set', v_branch_only,  -- newly affected: therapists with no hours are bookable only inside branch hours
    'total_outside', COALESCE((SELECT sum(value::int) FROM jsonb_each_text(v_counts)), 0),
    'therapists_without_hours', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) ORDER BY t.name)
        FROM public.therapists t JOIN public.branches br ON br.id = t.branch_id
       WHERE br.org_id = p_org_id AND t.is_active AND t.is_service_staff
         AND NOT EXISTS (SELECT 1 FROM public.therapist_working_hours wh WHERE wh.therapist_id = t.id)), '[]'::jsonb),
    'therapists_with_partial_hours', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'days_set', x.n, 'days_missing', (SELECT jsonb_agg(d ORDER BY d) FROM generate_series(0, 6) d WHERE NOT EXISTS (SELECT 1 FROM public.therapist_working_hours wh2 WHERE wh2.therapist_id = t.id AND wh2.day_of_week = d))) ORDER BY t.name)
        FROM public.therapists t JOIN public.branches br ON br.id = t.branch_id
        JOIN LATERAL (SELECT count(*) AS n FROM public.therapist_working_hours wh WHERE wh.therapist_id = t.id) x ON x.n BETWEEN 1 AND 6
       WHERE br.org_id = p_org_id AND t.is_active AND t.is_service_staff), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.availability_rollout_check(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.availability_rollout_check(uuid) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('355', 'availability-affected-and-rollout')
ON CONFLICT (version) DO NOTHING;

COMMIT;
