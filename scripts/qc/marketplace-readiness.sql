-- ZNLY-334: marketplace readiness report. READ ONLY (SELECT only inside BEGIN READ ONLY ... ROLLBACK): safe on prod.
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/qc/marketplace-readiness.sql
-- Works before and after migration 409: optional columns/tables are read defensively (to_jsonb / to_regclass), never by name.
-- Sections: 1) the function, 2) one row per active org, 3) one row per active branch, 4) blockers per org.
BEGIN READ ONLY;
\pset format aligned
\pset null '-'

\echo '== 1. public_create_booking'
SELECT count(*) AS overloads,
       COALESCE(bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE')), true)          AS anon_blocked,
       COALESCE(bool_and(NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')), true) AS authenticated_blocked,
       COALESCE(bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE')), false)     AS service_role_can,
       CASE WHEN count(*) = 0 THEN 'MISSING (migration 409 not applied)'
            WHEN count(*) > 1 THEN 'MORE THAN ONE OVERLOAD'
            WHEN bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                          AND has_function_privilege('service_role', p.oid, 'EXECUTE')) THEN 'OK (service_role only)'
            ELSE 'WRONG GRANTS' END AS verdict
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'public_create_booking';

\echo
\echo '== 2. Orgs'
SELECT o.slug,
       COALESCE(to_jsonb(o)->>'marketplace_booking_enabled', 'column missing') AS marketplace_enabled,
       COALESCE(to_jsonb(o)->>'marketplace_lookup_enabled', 'column missing (apply 410)') AS lookup_flag,
       CASE WHEN COALESCE(to_jsonb(o)->>'marketplace_booking_enabled','') = 'true'
             AND COALESCE(to_jsonb(o)->>'marketplace_lookup_enabled','false') <> 'true'
            THEN 'lookup via booking flag' ELSE '' END AS lookup_note,
       COALESCE(i.enable_rooms, true) AS rooms_tenant,
       (SELECT count(*) FROM branches b WHERE b.org_id = o.id AND b.is_active) AS active_branches,
       (SELECT count(*) FROM services s WHERE s.org_id = o.id AND s.is_active
          AND COALESCE((to_jsonb(s)->>'bookable_online')::boolean, true)) AS services_bookable_online
FROM organizations o LEFT JOIN industries i ON i.id = o.industry_type
WHERE o.is_active ORDER BY o.slug;

\echo
\echo '== 3. Branches'
SELECT o.slug AS org, b.name AS branch, b.is_active AS active,
       w.rows AS weekly_rows, w.off AS days_off,
       to_char(b.open_time, 'HH24:MI') AS open_fallback, to_char(b.close_time, 'HH24:MI') AS close_fallback,
       CASE WHEN COALESCE(w.rows, 0) = 0 AND (b.open_time IS NULL OR b.close_time IS NULL) THEN 'NO HOURS -> marketplace cannot book'
            WHEN COALESCE(w.rows, 0) > 0 AND w.off = w.rows AND w.rows = 7 THEN 'ALL 7 DAYS OFF'
            ELSE 'ok' END AS hours_flag,
       (NULLIF(btrim(COALESCE(to_jsonb(b)->>'phone', '')), '') IS NOT NULL) AS phone_present,
       COALESCE(to_jsonb(b)->>'advance_booking_days', 'default 30') AS advance_booking_days,
       (SELECT count(*) FROM therapists t WHERE t.branch_id = b.id AND t.is_active) AS active_staff,
       CASE WHEN COALESCE(i.enable_rooms, true) THEN (SELECT count(*) FROM rooms r WHERE r.branch_id = b.id AND r.is_active)::text ELSE 'n/a (room-less)' END AS active_rooms
FROM branches b
JOIN organizations o ON o.id = b.org_id AND o.is_active
LEFT JOIN industries i ON i.id = o.industry_type
CROSS JOIN LATERAL (
  SELECT NULLIF((xpath('/row/n/text()', query_to_xml(CASE WHEN to_regclass('public.branch_working_hours') IS NULL THEN 'select 0 as n, 0 as d'
           ELSE format('select count(*) as n from public.branch_working_hours where branch_id = %L', b.id) END, false, true, '')))[1]::text, '')::int AS rows,
         NULLIF((xpath('/row/d/text()', query_to_xml(CASE WHEN to_regclass('public.branch_working_hours') IS NULL THEN 'select 0 as n, 0 as d'
           ELSE format('select count(*) as d from public.branch_working_hours where branch_id = %L and is_day_off', b.id) END, false, true, '')))[1]::text, '')::int AS off
) w
WHERE b.is_active
ORDER BY o.slug, b.name;

\echo
\echo '== 4. Blockers per org (an org with none listed is ready, once enabled)'
WITH fn AS (
  SELECT count(*) AS n,
         COALESCE(bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                           AND has_function_privilege('service_role', p.oid, 'EXECUTE')), false) AS grants_ok
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'public_create_booking'
), br AS (
  SELECT b.org_id, b.name, b.id,
         (SELECT count(*) FROM therapists t WHERE t.branch_id = b.id AND t.is_active) AS staff,
         (SELECT count(*) FROM rooms r WHERE r.branch_id = b.id AND r.is_active) AS rooms,
         b.open_time IS NULL OR b.close_time IS NULL AS no_fallback,
         COALESCE(NULLIF((xpath('/row/d/text()', query_to_xml(CASE WHEN to_regclass('public.branch_working_hours') IS NULL THEN 'select 0 as d'
           ELSE format('select count(*) as d from public.branch_working_hours where branch_id = %L and is_day_off', b.id) END, false, true, '')))[1]::text, '')::int, 0) AS off_days,
         COALESCE(NULLIF((xpath('/row/n/text()', query_to_xml(CASE WHEN to_regclass('public.branch_working_hours') IS NULL THEN 'select 0 as n'
           ELSE format('select count(*) as n from public.branch_working_hours where branch_id = %L', b.id) END, false, true, '')))[1]::text, '')::int, 0) AS weekly
  FROM branches b WHERE b.is_active
)
SELECT o.slug AS org,
       COALESCE(NULLIF(array_to_string(array_remove(ARRAY[
         CASE WHEN fn.n = 0 THEN 'function public_create_booking missing (apply 409)' WHEN NOT fn.grants_ok THEN 'function grants wrong or overloaded' END,
         CASE WHEN to_jsonb(o)->>'marketplace_booking_enabled' IS NULL THEN 'marketplace_booking_enabled column missing (apply 409)'
              WHEN to_jsonb(o)->>'marketplace_booking_enabled' <> 'true' THEN 'marketplace_booking_enabled is off (owner opt-in)' END,
         CASE WHEN to_jsonb(o)->>'marketplace_booking_enabled' = 'true' AND to_regprocedure('public.marketplace_lookup_customer(text,text,text)') IS NULL
              THEN 'booking on but customer lookup function missing (apply 410): Appointments page would be empty' END,
         CASE WHEN NOT EXISTS (SELECT 1 FROM br WHERE br.org_id = o.id) THEN 'no active branch' END,
         (SELECT 'NO HOURS at: ' || string_agg(br.name, ', ') FROM br WHERE br.org_id = o.id AND br.weekly = 0 AND br.no_fallback),
         (SELECT 'ALL 7 DAYS OFF at: ' || string_agg(br.name, ', ') FROM br WHERE br.org_id = o.id AND br.weekly = 7 AND br.off_days = 7),
         (SELECT 'no active staff at: ' || string_agg(br.name, ', ') FROM br WHERE br.org_id = o.id AND br.staff = 0),
         CASE WHEN COALESCE(i.enable_rooms, true) THEN (SELECT 'rooms tenant with no active room at: ' || string_agg(br.name, ', ') FROM br WHERE br.org_id = o.id AND br.rooms = 0) END,
         CASE WHEN NOT EXISTS (SELECT 1 FROM services s WHERE s.org_id = o.id AND s.is_active AND COALESCE((to_jsonb(s)->>'bookable_online')::boolean, true))
              THEN 'no service bookable online' END
       ], NULL), E'\n  - '), ''), 'none') AS blockers
FROM organizations o LEFT JOIN industries i ON i.id = o.industry_type CROSS JOIN fn
WHERE o.is_active ORDER BY o.slug;

ROLLBACK;
