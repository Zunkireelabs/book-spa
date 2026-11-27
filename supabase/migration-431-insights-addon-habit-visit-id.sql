-- Migration 431 (ZNLY-402, piece 5): Insights addon_habit follows the booking, not only the old group id
--
-- Why: addon_habit finds "the add-on this customer took in the same booking" by joining bookings on booking_group_id. Since migration 427/428 a
-- multi-service booking of an org with the setting ON carries visit_id and (desk flow, piece 5) NO booking_group_id, so those visits would silently
-- stop counting. The three joins now use COALESCE(visit_id, booking_group_id): a visit_id booking matches by visit_id, an older group booking (and every
-- OFF-org group) still matches by booking_group_id, exactly as before.
--
-- Base: the live definition of get_dashboard_insights (byte-identical on prod and local = migration 370; checked by the lead 24 Nov 2026). The ONLY
-- changes are those three expressions in the addon_habit block. Signature, STABLE SECURITY DEFINER, search_path and grants are unchanged
-- (CREATE OR REPLACE keeps the grants; they are repeated below so the migration is self-contained).
-- Idempotent. Reversible: re-run get_dashboard_insights from migration 370.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_dashboard_insights(p_branch_ids uuid[], p_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_role text;
  v_org  uuid;
  v_date date := COALESCE(p_date, (now() AT TIME ZONE 'Asia/Kathmandu')::date);
  v_now  timestamptz := now();
  v_ids  uuid[];
  v_mgr  boolean;
  v_adm  boolean;
  v_items jsonb := '[]';
  v_sh jsonb := '[]'; v_sh_ready boolean := false;
  v_my uuid[];
  r record; r2 record;
  v_share numeric; v_days jsonb;
BEGIN
  SELECT u.role::text, u.org_id INTO v_role, v_org FROM public.users u WHERE u.id = v_uid;
  IF v_role IS NULL THEN RETURN '{}'::jsonb; END IF;
  v_mgr := v_role IN ('manager', 'admin', 'admin_viewer');
  v_adm := v_role = 'admin';
  v_my := public._dashboard_my_therapist_ids();

  SELECT COALESCE(array_agg(br.id), '{}') INTO v_ids
    FROM public.branches br
   WHERE br.org_id = v_org AND br.id = ANY (COALESCE(p_branch_ids, '{}'))
     AND (v_role IN ('admin', 'admin_viewer') OR br.id = ANY (public.get_user_branch_ids()));
  IF cardinality(v_ids) = 0 THEN RETURN '{}'::jsonb; END IF;

  -- rebook_due (+ gap fill) -------------------------------------------------------------------------------------------
  IF v_mgr THEN
    FOR r IN
      WITH v AS (
        SELECT b.customer_id, b.date, b.branch_id FROM public.bookings b
         WHERE b.status = 'Completed' AND b.customer_id IS NOT NULL AND b.branch_id = ANY (v_ids) AND b.date <= v_date),
      per AS (SELECT customer_id, count(DISTINCT date) AS n, min(date) AS first_d, max(date) AS last_d FROM v GROUP BY customer_id),
      lastb AS (SELECT DISTINCT ON (customer_id) customer_id, branch_id FROM v ORDER BY customer_id, date DESC),
      due AS (SELECT p.customer_id, p.n, p.last_d, l.branch_id, (p.last_d - p.first_d)::numeric / (p.n - 1) AS gap
                FROM per p JOIN lastb l USING (customer_id) WHERE p.n >= 3 AND p.last_d > p.first_d)
      SELECT d.branch_id, br.name AS branch_name, count(*)::int AS cnt,
             array_agg(c.id) AS ids,
             jsonb_path_query_array(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.full_name, 'visits', d.n, 'usual_gap_days', round(d.gap)::int,
                                                                'days_since', v_date - d.last_d) ORDER BY (v_date - d.last_d) - d.gap DESC), '$[0 to 4]') AS sample
        FROM due d
        JOIN public.customers c ON c.id = d.customer_id AND c.org_id = v_org AND c.is_active AND (c.email IS NOT NULL OR c.phone IS NOT NULL)
        JOIN public.branches br ON br.id = d.branch_id
       WHERE d.gap >= 7 AND v_date - d.last_d >= d.gap AND v_date - d.last_d <= d.gap * 2
         AND NOT EXISTS (SELECT 1 FROM public.bookings o WHERE o.customer_id = d.customer_id AND o.date >= v_date
                            AND o.status IN ('Pending', 'Confirmed', 'In-Progress'))
       GROUP BY d.branch_id, br.name
    LOOP
      IF NOT v_sh_ready THEN
        SELECT COALESCE(jsonb_agg(to_jsonb(s) || jsonb_build_object('branch_id', bid)), '[]') INTO v_sh
          FROM unnest(v_ids) bid CROSS JOIN LATERAL public.therapist_shifts_for_range(bid, v_date, v_date + 7) s;
        v_sh_ready := true;
      END IF;
      v_share := public._dashboard_booked_share(r.branch_id, v_date, v_sh);
      v_items := v_items || jsonb_build_object(
        'rule', 'rebook_due', 'version', 1, 'subject', 'branch:' || r.branch_id, 'branch_id', r.branch_id,
        'score', 50 + LEAST(r.cnt, 10) * 3 + CASE WHEN v_share IS NOT NULL AND v_share < 0.6 THEN 10 ELSE 0 END,
        'facts', jsonb_build_object('count', r.cnt, 'branch_name', r.branch_name, 'customers', r.sample,
                                    'today_booked_share', v_share, 'gap_fill', v_share IS NOT NULL AND v_share < 0.6),
        'action', jsonb_build_object('kind', 'draft', 'draft_rule', 'rebook_due', 'customer_ids', to_jsonb(r.ids[1:50])));
    END LOOP;
  END IF;

  -- no_show_risk -----------------------------------------------------------------------------------------------------
  FOR r IN  -- followup: a no-show today for someone who has come >= 3 times before
    SELECT b.id, b.branch_id, b.customer_id, c.full_name, b.start_time,
           (SELECT count(DISTINCT p.date) FROM public.bookings p WHERE p.customer_id = b.customer_id AND p.status = 'Completed' AND p.date < v_date)::int AS visits,
           (SELECT count(*) FROM public.bookings p WHERE p.customer_id = b.customer_id AND p.status = 'No Show')::int AS misses
      FROM public.bookings b JOIN public.customers c ON c.id = b.customer_id AND c.org_id = v_org
     WHERE b.branch_id = ANY (v_ids) AND b.date = v_date AND b.status = 'No Show' AND b.customer_id IS NOT NULL
       AND (v_role <> 'staff' OR EXISTS (SELECT 1 FROM public.booking_therapists bt WHERE bt.booking_id = b.id AND bt.therapist_id = ANY (v_my)))
  LOOP
    CONTINUE WHEN r.visits < 3;
    v_items := v_items || jsonb_build_object(
      'rule', 'no_show_risk', 'version', 1, 'subject', 'followup:' || r.id, 'branch_id', r.branch_id, 'score', 70,
      'facts', jsonb_build_object('kind', 'followup', 'customer', jsonb_build_object('id', r.customer_id, 'name', r.full_name),
                                  'visits', r.visits, 'no_shows', r.misses, 'booking_id', r.id),
      'action', jsonb_build_object('kind', 'draft', 'draft_rule', 'no_show_followup', 'customer_ids', jsonb_build_array(r.customer_id), 'booking_id', r.id));
  END LOOP;
  FOR r IN  -- risk: an upcoming booking for a repeat no-shower
    SELECT b.id, b.branch_id, b.customer_id, c.full_name, b.date, b.start_time, h.total, h.misses
      FROM public.bookings b
      JOIN public.customers c ON c.id = b.customer_id AND c.org_id = v_org
      CROSS JOIN LATERAL (SELECT count(*)::int AS total, count(*) FILTER (WHERE p.status = 'No Show')::int AS misses
                            FROM public.bookings p WHERE p.customer_id = b.customer_id AND p.status IN ('Completed', 'No Show') AND p.date < v_date) h
     WHERE b.branch_id = ANY (v_ids) AND b.date BETWEEN v_date AND v_date + 1 AND b.status IN ('Pending', 'Confirmed')
       AND (v_role <> 'staff' OR EXISTS (SELECT 1 FROM public.booking_therapists bt WHERE bt.booking_id = b.id AND bt.therapist_id = ANY (v_my)))
       AND b.customer_id IS NOT NULL AND h.total >= 3 AND h.misses >= 2 AND h.misses::numeric / h.total >= 0.3
       AND ((b.date + b.start_time) AT TIME ZONE 'Asia/Kathmandu') > v_now
  LOOP
    v_items := v_items || jsonb_build_object(
      'rule', 'no_show_risk', 'version', 1, 'subject', 'risk:' || r.id, 'branch_id', r.branch_id, 'score', 65,
      'facts', jsonb_build_object('kind', 'risk', 'customer', jsonb_build_object('id', r.customer_id, 'name', r.full_name),
                                  'bookings_before', r.total, 'no_shows', r.misses, 'booking_id', r.id,
                                  'date', r.date, 'start_time', r.start_time),
      'action', jsonb_build_object('kind', 'booking', 'booking_id', r.id));
  END LOOP;

  -- membership_expiring ----------------------------------------------------------------------------------------------
  IF v_mgr THEN
    FOR r IN
      SELECT c.branch_id, br.name AS branch_name, count(*)::int AS cnt, sum(m.balance) AS unused,
             array_agg(c.id) AS ids, min(m.expiry_date) AS first_expiry,
             jsonb_path_query_array(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.full_name, 'expires', m.expiry_date, 'balance', m.balance)
                                              ORDER BY m.expiry_date), '$[0 to 4]') AS sample
        FROM public.memberships m
        JOIN public.customers c ON c.id = m.customer_id AND c.org_id = v_org AND c.branch_id = ANY (v_ids) AND (c.email IS NOT NULL OR c.phone IS NOT NULL)
        JOIN public.branches br ON br.id = c.branch_id
       WHERE m.org_id = v_org AND m.balance > 0 AND m.expiry_date BETWEEN v_date AND v_date + 7
       GROUP BY c.branch_id, br.name
    LOOP
      v_items := v_items || jsonb_build_object(
        'rule', 'membership_expiring', 'version', 1, 'subject', 'branch:' || r.branch_id, 'branch_id', r.branch_id,
        'score', 60 + LEAST(r.cnt, 10),
        'facts', jsonb_build_object('count', r.cnt, 'branch_name', r.branch_name, 'unused', r.unused, 'first_expiry', r.first_expiry, 'customers', r.sample),
        'action', jsonb_build_object('kind', 'draft', 'draft_rule', 'membership_expiring', 'customer_ids', to_jsonb(r.ids[1:50])));
    END LOOP;
  END IF;

  -- quiet_days -------------------------------------------------------------------------------------------------------
  IF v_mgr THEN
    FOR r IN
      SELECT br.id, br.name FROM public.branches br
       WHERE br.id = ANY (v_ids)
         AND (SELECT count(*) >= 20 AND min(b.date) <= v_date - 28 FROM public.bookings b
               WHERE b.branch_id = br.id AND b.status = 'Completed' AND b.date <= v_date)
    LOOP
      IF NOT v_sh_ready THEN
        SELECT COALESCE(jsonb_agg(to_jsonb(s) || jsonb_build_object('branch_id', bid)), '[]') INTO v_sh
          FROM unnest(v_ids) bid CROSS JOIN LATERAL public.therapist_shifts_for_range(bid, v_date, v_date + 7) s;
        v_sh_ready := true;
      END IF;
      SELECT COALESCE(jsonb_agg(jsonb_build_object('date', d, 'booked_share', s) ORDER BY d), '[]') INTO v_days
        FROM (SELECT (v_date + n) AS d, public._dashboard_booked_share(r.id, v_date + n, v_sh) AS s FROM generate_series(1, 7) n) x
       WHERE x.s IS NOT NULL AND x.s < 0.45;
      CONTINUE WHEN jsonb_array_length(v_days) = 0;
      v_items := v_items || jsonb_build_object(
        'rule', 'quiet_days', 'version', 1, 'subject', 'branch:' || r.id, 'branch_id', r.id,
        'score', 40 + 3 * jsonb_array_length(v_days),
        'facts', jsonb_build_object('branch_name', r.name, 'days', v_days, 'threshold', 0.45),
        'action', jsonb_build_object('kind', 'calendar', 'date', v_days->0->>'date'));
    END LOOP;
  END IF;

  -- discount_anomaly (admin) -----------------------------------------------------------------------------------------
  IF v_adm THEN
    FOR r IN
      WITH s AS (
        SELECT b.created_by AS uid, count(*)::int AS n, count(*) FILTER (WHERE b.discount_amount > 0)::int AS disc,
               COALESCE(sum(b.discount_amount) FILTER (WHERE b.discount_amount > 0), 0) AS amt
          FROM public.bookings b
         WHERE b.branch_id = ANY (v_ids) AND b.status = 'Completed' AND b.created_by IS NOT NULL AND b.date BETWEEN v_date - 27 AND v_date
         GROUP BY b.created_by),
      t AS (SELECT sum(n) AS n, sum(disc) AS disc FROM s)
      SELECT s.uid, u.full_name, s.n, s.disc, s.amt,
             (SELECT b2.branch_id FROM public.bookings b2 WHERE b2.created_by = s.uid AND b2.branch_id = ANY (v_ids) AND b2.status = 'Completed'
                 AND b2.discount_amount > 0 AND b2.date BETWEEN v_date - 27 AND v_date GROUP BY b2.branch_id ORDER BY count(*) DESC LIMIT 1) AS top_branch,
             round(100.0 * s.disc / s.n)::int AS rate_pct,
             round(100.0 * (t.disc - s.disc) / NULLIF(t.n - s.n, 0))::int AS others_pct, (t.disc - s.disc)::int AS others_disc, (t.n - s.n)::int AS others_n
        FROM s JOIN public.users u ON u.id = s.uid AND u.org_id = v_org CROSS JOIN t
       WHERE s.n >= 10 AND s.disc::numeric / s.n >= 0.4 AND t.n - s.n >= 20
         AND s.disc::numeric / s.n >= 2 * (t.disc - s.disc)::numeric / NULLIF(t.n - s.n, 0)
    LOOP
      v_items := v_items || jsonb_build_object(
        'rule', 'discount_anomaly', 'version', 1, 'subject', 'user:' || r.uid, 'branch_id', r.top_branch, 'score', 55,
        'facts', jsonb_build_object('user_name', r.full_name, 'bookings', r.n, 'discounted', r.disc, 'rate_pct', r.rate_pct,
                                    'others_rate_pct', r.others_pct, 'others_discounted', r.others_disc, 'others_bookings', r.others_n, 'discount_total', r.amt, 'window_days', 28),
        'action', jsonb_build_object('kind', 'discounts'));
    END LOOP;
  END IF;

  -- lend_therapist (admin) -------------------------------------------------------------------------------------------
  IF v_adm AND cardinality(v_ids) >= 2 THEN
    IF NOT v_sh_ready THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(s) || jsonb_build_object('branch_id', bid)), '[]') INTO v_sh
        FROM unnest(v_ids) bid CROSS JOIN LATERAL public.therapist_shifts_for_range(bid, v_date, v_date + 7) s;
      v_sh_ready := true;
    END IF;
    FOR r IN
      SELECT busy.id AS busy_id, busy.name AS busy_name, busy.s AS busy_share, idle.id AS idle_id, idle.name AS idle_name, idle.s AS idle_share,
             public._dashboard_working(v_sh, ARRAY[idle.id], v_date + 1) AS idle_working
        FROM (SELECT br.id, br.name, public._dashboard_booked_share(br.id, v_date + 1, v_sh) AS s FROM public.branches br WHERE br.id = ANY (v_ids)) busy
        CROSS JOIN LATERAL (SELECT br.id, br.name, public._dashboard_booked_share(br.id, v_date + 1, v_sh) AS s
                              FROM public.branches br WHERE br.id = ANY (v_ids) AND br.id <> busy.id
                               AND public._dashboard_working(v_sh, ARRAY[br.id], v_date + 1) >= 2  -- only a branch that can spare someone
                             ORDER BY 3 NULLS LAST LIMIT 1) idle
       WHERE busy.s >= 0.85 AND idle.s IS NOT NULL AND idle.s <= 0.4
    LOOP
      v_items := v_items || jsonb_build_object(
        'rule', 'lend_therapist', 'version', 1, 'subject', 'lend:' || r.busy_id || ':' || r.idle_id || ':' || (v_date + 1), 'branch_id', r.busy_id, 'score', 62,
        'facts', jsonb_build_object('date', v_date + 1, 'busy_branch', r.busy_name, 'busy_share', r.busy_share,
                                    'idle_branch', r.idle_name, 'idle_share', r.idle_share, 'idle_working', r.idle_working),
        'action', jsonb_build_object('kind', 'transfer', 'from_branch_id', r.idle_id, 'to_branch_id', r.busy_id, 'date', v_date + 1));
    END LOOP;
  END IF;

  -- addon_habit (My day) ---------------------------------------------------------------------------------------------
  IF cardinality(v_my) > 0 THEN
    FOR r IN
      SELECT tb.id AS booking_id, tb.branch_id, tb.customer_id, c.full_name, tb.start_time, h.visits, a.addon_id, s.name AS addon_name, a.times
        FROM public.bookings tb
        JOIN public.customers c ON c.id = tb.customer_id AND c.org_id = v_org
        CROSS JOIN LATERAL (SELECT count(DISTINCT p.date)::int AS visits FROM public.bookings p
                             WHERE p.customer_id = tb.customer_id AND p.status = 'Completed' AND p.date < v_date) h
        CROSS JOIN LATERAL (SELECT ad.service_id AS addon_id, count(DISTINCT p.date)::int AS times
                              FROM public.bookings p
                              JOIN public.bookings ad ON COALESCE(ad.visit_id, ad.booking_group_id) = COALESCE(p.visit_id, p.booking_group_id) AND ad.id <> p.id AND ad.status = 'Completed'
                              JOIN public.service_addons sa ON sa.service_id = p.service_id AND sa.addon_service_id = ad.service_id
                             WHERE p.customer_id = tb.customer_id AND p.status = 'Completed' AND p.date < v_date AND COALESCE(p.visit_id, p.booking_group_id) IS NOT NULL
                             GROUP BY ad.service_id ORDER BY 2 DESC LIMIT 1) a
        JOIN public.services s ON s.id = a.addon_id
       WHERE tb.branch_id = ANY (v_ids) AND tb.date = v_date AND tb.status IN ('Pending', 'Confirmed') AND tb.customer_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM public.booking_therapists bt WHERE bt.booking_id = tb.id AND bt.therapist_id = ANY (v_my))
         AND h.visits >= 3 AND a.times >= 3 AND a.times::numeric / h.visits >= 0.6
         AND EXISTS (SELECT 1 FROM public.service_addons sa WHERE sa.service_id = tb.service_id AND sa.addon_service_id = a.addon_id)
         AND NOT EXISTS (SELECT 1 FROM public.bookings g WHERE COALESCE(tb.visit_id, tb.booking_group_id) IS NOT NULL AND COALESCE(g.visit_id, g.booking_group_id) = COALESCE(tb.visit_id, tb.booking_group_id)
                            AND g.id <> tb.id AND g.service_id = a.addon_id)
    LOOP
      v_items := v_items || jsonb_build_object(
        'rule', 'addon_habit', 'version', 1, 'subject', 'booking:' || r.booking_id, 'branch_id', r.branch_id, 'score', 45,
        'facts', jsonb_build_object('customer', jsonb_build_object('id', r.customer_id, 'name', r.full_name), 'visits', r.visits,
                                    'times', r.times, 'addon_name', r.addon_name, 'booking_id', r.booking_id, 'start_time', r.start_time),
        'action', jsonb_build_object('kind', 'booking', 'booking_id', r.booking_id));
    END LOOP;
  END IF;

  -- drop what this user snoozed or dismissed; stamp as_of; rank -------------------------------------------------------
  RETURN jsonb_build_object('as_of', v_now, 'items', COALESCE((
    SELECT jsonb_agg(i || jsonb_build_object('as_of', v_now) ORDER BY (i->>'score')::numeric DESC, i->>'rule', i->>'subject')
      FROM jsonb_array_elements(v_items) i
     WHERE NOT EXISTS (
       SELECT 1 FROM public.insight_feedback f
        WHERE f.user_id = v_uid AND f.rule = i->>'rule' AND f.subject_key = i->>'subject'
          AND (f.action = 'dismiss' OR (f.action = 'snooze' AND COALESCE(f.snooze_until, f.created_at + interval '3 days') > v_now)))), '[]'));
END;
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_insights(uuid[], date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_insights(uuid[], date) TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('431', 'insights-addon-habit-visit-id')
ON CONFLICT (version) DO NOTHING;

COMMIT;
