-- Migration 362: attendance for visiting therapists (ZNLY-113 / V33c).
-- Attendance stays ONE row per person per day, owned by HOME (branch_id = therapists.branch_id). When the receiving branch's
-- manager checks a visitor in/out, the row records worked_at_branch_id so home can show "Worked at <branch> 12:02 - 3:30 pm".
-- The receiving manager can NOT write home-owned rows through RLS; they go through the two SECURITY DEFINER RPCs below, which
-- allow only today's check-in / check-out, only while an open temporary window points at the caller's branch.
-- Idempotent. Applied: stage - / prod -.

BEGIN;

ALTER TABLE public.therapist_attendance
  ADD COLUMN IF NOT EXISTS worked_at_branch_id uuid REFERENCES public.branches(id);

-- Caller may act for p_branch_id: a manager/admin of that branch (admin: any branch of their org).
CREATE OR REPLACE FUNCTION public._can_manage_branch(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT get_user_role() IN ('manager', 'admin')
     AND ( p_branch_id = ANY (get_user_branch_ids())
           OR (get_user_role() = 'admin'
               AND EXISTS (SELECT 1 FROM public.branches br WHERE br.id = p_branch_id AND br.org_id = get_user_org_id())) );
$$;
REVOKE ALL ON FUNCTION public._can_manage_branch(uuid) FROM PUBLIC, anon, authenticated;

-- Start of the temporary window INTO p_branch_id that overlaps today (Nepal date), or NULL. Upcoming and just-ended windows count.
CREATE OR REPLACE FUNCTION public._visitor_window_today(p_therapist_id uuid, p_branch_id uuid)
RETURNS TABLE(ws timestamptz, we timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT w.ws, w.we
    FROM public._staff_transfer_windows(ARRAY[p_therapist_id]) w
   WHERE NOT w.is_return_leg AND NOT w.is_permanent AND w.to_branch_id = p_branch_id
     AND w.ws < (((now() AT TIME ZONE 'Asia/Kathmandu')::date + 1)::timestamp AT TIME ZONE 'Asia/Kathmandu')
     AND w.we > (((now() AT TIME ZONE 'Asia/Kathmandu')::date)::timestamp AT TIME ZONE 'Asia/Kathmandu')
   ORDER BY w.ws LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public._visitor_window_today(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Today's visitors at p_branch_id (window overlaps today) with whatever check-in/out has been recorded for them today.
DROP FUNCTION IF EXISTS public.visiting_attendance_today(uuid);
CREATE OR REPLACE FUNCTION public.visiting_attendance_today(p_branch_id uuid)
RETURNS TABLE(therapist_id uuid, therapist_name text, check_in_time timestamptz, check_out_time timestamptz, worked_at_branch_id uuid,
              window_from timestamptz, window_to timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
BEGIN
  IF NOT public._can_manage_branch(p_branch_id) THEN
    RAISE EXCEPTION 'visiting_attendance_today: not allowed for this branch';
  END IF;
  RETURN QUERY
    SELECT t.id, t.name::text, ta.check_in_time, ta.check_out_time, ta.worked_at_branch_id, vw.ws, vw.we
      FROM public.therapists t
      CROSS JOIN LATERAL public._visitor_window_today(t.id, p_branch_id) vw
      LEFT JOIN public.therapist_attendance ta ON ta.therapist_id = t.id AND ta.date = v_today
     WHERE t.is_active
       AND t.branch_id <> p_branch_id;
END;
$$;
REVOKE ALL ON FUNCTION public.visiting_attendance_today(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.visiting_attendance_today(uuid) TO authenticated;

-- Today's check-in / check-out for a visitor. NULL leaves a time unchanged. Creates the home-owned row (Present) if none yet.
CREATE OR REPLACE FUNCTION public.mark_visitor_attendance(
  p_therapist_id uuid, p_branch_id uuid, p_check_in timestamptz DEFAULT NULL, p_check_out timestamptz DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  v_home  uuid;
  v_id    uuid;
BEGIN
  IF NOT public._can_manage_branch(p_branch_id) THEN
    RAISE EXCEPTION 'mark_visitor_attendance: not allowed for this branch';
  END IF;
  SELECT t.branch_id INTO v_home FROM public.therapists t WHERE t.id = p_therapist_id AND t.is_active;
  IF v_home IS NULL OR v_home = p_branch_id
     OR NOT EXISTS (SELECT 1 FROM public._visitor_window_today(p_therapist_id, p_branch_id)) THEN
    RAISE EXCEPTION 'mark_visitor_attendance: this person has no visit to this branch today';
  END IF;

  INSERT INTO public.therapist_attendance AS ta
         (branch_id, therapist_id, date, status, check_in_time, check_out_time, marked_by, worked_at_branch_id)
  VALUES (v_home, p_therapist_id, v_today, 'Present', p_check_in, p_check_out, auth.uid(), p_branch_id)
  ON CONFLICT (therapist_id, date) DO UPDATE
     SET check_in_time       = COALESCE(EXCLUDED.check_in_time, ta.check_in_time),
         check_out_time      = COALESCE(EXCLUDED.check_out_time, ta.check_out_time),
         worked_at_branch_id = EXCLUDED.worked_at_branch_id,
         marked_by           = EXCLUDED.marked_by
  RETURNING ta.id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_visitor_attendance(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_visitor_attendance(uuid, uuid, timestamptz, timestamptz) TO authenticated;

-- ---- Payroll (ZNLY-118 / ZNLY-125): the branch that was a therapist's HOME on the booking's date pays the commission (a product
-- sale: on the sale's date). One rule for temp windows (home never changes in a window) and permanent moves mid-month. RLS hides
-- other branches' rows from the home manager, so the readers below are SECURITY DEFINER and gated on managing p_branch_id.
-- Revenue reports are untouched (bookings.branch_id).

-- Home branch of a therapist at an instant: the destination of the latest PERMANENT move at/before p_at; if none yet, where the first
-- later permanent move left from; if there is no permanent move at all, the current branch. Temporary windows never change home.
CREATE OR REPLACE FUNCTION public.therapist_home_on(p_therapist_id uuid, p_at timestamptz)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(
    (SELECT w.to_branch_id FROM public._staff_transfer_windows(ARRAY[p_therapist_id]) w
      WHERE NOT w.is_return_leg AND w.is_permanent AND w.ws <= p_at ORDER BY w.ws DESC LIMIT 1),
    (SELECT w.from_branch_id FROM public._staff_transfer_windows(ARRAY[p_therapist_id]) w
      WHERE NOT w.is_return_leg AND w.is_permanent AND w.ws > p_at ORDER BY w.ws ASC LIMIT 1),
    (SELECT t.branch_id FROM public.therapists t WHERE t.id = p_therapist_id));
$$;
REVOKE ALL ON FUNCTION public.therapist_home_on(uuid, timestamptz) FROM PUBLIC, anon, authenticated;

-- Completed+paid bookings in [p_from, p_to] that p_branch_id pays for (home on the booking's date = p_branch_id), wherever done.
-- Replaces the earlier payroll_lent_bookings (which keyed on the current home).
DROP FUNCTION IF EXISTS public.payroll_lent_bookings(uuid, date, date);
CREATE OR REPLACE FUNCTION public.payroll_home_bookings(p_branch_id uuid, p_from date, p_to date)
RETURNS TABLE(therapist_id uuid, final_amount numeric, referred_by text, referral_commission_type text,
              referral_commission_value numeric, branch_id uuid, branch_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public._can_manage_branch(p_branch_id) THEN
    RAISE EXCEPTION 'payroll_home_bookings: not allowed for this branch';
  END IF;
  RETURN QUERY
    SELECT b.therapist_id, b.final_amount, b.referred_by, b.referral_commission_type::text, b.referral_commission_value,
           b.branch_id, br.name::text
      FROM public.bookings b
      JOIN public.branches br ON br.id = b.branch_id
     WHERE b.status = 'Completed' AND b.payment_status = 'paid'
       AND b.date >= p_from AND b.date <= p_to
       AND b.therapist_id IS NOT NULL AND br.org_id = (SELECT x.org_id FROM public.branches x WHERE x.id = p_branch_id)
       AND public.therapist_home_on(b.therapist_id, ((b.date::timestamp) AT TIME ZONE 'Asia/Kathmandu')) = p_branch_id;
END;
$$;
REVOKE ALL ON FUNCTION public.payroll_home_bookings(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payroll_home_bookings(uuid, date, date) TO authenticated;

-- Product sales p_branch_id pays for (home on the sale's date = p_branch_id), wherever made: created in [p_from, p_to) or refunded
-- in [p_refund_from, p_to).
DROP FUNCTION IF EXISTS public.payroll_lent_product_sales(uuid, timestamptz, timestamptz, timestamptz);
CREATE OR REPLACE FUNCTION public.payroll_home_product_sales(p_branch_id uuid, p_from timestamptz, p_to timestamptz, p_refund_from timestamptz)
RETURNS TABLE(sold_by_therapist_id uuid, total_amount numeric, created_at timestamptz, refunded_at timestamptz,
              earns_commission boolean, branch_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public._can_manage_branch(p_branch_id) THEN
    RAISE EXCEPTION 'payroll_home_product_sales: not allowed for this branch';
  END IF;
  RETURN QUERY
    SELECT ps.sold_by_therapist_id, ps.total_amount, ps.created_at, ps.refunded_at, p.earns_commission, ps.branch_id
      FROM public.product_sales ps
      JOIN public.branches br ON br.id = ps.branch_id
      LEFT JOIN public.products p ON p.id = ps.product_id
     WHERE ps.sold_by_therapist_id IS NOT NULL AND br.org_id = (SELECT x.org_id FROM public.branches x WHERE x.id = p_branch_id)
       AND ((ps.created_at >= p_from AND ps.created_at < p_to)
            OR (ps.refunded_at IS NOT NULL AND ps.refunded_at >= p_refund_from AND ps.refunded_at < p_to))
       AND public.therapist_home_on(ps.sold_by_therapist_id, ps.created_at) = p_branch_id;
END;
$$;
REVOKE ALL ON FUNCTION public.payroll_home_product_sales(uuid, timestamptz, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payroll_home_product_sales(uuid, timestamptz, timestamptz, timestamptz) TO authenticated;

-- People p_branch_id pays for in the month who are no longer based there (moved away permanently): they have home-on-date bookings
-- or sales here but are not at p_branch_id now. Commission-only lines; RLS would hide their rows from this manager.
CREATE OR REPLACE FUNCTION public.payroll_departed_staff(p_branch_id uuid, p_from date, p_to date)
RETURNS TABLE(id uuid, name text, commission_rate numeric, product_commission_rate numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public._can_manage_branch(p_branch_id) THEN
    RAISE EXCEPTION 'payroll_departed_staff: not allowed for this branch';
  END IF;
  RETURN QUERY
    SELECT t.id, t.name::text, sc.commission_rate, sc.product_commission_rate
      FROM public.therapists t
      LEFT JOIN public.staff_compensation sc ON sc.therapist_id = t.id
     WHERE t.is_active AND t.branch_id <> p_branch_id AND t.org_id = (SELECT x.org_id FROM public.branches x WHERE x.id = p_branch_id)
       AND ( EXISTS (SELECT 1 FROM public.bookings b
                      WHERE b.therapist_id = t.id AND b.status = 'Completed' AND b.payment_status = 'paid'
                        AND b.date >= p_from AND b.date <= p_to
                        AND public.therapist_home_on(t.id, ((b.date::timestamp) AT TIME ZONE 'Asia/Kathmandu')) = p_branch_id)
          OR EXISTS (SELECT 1 FROM public.product_sales ps
                      WHERE ps.sold_by_therapist_id = t.id
                        AND ps.created_at >= (p_from::timestamp AT TIME ZONE 'Asia/Kathmandu')
                        AND ps.created_at <  ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Kathmandu')
                        AND public.therapist_home_on(t.id, ps.created_at) = p_branch_id) );
END;
$$;
REVOKE ALL ON FUNCTION public.payroll_departed_staff(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payroll_departed_staff(uuid, date, date) TO authenticated;

-- What visitors earned at p_branch_id in the month (the receiving branch's help line: paid by their home branch on that date).
CREATE OR REPLACE FUNCTION public.payroll_visitor_revenue(p_branch_id uuid, p_from date, p_to date)
RETURNS TABLE(visitors integer, revenue numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public._can_manage_branch(p_branch_id) THEN
    RAISE EXCEPTION 'payroll_visitor_revenue: not allowed for this branch';
  END IF;
  RETURN QUERY
    SELECT COUNT(DISTINCT b.therapist_id)::integer, COALESCE(SUM(b.final_amount), 0)::numeric
      FROM public.bookings b
     WHERE b.branch_id = p_branch_id AND b.status = 'Completed' AND b.payment_status = 'paid'
       AND b.date >= p_from AND b.date <= p_to
       AND b.therapist_id IS NOT NULL
       AND public.therapist_home_on(b.therapist_id, ((b.date::timestamp) AT TIME ZONE 'Asia/Kathmandu')) <> p_branch_id;
END;
$$;
REVOKE ALL ON FUNCTION public.payroll_visitor_revenue(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payroll_visitor_revenue(uuid, date, date) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('362', 'visitor-attendance')
ON CONFLICT (version) DO NOTHING;

COMMIT;
