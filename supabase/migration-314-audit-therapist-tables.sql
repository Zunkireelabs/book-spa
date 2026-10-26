-- Migration 314: audit trail for staff (therapist) profile, pay, weekly hours, breaks and date overrides (V28 / ZNLY-97).
--
-- Idempotent: CREATE OR REPLACE for functions, DROP TRIGGER IF EXISTS + CREATE TRIGGER, DROP POLICY IF EXISTS + CREATE POLICY,
-- CREATE INDEX IF NOT EXISTS. Portable: no hardcoded UUIDs. Local DB first; promote per supabase/PROMOTION.md.
-- No back-fill: history is recorded from the day this migration is applied (the app shows that date).
--
-- What it adds
--   1. public.log_therapist_table_changes(): one SECURITY DEFINER trigger function in the style of log_customer_changes
--      (migration-297): UPDATE writes ONE audit_logs row holding only the changed fields (old/new), a no-op UPDATE writes
--      nothing, INSERT writes the new row, DELETE writes the old row. updated_at / updated_by are never "changes".
--      therapists.display_order (calendar drag-reorder) is ignored as noise.
--      Each row also carries the staff member it is about as `therapist_id` inside old_data/new_data (audit_logs has no
--      subject column), plus context keys so a single row is readable on its own: `day_of_week` (DB 0=Mon) on hours/break rows,
--      `break_name` on break rows, `override_date` on date-change rows.
--      Attached to: therapists, staff_compensation, staff_roster_overrides, therapist_working_hours,
--      therapist_working_hours_breaks.
--      A break row whose parent working-hours row is already gone (cascade from deleting the day) is NOT audited; the
--      parent's own DELETE row is.
--   2. Pay privacy (Payroll's rule): audit rows of table 'staff_compensation' (salary, commission) are readable by admin and
--      read-only admin_viewer only. Managers and staff never see them: the two manager SELECT policies on audit_logs are
--      recreated with a pay-rows-only-for-admin predicate (staff have no SELECT policy at all), and get_therapist_activity()
--      repeats the check by role.
--   3. public.get_therapist_activity(p_therapist_id, p_filter, p_limit): one query for the profile History feed (profile,
--      pay, hours, transfers; transfers come from staff_transfers, which is a real table, not audit rows).
--   4. Expression index on the therapist reference for the feed.
--   5. public.therapist_history_since(): the date this migration was recorded, so the UI can say "History is recorded from ...".
--
-- Reversible:
--   DROP TRIGGER IF EXISTS trg_audit_therapists ON public.therapists;  (and trg_audit_staff_compensation on staff_compensation,
--   trg_audit_staff_roster_overrides, trg_audit_therapist_working_hours, trg_audit_therapist_working_hours_breaks)
--   DROP FUNCTION IF EXISTS public.log_therapist_table_changes(); DROP FUNCTION IF EXISTS public.get_therapist_activity(uuid, text, integer);
--   DROP FUNCTION IF EXISTS public.therapist_history_since();
--   DROP INDEX IF EXISTS public.idx_audit_logs_therapist_ref;
--   Re-create the two "Manager can read ... audit logs" policies without the pay predicate (git history of this file's section 2).
--   DELETE FROM public.schema_migrations WHERE version = '314';

BEGIN;

-- ------------------------------------------------------------------ 1. trigger function
CREATE OR REPLACE FUNCTION public.log_therapist_table_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  old_j     jsonb;
  new_j     jsonb;
  old_diff  jsonb := '{}'::jsonb;
  new_diff  jsonb := '{}'::jsonb;
  k         text;
  v_row     record;
  v_ther    uuid;
  v_branch  uuid;
  v_dow     smallint;
  v_ctx     jsonb;
  v_rid     uuid;
  v_bname   text;
BEGIN
  -- Resolve which staff member / branch this row is about.
  v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  IF TG_TABLE_NAME = 'therapists' THEN
    v_ther := v_row.id;
    v_branch := v_row.branch_id;
  ELSIF TG_TABLE_NAME = 'therapist_working_hours_breaks' THEN
    v_bname := v_row.name;
    SELECT wh.therapist_id, wh.branch_id, wh.day_of_week INTO v_ther, v_branch, v_dow
      FROM public.therapist_working_hours wh WHERE wh.id = v_row.working_hours_id;
    IF v_ther IS NULL THEN
      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; -- parent day already deleted (cascade)
    END IF;
  ELSE
    v_ther := v_row.therapist_id;
    IF TG_TABLE_NAME = 'staff_compensation' THEN
      SELECT t.branch_id INTO v_branch FROM public.therapists t WHERE t.id = v_ther;
    ELSE
      v_branch := v_row.branch_id;
    END IF;
    IF TG_TABLE_NAME = 'therapist_working_hours' THEN v_dow := v_row.day_of_week; END IF;
  END IF;

  -- record_id: the row's own id (staff_compensation has no id column: its key is the therapist)
  v_rid := CASE WHEN TG_TABLE_NAME = 'staff_compensation' THEN v_ther ELSE (to_jsonb(v_row)->>'id')::uuid END;
  v_ctx := jsonb_build_object('therapist_id', v_ther);
  IF v_dow IS NOT NULL THEN v_ctx := v_ctx || jsonb_build_object('day_of_week', v_dow); END IF;
  -- so a lone UPDATE row can still say which break / which date it was about
  IF v_bname IS NOT NULL THEN v_ctx := v_ctx || jsonb_build_object('break_name', v_bname); END IF;
  IF TG_TABLE_NAME = 'staff_roster_overrides' THEN v_ctx := v_ctx || jsonb_build_object('override_date', v_row.override_date); END IF;

  IF TG_OP = 'UPDATE' THEN
    old_j := to_jsonb(OLD);
    new_j := to_jsonb(NEW);
    FOR k IN SELECT jsonb_object_keys(new_j) LOOP
      CONTINUE WHEN k IN ('updated_at', 'updated_by');
      CONTINUE WHEN TG_TABLE_NAME = 'therapists' AND k = 'display_order';
      IF old_j->k IS DISTINCT FROM new_j->k THEN
        old_diff := old_diff || jsonb_build_object(k, old_j->k);
        new_diff := new_diff || jsonb_build_object(k, new_j->k);
      END IF;
    END LOOP;

    -- A no-op UPDATE (re-saving unchanged fields) writes nothing.
    IF old_diff = '{}'::jsonb THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.audit_logs (branch_id, table_name, record_id, action_type, old_data, new_data, changed_by)
    VALUES (v_branch, TG_TABLE_NAME, v_rid,
            'UPDATE', old_diff || v_ctx, new_diff || v_ctx, auth.uid());
    RETURN NEW;

  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs (branch_id, table_name, record_id, action_type, old_data, new_data, changed_by)
    VALUES (v_branch, TG_TABLE_NAME, v_rid,
            'INSERT', NULL, to_jsonb(NEW) || v_ctx, auth.uid());
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    -- Deleting a whole day cascades to its breaks. This runs BEFORE the delete for that table (see the trigger below), so the
    -- day's own row can carry the breaks that go with it: one audit event, nothing silently lost.
    IF TG_TABLE_NAME = 'therapist_working_hours' THEN
      v_ctx := v_ctx || jsonb_build_object('breaks', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('name', b.name, 'start_time', b.start_time, 'end_time', b.end_time) ORDER BY b.sort_order, b.start_time)
          FROM public.therapist_working_hours_breaks b WHERE b.working_hours_id = OLD.id), '[]'::jsonb));
    END IF;
    INSERT INTO public.audit_logs (branch_id, table_name, record_id, action_type, old_data, new_data, changed_by)
    VALUES (v_branch, TG_TABLE_NAME, v_rid,
            'DELETE', to_jsonb(OLD) || v_ctx, NULL, auth.uid());
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.log_therapist_table_changes() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_audit_therapists ON public.therapists;
CREATE TRIGGER trg_audit_therapists
  AFTER INSERT OR UPDATE OR DELETE ON public.therapists
  FOR EACH ROW EXECUTE FUNCTION public.log_therapist_table_changes();

DROP TRIGGER IF EXISTS trg_audit_staff_compensation ON public.staff_compensation;
CREATE TRIGGER trg_audit_staff_compensation
  AFTER INSERT OR UPDATE OR DELETE ON public.staff_compensation
  FOR EACH ROW EXECUTE FUNCTION public.log_therapist_table_changes();

DROP TRIGGER IF EXISTS trg_audit_staff_roster_overrides ON public.staff_roster_overrides;
CREATE TRIGGER trg_audit_staff_roster_overrides
  AFTER INSERT OR UPDATE OR DELETE ON public.staff_roster_overrides
  FOR EACH ROW EXECUTE FUNCTION public.log_therapist_table_changes();

DROP TRIGGER IF EXISTS trg_audit_therapist_working_hours ON public.therapist_working_hours;
CREATE TRIGGER trg_audit_therapist_working_hours
  AFTER INSERT OR UPDATE ON public.therapist_working_hours
  FOR EACH ROW EXECUTE FUNCTION public.log_therapist_table_changes();

-- DELETE is BEFORE so the day's breaks (which cascade away) can still be read and recorded on the day's single audit row.
DROP TRIGGER IF EXISTS trg_audit_therapist_working_hours_del ON public.therapist_working_hours;
CREATE TRIGGER trg_audit_therapist_working_hours_del
  BEFORE DELETE ON public.therapist_working_hours
  FOR EACH ROW EXECUTE FUNCTION public.log_therapist_table_changes();

DROP TRIGGER IF EXISTS trg_audit_therapist_working_hours_breaks ON public.therapist_working_hours_breaks;
CREATE TRIGGER trg_audit_therapist_working_hours_breaks
  AFTER INSERT OR UPDATE OR DELETE ON public.therapist_working_hours_breaks
  FOR EACH ROW EXECUTE FUNCTION public.log_therapist_table_changes();

-- ------------------------------------------------------------------ 2. pay rows: admin (and read-only admin_viewer) only
-- Same rule as the app's Payroll: pay is for admin (edit) and admin_viewer (read-only). Managers and staff never see it.
-- Staff have no SELECT policy on audit_logs. The two manager policies are recreated with one extra predicate (pay rows only
-- for role admin); the admin_viewer policy is recreated in its original form (it may read pay rows).
DROP POLICY IF EXISTS "Manager can read branch audit logs" ON public.audit_logs;
CREATE POLICY "Manager can read branch audit logs" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    (SELECT get_user_role()) = ANY (ARRAY['manager'::user_role, 'admin'::user_role])
    AND (table_name <> 'staff_compensation' OR (SELECT get_user_role()) = 'admin'::user_role)
    AND (
      branch_id = ANY ((SELECT get_user_branch_ids())::uuid[])
      OR ((SELECT get_user_role()) = 'admin'::user_role AND EXISTS (
            SELECT 1 FROM public.branches br
             WHERE br.id = audit_logs.branch_id AND br.org_id = (SELECT get_user_org_id())))
      OR ((SELECT get_user_role()) = 'admin'::user_role AND branch_id IS NULL AND EXISTS (
            SELECT 1 FROM public.users u
             WHERE u.id = audit_logs.changed_by AND u.org_id = (SELECT get_user_org_id())))
    )
  );

DROP POLICY IF EXISTS "Manager can read own org audit logs" ON public.audit_logs;
CREATE POLICY "Manager can read own org audit logs" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    (SELECT get_user_role()) = ANY (ARRAY['manager'::user_role, 'admin'::user_role])
    AND (table_name <> 'staff_compensation' OR (SELECT get_user_role()) = 'admin'::user_role)
    AND (
      (branch_id IS NULL AND EXISTS (
         SELECT 1 FROM public.users u
          WHERE u.id = audit_logs.changed_by AND u.org_id = (SELECT get_user_org_id())))
      OR EXISTS (
         SELECT 1 FROM public.branches b
          WHERE b.id = audit_logs.branch_id AND b.org_id = (SELECT get_user_org_id()))
    )
    AND (branch_id IS NULL OR branch_id = (SELECT get_user_branch_id()) OR (SELECT get_user_role()) = 'admin'::user_role)
  );

DROP POLICY IF EXISTS "Admin viewer can read org audit logs" ON public.audit_logs;
CREATE POLICY "Admin viewer can read org audit logs" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    (SELECT get_user_role()) = 'admin_viewer'::user_role
    AND (
      (branch_id IS NULL AND EXISTS (
        SELECT 1 FROM public.users u
         WHERE u.id = audit_logs.changed_by AND u.org_id = (SELECT get_user_org_id())))
      OR EXISTS (
        SELECT 1 FROM public.branches b
         WHERE b.id = audit_logs.branch_id AND b.org_id = (SELECT get_user_org_id()))
    )
  );

-- ------------------------------------------------------------------ 3. read path for the profile History feed
CREATE INDEX IF NOT EXISTS idx_audit_logs_therapist_ref
  ON public.audit_logs ((COALESCE(new_data->>'therapist_id', old_data->>'therapist_id')), changed_at DESC)
  WHERE table_name IN ('therapists', 'staff_compensation', 'staff_roster_overrides', 'therapist_working_hours', 'therapist_working_hours_breaks');

-- p_filter: 'all' | 'profile' | 'pay' | 'hours' | 'transfers'. Pay events only for admin / admin_viewer of the staff member's org;
-- managers and staff never get them, whatever the filter. Returns raw old/new data; the app turns it into sentences.
CREATE OR REPLACE FUNCTION public.get_therapist_activity(p_therapist_id uuid, p_filter text DEFAULT 'all', p_limit integer DEFAULT 50)
RETURNS TABLE (
  id uuid, at timestamptz, actor_name text, category text, table_name text, action_type text,
  old_data jsonb, new_data jsonb, from_branch_name text, to_branch_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role   user_role := get_user_role();
  v_org    uuid := get_user_org_id();
  v_branch uuid;
  v_limit  integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_filter text := COALESCE(p_filter, 'all');
  v_pay_ok boolean;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('manager', 'admin', 'admin_viewer') THEN
    RAISE EXCEPTION 'get_therapist_activity: not allowed for this role' USING ERRCODE = '42501';
  END IF;
  IF v_filter NOT IN ('all', 'profile', 'pay', 'hours', 'transfers') THEN
    RAISE EXCEPTION 'get_therapist_activity: bad filter %', v_filter USING ERRCODE = '22023';
  END IF;

  -- The staff member must belong to the caller's org (and, for a manager, one of their branches).
  SELECT t.branch_id INTO v_branch FROM public.therapists t WHERE t.id = p_therapist_id AND t.org_id = v_org;
  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'get_therapist_activity: staff member not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_role = 'manager' AND NOT (v_branch = ANY ((SELECT get_user_branch_ids())::uuid[])) THEN
    RAISE EXCEPTION 'get_therapist_activity: not allowed for this branch' USING ERRCODE = '42501';
  END IF;

  v_pay_ok := v_role IN ('admin', 'admin_viewer'); -- Payroll's rule: managers never see pay

  RETURN QUERY
  WITH feed AS (
    SELECT a.id, a.changed_at AS at, a.changed_by,
           CASE a.table_name
             WHEN 'therapists' THEN 'profile'
             WHEN 'staff_compensation' THEN 'pay'
             ELSE 'hours' END AS category,
           a.table_name, a.action_type, a.old_data, a.new_data,
           NULL::text AS from_branch_name, NULL::text AS to_branch_name
      FROM public.audit_logs a
     WHERE a.table_name IN ('therapists', 'staff_compensation', 'staff_roster_overrides', 'therapist_working_hours', 'therapist_working_hours_breaks')
       AND COALESCE(a.new_data->>'therapist_id', a.old_data->>'therapist_id') = p_therapist_id::text
       AND (a.table_name <> 'staff_compensation' OR v_pay_ok)
    UNION ALL
    SELECT s.id, s.transferred_at, s.transferred_by, 'transfers', 'staff_transfers', 'TRANSFER', NULL::jsonb,
           jsonb_build_object('is_permanent', s.is_permanent, 'is_return_leg', s.is_return_leg, 'effective_date', s.effective_date,
                              'reverted', s.reverted, 'note', s.note),
           fb.name, tb.name
      FROM public.staff_transfers s
      LEFT JOIN public.branches fb ON fb.id = s.from_branch_id
      LEFT JOIN public.branches tb ON tb.id = s.to_branch_id
     WHERE s.therapist_id = p_therapist_id AND s.org_id = v_org
  )
  SELECT f.id, f.at, u.full_name, f.category, f.table_name, f.action_type, f.old_data, f.new_data, f.from_branch_name, f.to_branch_name
    FROM feed f
    LEFT JOIN public.users u ON u.id = f.changed_by
   WHERE (v_filter = 'all' OR f.category = v_filter)
     AND (f.category <> 'pay' OR v_pay_ok)
   ORDER BY f.at DESC
   LIMIT v_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_therapist_activity(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_therapist_activity(uuid, text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.therapist_history_since()
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$ SELECT applied_at FROM public.schema_migrations WHERE version = '314' $$;

REVOKE ALL ON FUNCTION public.therapist_history_since() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.therapist_history_since() TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('314', 'audit-therapist-tables')
ON CONFLICT (version) DO NOTHING;

COMMIT;
