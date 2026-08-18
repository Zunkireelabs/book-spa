--
-- PostgreSQL database dump
--

\restrict zS5LwiFkP1hiCMjOiVDE7bTfwxB5n9s6a8VyCUroQ33foyahNOC3nRYrbecUain

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: auth; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA auth;


--
-- Name: pg_cron; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;


--
-- Name: EXTENSION pg_cron; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_cron IS 'Job scheduler for PostgreSQL';


--
-- Name: extensions; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA extensions;


--
-- Name: graphql; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA graphql;


--
-- Name: graphql_public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA graphql_public;


--
-- Name: pgbouncer; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA pgbouncer;


--
-- Name: realtime; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA realtime;


--
-- Name: storage; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA storage;


--
-- Name: supabase_migrations; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA supabase_migrations;


--
-- Name: vault; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA vault;


--
-- Name: btree_gist; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;


--
-- Name: EXTENSION btree_gist; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION btree_gist IS 'support for indexing common datatypes in GiST';


--
-- Name: pg_stat_statements; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;


--
-- Name: EXTENSION pg_stat_statements; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_stat_statements IS 'track planning and execution statistics of all SQL statements executed';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: supabase_vault; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;


--
-- Name: EXTENSION supabase_vault; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION supabase_vault IS 'Supabase Vault Extension';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: aal_level; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.aal_level AS ENUM (
    'aal1',
    'aal2',
    'aal3'
);


--
-- Name: code_challenge_method; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.code_challenge_method AS ENUM (
    's256',
    'plain'
);


--
-- Name: factor_status; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.factor_status AS ENUM (
    'unverified',
    'verified'
);


--
-- Name: factor_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.factor_type AS ENUM (
    'totp',
    'webauthn',
    'phone'
);


--
-- Name: oauth_authorization_status; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_authorization_status AS ENUM (
    'pending',
    'approved',
    'denied',
    'expired'
);


--
-- Name: oauth_client_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_client_type AS ENUM (
    'public',
    'confidential'
);


--
-- Name: oauth_registration_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_registration_type AS ENUM (
    'dynamic',
    'manual'
);


--
-- Name: oauth_response_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_response_type AS ENUM (
    'code'
);


--
-- Name: one_time_token_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.one_time_token_type AS ENUM (
    'confirmation_token',
    'reauthentication_token',
    'recovery_token',
    'email_change_token_new',
    'email_change_token_current',
    'phone_change_token'
);


--
-- Name: booking_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.booking_status AS ENUM (
    'Pending',
    'Confirmed',
    'In-Progress',
    'Completed',
    'Cancelled',
    'No Show'
);


--
-- Name: discount_status_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.discount_status_enum AS ENUM (
    'none',
    'pending',
    'approved'
);


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'staff',
    'manager',
    'admin',
    'admin_viewer'
);


--
-- Name: action; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE realtime.action AS ENUM (
    'INSERT',
    'UPDATE',
    'DELETE',
    'TRUNCATE',
    'ERROR'
);


--
-- Name: equality_op; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE realtime.equality_op AS ENUM (
    'eq',
    'neq',
    'lt',
    'lte',
    'gt',
    'gte',
    'in',
    'like',
    'ilike',
    'is',
    'match',
    'imatch',
    'isdistinct'
);


--
-- Name: user_defined_filter; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE realtime.user_defined_filter AS (
	column_name text,
	op realtime.equality_op,
	value text,
	negate boolean
);


--
-- Name: wal_column; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE realtime.wal_column AS (
	name text,
	type_name text,
	type_oid oid,
	value jsonb,
	is_pkey boolean,
	is_selectable boolean
);


--
-- Name: wal_rls; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE realtime.wal_rls AS (
	wal jsonb,
	is_rls_enabled boolean,
	subscription_ids uuid[],
	errors text[]
);


--
-- Name: buckettype; Type: TYPE; Schema: storage; Owner: -
--

CREATE TYPE storage.buckettype AS ENUM (
    'STANDARD',
    'ANALYTICS',
    'VECTOR'
);


--
-- Name: email(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.email() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;


--
-- Name: FUNCTION email(); Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON FUNCTION auth.email() IS 'Deprecated. Use auth.jwt() -> ''email'' instead.';


--
-- Name: jwt(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.jwt() RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
  select 
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$$;


--
-- Name: role(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.role() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;


--
-- Name: FUNCTION role(); Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON FUNCTION auth.role() IS 'Deprecated. Use auth.jwt() -> ''role'' instead.';


--
-- Name: uid(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;


--
-- Name: FUNCTION uid(); Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON FUNCTION auth.uid() IS 'Deprecated. Use auth.jwt() -> ''sub'' instead.';


--
-- Name: grant_pg_cron_access(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.grant_pg_cron_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (
    SELECT
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_cron'
  )
  THEN
    grant usage on schema cron to postgres with grant option;

    alter default privileges in schema cron grant all on tables to postgres with grant option;
    alter default privileges in schema cron grant all on functions to postgres with grant option;
    alter default privileges in schema cron grant all on sequences to postgres with grant option;

    alter default privileges for user supabase_admin in schema cron grant all
        on sequences to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on tables to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on functions to postgres with grant option;

    grant all privileges on all tables in schema cron to postgres with grant option;
    revoke all on table cron.job from postgres;
    grant select on table cron.job to postgres with grant option;
  END IF;
END;
$$;


--
-- Name: FUNCTION grant_pg_cron_access(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.grant_pg_cron_access() IS 'Grants access to pg_cron';


--
-- Name: grant_pg_graphql_access(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.grant_pg_graphql_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $_$
DECLARE
    func_is_graphql_resolve bool;
BEGIN
    func_is_graphql_resolve = (
        SELECT n.proname = 'resolve'
        FROM pg_event_trigger_ddl_commands() AS ev
        LEFT JOIN pg_catalog.pg_proc AS n
        ON ev.objid = n.oid
    );

    IF func_is_graphql_resolve
    THEN
        -- Update public wrapper to pass all arguments through to the pg_graphql resolve func
        DROP FUNCTION IF EXISTS graphql_public.graphql;
        create or replace function graphql_public.graphql(
            "operationName" text default null,
            query text default null,
            variables jsonb default null,
            extensions jsonb default null
        )
            returns jsonb
            language sql
        as $$
            select graphql.resolve(
                query := query,
                variables := coalesce(variables, '{}'),
                "operationName" := "operationName",
                extensions := extensions
            );
        $$;

        -- This hook executes when `graphql.resolve` is created. That is not necessarily the last
        -- function in the extension so we need to grant permissions on existing entities AND
        -- update default permissions to any others that are created after `graphql.resolve`
        grant usage on schema graphql to postgres, anon, authenticated, service_role;
        grant select on all tables in schema graphql to postgres, anon, authenticated, service_role;
        grant execute on all functions in schema graphql to postgres, anon, authenticated, service_role;
        grant all on all sequences in schema graphql to postgres, anon, authenticated, service_role;
        alter default privileges in schema graphql grant all on tables to postgres, anon, authenticated, service_role;
        alter default privileges in schema graphql grant all on functions to postgres, anon, authenticated, service_role;
        alter default privileges in schema graphql grant all on sequences to postgres, anon, authenticated, service_role;

        -- Allow postgres role to allow granting usage on graphql and graphql_public schemas to custom roles
        grant usage on schema graphql_public to postgres with grant option;
        grant usage on schema graphql to postgres with grant option;
    END IF;

END;
$_$;


--
-- Name: FUNCTION grant_pg_graphql_access(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.grant_pg_graphql_access() IS 'Grants access to pg_graphql';


--
-- Name: grant_pg_net_access(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.grant_pg_net_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_net'
  )
  THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_roles
      WHERE rolname = 'supabase_functions_admin'
    )
    THEN
      CREATE USER supabase_functions_admin NOINHERIT CREATEROLE LOGIN NOREPLICATION;
    END IF;

    GRANT USAGE ON SCHEMA net TO supabase_functions_admin, postgres, anon, authenticated, service_role;

    IF EXISTS (
      SELECT FROM pg_extension
      WHERE extname = 'pg_net'
      -- all versions in use on existing projects as of 2025-02-20
      -- version 0.12.0 onwards don't need these applied
      AND extversion IN ('0.2', '0.6', '0.7', '0.7.1', '0.8', '0.10.0', '0.11.0')
    ) THEN
      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;

      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;

      REVOKE ALL ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;
      REVOKE ALL ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;

      GRANT EXECUTE ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
    END IF;
  END IF;
END;
$$;


--
-- Name: FUNCTION grant_pg_net_access(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.grant_pg_net_access() IS 'Grants access to pg_net';


--
-- Name: pgrst_ddl_watch(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.pgrst_ddl_watch() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN SELECT * FROM pg_event_trigger_ddl_commands()
  LOOP
    IF cmd.command_tag IN (
      'CREATE SCHEMA', 'ALTER SCHEMA'
    , 'CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE'
    , 'CREATE FOREIGN TABLE', 'ALTER FOREIGN TABLE'
    , 'CREATE VIEW', 'ALTER VIEW'
    , 'CREATE MATERIALIZED VIEW', 'ALTER MATERIALIZED VIEW'
    , 'CREATE FUNCTION', 'ALTER FUNCTION'
    , 'CREATE TRIGGER'
    , 'CREATE TYPE', 'ALTER TYPE'
    , 'CREATE RULE'
    , 'COMMENT'
    )
    -- don't notify in case of CREATE TEMP table or other objects created on pg_temp
    AND cmd.schema_name is distinct from 'pg_temp'
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $$;


--
-- Name: pgrst_drop_watch(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.pgrst_drop_watch() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_dropped_objects()
  LOOP
    IF obj.object_type IN (
      'schema'
    , 'table'
    , 'foreign table'
    , 'view'
    , 'materialized view'
    , 'function'
    , 'trigger'
    , 'type'
    , 'rule'
    )
    AND obj.is_temporary IS false -- no pg_temp objects
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $$;


--
-- Name: set_graphql_placeholder(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.set_graphql_placeholder() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $_$
    DECLARE
    graphql_is_dropped bool;
    BEGIN
    graphql_is_dropped = (
        SELECT ev.schema_name = 'graphql_public'
        FROM pg_event_trigger_dropped_objects() AS ev
        WHERE ev.schema_name = 'graphql_public'
    );

    IF graphql_is_dropped
    THEN
        create or replace function graphql_public.graphql(
            "operationName" text default null,
            query text default null,
            variables jsonb default null,
            extensions jsonb default null
        )
            returns jsonb
            language plpgsql
        as $$
            DECLARE
                server_version float;
            BEGIN
                server_version = (SELECT (SPLIT_PART((select version()), ' ', 2))::float);

                IF server_version >= 14 THEN
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql extension is not enabled.'
                            )
                        )
                    );
                ELSE
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql is only available on projects running Postgres 14 onwards.'
                            )
                        )
                    );
                END IF;
            END;
        $$;
    END IF;

    END;
$_$;


--
-- Name: FUNCTION set_graphql_placeholder(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.set_graphql_placeholder() IS 'Reintroduces placeholder function for graphql_public.graphql';


--
-- Name: graphql(text, text, jsonb, jsonb); Type: FUNCTION; Schema: graphql_public; Owner: -
--

CREATE FUNCTION graphql_public.graphql("operationName" text DEFAULT NULL::text, query text DEFAULT NULL::text, variables jsonb DEFAULT NULL::jsonb, extensions jsonb DEFAULT NULL::jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
            DECLARE
                server_version float;
            BEGIN
                server_version = (SELECT (SPLIT_PART((select version()), ' ', 2))::float);

                IF server_version >= 14 THEN
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql extension is not enabled.'
                            )
                        )
                    );
                ELSE
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql is only available on projects running Postgres 14 onwards.'
                            )
                        )
                    );
                END IF;
            END;
        $$;


--
-- Name: get_auth(text); Type: FUNCTION; Schema: pgbouncer; Owner: -
--

CREATE FUNCTION pgbouncer.get_auth(p_usename text) RETURNS TABLE(username text, password text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
  BEGIN
      RAISE DEBUG 'PgBouncer auth request: %', p_usename;

      RETURN QUERY
      SELECT
          rolname::text,
          CASE WHEN rolvaliduntil < now()
              THEN null
              ELSE rolpassword::text
          END
      FROM pg_authid
      WHERE rolname=$1 and rolcanlogin;
  END;
  $_$;


--
-- Name: _sync_user_branch_for_transfer(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._sync_user_branch_for_transfer(p_therapist_id uuid, p_org_id uuid, p_to_branch_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_name     text;
  v_match_id uuid;
  v_n_match  int;
BEGIN
  SELECT name INTO v_name FROM public.therapists WHERE id = p_therapist_id;
  IF v_name IS NULL THEN RETURN false; END IF;

  -- Only staff role, same org, name matches the therapist row.
  -- (Two-step instead of `count(*), max(id)` — Postgres has no max(uuid).)
  SELECT count(*) INTO v_n_match
    FROM public.users
   WHERE org_id = p_org_id
     AND role = 'staff'
     AND lower(trim(full_name)) = lower(trim(v_name));

  IF v_n_match = 0 THEN
    RAISE NOTICE 'transfer: no matching staff user for therapist % (%); users.branch_id unchanged', p_therapist_id, v_name;
    RETURN false;
  END IF;

  IF v_n_match > 1 THEN
    RAISE NOTICE 'transfer: % staff users match therapist % (%); ambiguous, users.branch_id unchanged — handle manually', v_n_match, p_therapist_id, v_name;
    RETURN false;
  END IF;

  SELECT id INTO v_match_id
    FROM public.users
   WHERE org_id = p_org_id
     AND role = 'staff'
     AND lower(trim(full_name)) = lower(trim(v_name));

  UPDATE public.users
     SET branch_id = p_to_branch_id
   WHERE id = v_match_id
     AND branch_id IS DISTINCT FROM p_to_branch_id;

  RETURN true;
END;
$$;


--
-- Name: apply_due_staff_transfers(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_due_staff_transfers() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_today          date := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  v_rec            record;
  v_new_order      int;
  v_current_branch uuid;
  v_count          int := 0;
BEGIN
  FOR v_rec IN
    SELECT * FROM public.staff_transfers
    WHERE applied = false AND effective_date <= v_today
    ORDER BY effective_date, transferred_at
  LOOP
    SELECT branch_id INTO v_current_branch
    FROM public.therapists WHERE id = v_rec.therapist_id;

    IF v_current_branch IS NULL THEN
      UPDATE public.staff_transfers SET applied = true WHERE id = v_rec.id;
      CONTINUE;
    END IF;

    IF v_current_branch IS DISTINCT FROM v_rec.to_branch_id THEN
      SELECT COALESCE(max(display_order), -1) + 1 INTO v_new_order
      FROM public.therapists WHERE branch_id = v_rec.to_branch_id;

      UPDATE public.therapists
         SET branch_id = v_rec.to_branch_id,
             display_order = v_new_order
       WHERE id = v_rec.therapist_id;

      -- migration-048: keep the staff user's login branch in sync (staff role only).
      PERFORM public._sync_user_branch_for_transfer(v_rec.therapist_id, v_rec.org_id, v_rec.to_branch_id);
    END IF;

    UPDATE public.staff_transfers SET applied = true WHERE id = v_rec.id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;


--
-- Name: can_delete_room(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_delete_room(p_room_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM bookings WHERE room_id = p_room_id LIMIT 1
  );
$$;


--
-- Name: can_delete_service(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_delete_service(p_service_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM bookings WHERE service_id = p_service_id LIMIT 1
  );
$$;


--
-- Name: can_delete_therapist(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_delete_therapist(p_therapist_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM bookings WHERE therapist_id = p_therapist_id LIMIT 1
  );
$$;


--
-- Name: cancel_scheduled_transfer(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_scheduled_transfer(p_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_role          user_role := get_user_role();
  v_caller_org    uuid := get_user_org_id();
  v_caller_branch uuid := get_user_branch_id();
  v_rec           record;
BEGIN
  SELECT * INTO v_rec FROM public.staff_transfers WHERE id = p_id;

  IF v_rec.id IS NULL THEN
    RAISE EXCEPTION 'cancel_scheduled_transfer: transfer not found';
  END IF;
  IF v_rec.applied THEN
    RAISE EXCEPTION 'cancel_scheduled_transfer: transfer already applied';
  END IF;
  IF v_rec.org_id IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'cancel_scheduled_transfer: not your organization';
  END IF;
  IF NOT (
    v_role = 'admin'
    OR (v_role = 'manager' AND v_rec.from_branch_id = v_caller_branch)
  ) THEN
    RAISE EXCEPTION 'cancel_scheduled_transfer: insufficient permissions';
  END IF;

  DELETE FROM public.staff_transfers WHERE id = p_id;
  RETURN true;
END;
$$;


--
-- Name: check_attendance_day_lock(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_attendance_day_lock() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM daily_reports
    WHERE branch_id = NEW.branch_id
      AND report_date = NEW.date
  ) THEN
    RAISE EXCEPTION 'ATTENDANCE_DAY_LOCKED: This day has been closed. Attendance cannot be modified.'
      USING ERRCODE = 'P0004';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: check_unpaid_before_daily_close(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_unpaid_before_daily_close() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_unpaid_count integer;
BEGIN
  SELECT count(*) INTO v_unpaid_count
  FROM bookings
  WHERE branch_id = NEW.branch_id
    AND date = NEW.report_date
    AND status = 'Completed'
    AND payment_status = 'unpaid';

  IF v_unpaid_count > 0 THEN
    RAISE EXCEPTION
      'UNPAID_BOOKINGS: Cannot close day. % completed booking(s) remain unpaid for % on branch %.',
      v_unpaid_count, NEW.report_date, NEW.branch_id
      USING ERRCODE = 'P0005';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: compute_booking_datetimes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compute_booking_datetimes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  svc_duration integer;
BEGIN
  -- Fetch service duration
  SELECT duration_minutes INTO svc_duration
  FROM services
  WHERE id = NEW.service_id;

  IF svc_duration IS NULL THEN
    RAISE EXCEPTION 'Service not found: %', NEW.service_id;
  END IF;

  -- Compute end_time from start_time + duration
  NEW.end_time := NEW.start_time + (svc_duration * interval '1 minute');

  -- Compute timestamptz values (Nepal timezone: Asia/Kathmandu = UTC+5:45)
  NEW.start_datetime := (NEW.date + NEW.start_time) AT TIME ZONE 'Asia/Kathmandu';
  NEW.end_datetime := (NEW.date + NEW.end_time) AT TIME ZONE 'Asia/Kathmandu';

  RETURN NEW;
END;
$$;


--
-- Name: compute_final_amount(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compute_final_amount() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.final_amount := NEW.base_amount - NEW.discount_amount;
  RETURN NEW;
END;
$$;


--
-- Name: create_public_booking(uuid, uuid, date, time without time zone, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_public_booking(p_branch_id uuid, p_service_id uuid, p_booking_date date, p_start_time time without time zone, p_full_name text, p_phone text, p_notes text DEFAULT NULL::text, p_client_request_id text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_service       record;
  v_branch        record;
  v_customer_id   uuid;
  v_booking       record;
  v_name          text;
  v_phone         text;
  v_recent_count  integer;
  v_existing      record;
BEGIN
  -- ── C) IDEMPOTENCY GUARD ──────────────────────────────────
  IF p_client_request_id IS NOT NULL THEN
    SELECT id, booking_number, status
      INTO v_existing
      FROM bookings
     WHERE client_request_id = p_client_request_id;

    IF v_existing.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'booking_id',     v_existing.id,
        'booking_number', v_existing.booking_number,
        'status',         v_existing.status
      );
    END IF;
  END IF;

  -- ── 1. VALIDATE BRANCH ────────────────────────────────────
  SELECT id, open_time, close_time
    INTO v_branch
    FROM branches
   WHERE id = p_branch_id
     AND (is_active IS NULL OR is_active = true);

  IF v_branch.id IS NULL THEN
    RAISE EXCEPTION 'INVALID_BRANCH: Branch not found or inactive.'
      USING ERRCODE = 'P0010';
  END IF;

  -- ── 2. VALIDATE SERVICE ───────────────────────────────────
  SELECT id, name, duration_minutes, price_npr
    INTO v_service
    FROM services
   WHERE id = p_service_id AND is_active = true;

  IF v_service IS NULL THEN
    RAISE EXCEPTION 'INVALID_SERVICE: Service not found or inactive.'
      USING ERRCODE = 'P0011';
  END IF;

  -- ── 3A. VALIDATE DATE: not in past ────────────────────────
  IF p_booking_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'INVALID_DATE: Booking date cannot be in the past.'
      USING ERRCODE = 'P0012';
  END IF;

  -- ── 3B. VALIDATE DATE: not beyond 90 days ─────────────────
  IF p_booking_date > CURRENT_DATE + INTERVAL '90 days' THEN
    RAISE EXCEPTION 'INVALID_DATE_RANGE: Booking date cannot be more than 90 days in the future.'
      USING ERRCODE = 'P0014';
  END IF;

  -- ── A) BOOKING WINDOW: operating hours ─────────────────────
  IF p_start_time < v_branch.open_time OR p_start_time >= v_branch.close_time THEN
    RAISE EXCEPTION 'OUTSIDE_OPERATING_HOURS: Booking time must be between % and %.',
      v_branch.open_time, v_branch.close_time
      USING ERRCODE = 'P0015';
  END IF;

  -- ── A) BOOKING WINDOW: same-day after close ────────────────
  IF p_booking_date = CURRENT_DATE AND CURRENT_TIME > v_branch.close_time THEN
    RAISE EXCEPTION 'DAY_ALREADY_CLOSED: Branch is closed for today. Please book for a future date.'
      USING ERRCODE = 'P0016';
  END IF;

  -- ── 4. TRIM & VALIDATE INPUTS ─────────────────────────────
  v_name  := trim(p_full_name);
  v_phone := trim(p_phone);

  IF v_name IS NULL OR v_name = '' THEN
    RAISE EXCEPTION 'INVALID_INPUT: Full name is required.'
      USING ERRCODE = 'P0013';
  END IF;

  IF v_phone IS NULL OR v_phone = '' THEN
    RAISE EXCEPTION 'INVALID_INPUT: Phone number is required.'
      USING ERRCODE = 'P0013';
  END IF;

  -- ── B) SOFT RATE LIMITING ──────────────────────────────────
  SELECT count(*) INTO v_recent_count
    FROM bookings
   WHERE customer_phone = v_phone
     AND created_at > now() - interval '5 minutes';

  IF v_recent_count >= 3 THEN
    RAISE EXCEPTION 'RATE_LIMIT_EXCEEDED: Too many bookings from this phone number. Please wait a few minutes.'
      USING ERRCODE = 'P0017';
  END IF;

  -- ── 5. UPSERT CUSTOMER ────────────────────────────────────
  SELECT id INTO v_customer_id
    FROM customers
   WHERE branch_id = p_branch_id AND phone = v_phone;

  IF v_customer_id IS NULL THEN
    INSERT INTO customers (branch_id, full_name, phone)
    VALUES (p_branch_id, v_name, v_phone)
    RETURNING id INTO v_customer_id;
  END IF;

  -- ── 6. INSERT BOOKING ─────────────────────────────────────
  INSERT INTO bookings (
    branch_id,
    room_id,
    service_id,
    customer_id,
    customer_name,
    customer_phone,
    date,
    start_time,
    base_amount,
    status,
    payment_status,
    discount_status,
    discount_amount,
    is_locked,
    created_by,
    therapist_id,
    service_name_snapshot,
    service_duration_snapshot,
    service_price_snapshot,
    therapist_name_snapshot,
    room_name_snapshot,
    special_requests,
    client_request_id
  ) VALUES (
    p_branch_id,
    NULL,
    p_service_id,
    v_customer_id,
    v_name,
    v_phone,
    p_booking_date,
    p_start_time,
    v_service.price_npr,
    'Pending',
    'unpaid',
    'none',
    0,
    false,
    NULL,
    NULL,
    v_service.name,
    v_service.duration_minutes,
    v_service.price_npr,
    NULL,
    NULL,
    p_notes,
    p_client_request_id
  ) RETURNING * INTO v_booking;

  -- ── 7. RETURN ─────────────────────────────────────────────
  RETURN jsonb_build_object(
    'booking_id',     v_booking.id,
    'booking_number', v_booking.booking_number,
    'status',         v_booking.status
  );
END;
$$;


--
-- Name: enforce_booking_immutability(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_booking_immutability() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
  BEGIN
    IF OLD.is_locked = true THEN
      RAISE EXCEPTION 'DAY_LOCKED: This day has been closed. No further modifications allowed.'
        USING ERRCODE = 'P0001';
    END IF;
  
    IF OLD.status = 'Completed' THEN
      IF (
        NEW.status IS DISTINCT FROM OLD.status
        OR NEW.base_amount IS DISTINCT FROM OLD.base_amount
        OR NEW.therapist_id IS DISTINCT FROM OLD.therapist_id
      ) THEN
        RAISE EXCEPTION 'BOOKING_IMMUTABLE: Completed bookings cannot be modified.'
          USING ERRCODE = 'P0002';
      END IF;

      IF OLD.payment_status = 'paid' AND (
        NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
        OR NEW.discount_status IS DISTINCT FROM OLD.discount_status
      ) THEN
        RAISE EXCEPTION 'BOOKING_IMMUTABLE: Cannot modify discount on a paid booking.'
          USING ERRCODE = 'P0002';
      END IF;
    END IF;

    RETURN NEW;
  END;
  $$;


--
-- Name: enforce_payroll_immutability(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_payroll_immutability() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  -- payroll_items: look up parent run status
  IF TG_TABLE_NAME = 'payroll_items' THEN
    IF EXISTS (
      SELECT 1 FROM public.payroll_runs
      WHERE id = COALESCE(OLD.payroll_run_id, NEW.payroll_run_id)
        AND status = 'finalized'
    ) THEN
      RAISE EXCEPTION 'PAYROLL_FINALIZED: This payroll run has been finalized and cannot be changed.'
        USING ERRCODE = 'P0003';
    END IF;
  END IF;

  -- payroll_runs: block changes once finalized (except the finalize operation itself)
  IF TG_TABLE_NAME = 'payroll_runs' THEN
    IF OLD.status = 'finalized' THEN
      RAISE EXCEPTION 'PAYROLL_FINALIZED: This payroll run has been finalized and cannot be changed.'
        USING ERRCODE = 'P0003';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;


--
-- Name: enforce_therapist_for_active_bookings(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_therapist_for_active_bookings() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.status IN ('In-Progress', 'Completed')
     AND NEW.therapist_id IS NULL THEN
    RAISE EXCEPTION
      'THERAPIST_REQUIRED: Bookings with status "%" must have a therapist assigned.',
      NEW.status
      USING ERRCODE = 'P0003';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: enqueue_notification(uuid, text, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enqueue_notification(p_user_id uuid, p_type text, p_title text, p_body text, p_booking_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF (SELECT role FROM public.users WHERE id = auth.uid())
       NOT IN ('manager', 'admin') THEN
    RAISE EXCEPTION 'Not authorized to enqueue notifications'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, booking_id)
  VALUES (p_user_id, p_type, p_title, p_body, p_booking_id)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


--
-- Name: enroll_member(uuid, uuid, numeric, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enroll_member(p_customer_id uuid, p_tier_id uuid, p_initial_deposit numeric, p_payment_mode text, p_notes text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_role        user_role := get_user_role();
  v_caller_org  uuid      := get_user_org_id();
  v_cust_org    uuid;
  v_tier_org    uuid;
  v_membership  uuid;
BEGIN
  IF v_role NOT IN ('manager','admin') THEN
    RAISE EXCEPTION 'enroll_member: manager or admin role required';
  END IF;

  IF p_initial_deposit IS NULL OR p_initial_deposit <= 0 THEN
    RAISE EXCEPTION 'enroll_member: initial deposit must be positive';
  END IF;

  IF p_payment_mode IS NULL OR p_payment_mode NOT IN ('Cash','Card','MobileBanking','Cheque','Esewa','Khalti') THEN
    RAISE EXCEPTION 'enroll_member: invalid payment_mode %', p_payment_mode;
  END IF;

  SELECT org_id INTO v_cust_org FROM public.customers      WHERE id = p_customer_id;
  SELECT org_id INTO v_tier_org FROM public.membership_tiers WHERE id = p_tier_id;

  IF v_cust_org IS NULL THEN
    RAISE EXCEPTION 'enroll_member: customer % not found', p_customer_id;
  END IF;
  IF v_tier_org IS NULL THEN
    RAISE EXCEPTION 'enroll_member: tier % not found', p_tier_id;
  END IF;
  IF v_cust_org IS DISTINCT FROM v_caller_org OR v_tier_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'enroll_member: customer and tier must be in your organization';
  END IF;

  INSERT INTO public.memberships (org_id, customer_id, tier_id, notes, created_by)
  VALUES (v_caller_org, p_customer_id, p_tier_id, p_notes, auth.uid())
  RETURNING id INTO v_membership;

  -- First deposit (trigger recomputes balance + may activate).
  PERFORM public.record_membership_transaction(
    v_membership, 'deposit', p_initial_deposit, p_payment_mode, NULL, NULL,
    'Initial enrollment deposit'
  );

  RETURN v_membership;
END;
$$;


--
-- Name: extend_membership(uuid, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.extend_membership(p_membership_id uuid, p_new_expiry_date date, p_notes text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_role        user_role := get_user_role();
  v_caller_org  uuid      := get_user_org_id();
  v_mem_org     uuid;
  v_balance     numeric(12,2);
  v_expiry      date;
  v_today       date := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  v_txn_id      uuid;
BEGIN
  IF v_role NOT IN ('manager','admin') THEN
    RAISE EXCEPTION 'extend_membership: manager or admin role required';
  END IF;

  IF p_new_expiry_date IS NULL OR p_new_expiry_date <= v_today THEN
    RAISE EXCEPTION 'extend_membership: new expiry date must be after today';
  END IF;

  -- Lock the membership row + load current state.
  SELECT org_id, balance, expiry_date
    INTO v_mem_org, v_balance, v_expiry
  FROM public.memberships
  WHERE id = p_membership_id
  FOR UPDATE;

  IF v_mem_org IS NULL THEN
    RAISE EXCEPTION 'extend_membership: membership % not found', p_membership_id;
  END IF;

  IF v_mem_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'extend_membership: membership is not in your organization';
  END IF;

  IF v_balance <= 0 THEN
    RAISE EXCEPTION 'extend_membership: membership has no remaining balance -- use renew instead';
  END IF;

  IF v_expiry IS NULL OR v_expiry >= v_today THEN
    RAISE EXCEPTION 'extend_membership: membership is not lapsed';
  END IF;

  -- Extend validity only -- balance, total_deposited, and tier_id are untouched.
  UPDATE public.memberships
     SET expiry_date = p_new_expiry_date
   WHERE id = p_membership_id;

  -- Zero-amount audit row so the reactivation shows up in transaction history.
  INSERT INTO public.membership_transactions
    (membership_id, org_id, kind, amount, performed_by, notes)
  VALUES
    (p_membership_id, v_mem_org, 'extension', 0, auth.uid(),
     COALESCE(p_notes, 'Membership reactivated -- validity extended to ' || p_new_expiry_date || ', balance preserved.'))
  RETURNING id INTO v_txn_id;

  RETURN v_txn_id;
END;
$$;


--
-- Name: fn_insert_audit_log(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_insert_audit_log() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_branch_id uuid;
BEGIN
  -- Extract branch_id from record (works for any table with that column)
  v_branch_id := (to_jsonb(NEW) ->> 'branch_id')::uuid;

  -- For payments, derive branch_id from parent booking
  IF v_branch_id IS NULL AND TG_TABLE_NAME = 'payments' THEN
    SELECT b.branch_id INTO v_branch_id
    FROM bookings b
    WHERE b.id = NEW.booking_id;
  END IF;

  INSERT INTO audit_logs (
    branch_id,
    table_name,
    record_id,
    action_type,
    old_data,
    new_data,
    changed_by,
    changed_at
  ) VALUES (
    v_branch_id,
    TG_TABLE_NAME,
    NEW.id,
    TG_OP,
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
    to_jsonb(NEW),
    auth.uid(),
    now()
  );

  RETURN NEW;
END;
$$;


--
-- Name: generate_booking_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_booking_number() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  DECLARE
    date_part text;
    seq_num integer;
    new_number text;
  BEGIN
    date_part := to_char(NEW.date, 'YYYYMMDD');

    PERFORM pg_advisory_xact_lock(hashtext('booking_number:' || date_part));

    SELECT COUNT(*) + 1 INTO seq_num
    FROM bookings
    WHERE date = NEW.date;

    new_number := 'BK-' || date_part || '-' || lpad(seq_num::text, 4, '0');

    WHILE EXISTS (SELECT 1 FROM bookings WHERE booking_number = new_number) LOOP
      seq_num := seq_num + 1;
      new_number := 'BK-' || date_part || '-' || lpad(seq_num::text, 4, '0');
    END LOOP;

    NEW.booking_number := new_number;
    RETURN NEW;
  END;
  $$;


--
-- Name: get_user_branch_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_branch_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT branch_id FROM users WHERE id = auth.uid();
$$;


--
-- Name: get_user_branch_ids(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_branch_ids() RETURNS uuid[]
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT ARRAY(
    SELECT branch_id FROM public.users WHERE id = auth.uid() AND branch_id IS NOT NULL
    UNION
    SELECT branch_id FROM public.user_branches WHERE user_id = auth.uid()
  );
$$;


--
-- Name: get_user_org_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_org_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT org_id FROM users WHERE id = auth.uid();
$$;


--
-- Name: get_user_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_role() RETURNS public.user_role
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT role FROM users WHERE id = auth.uid();
$$;


--
-- Name: list_discount_approvers(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_discount_approvers() RETURNS TABLE(id uuid, full_name text, role public.user_role, branch_id uuid)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    SELECT u.id, u.full_name, u.role, u.branch_id
    FROM public.users u
    WHERE u.is_active = true
      AND u.pin IS NOT NULL AND u.pin <> ''
      AND u.id <> auth.uid()
      AND u.org_id = (SELECT org_id FROM public.users WHERE id = auth.uid())
      AND (
        u.role = 'admin'
        OR (u.role = 'manager'
            AND u.branch_id = (SELECT branch_id FROM public.users WHERE id = auth.uid()))
      )
    ORDER BY u.role DESC, u.full_name;
  $$;


--
-- Name: login_with_pin(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.login_with_pin(p_email text, p_pin text, p_org_slug text DEFAULT NULL::text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user record;
BEGIN
  -- Look up the user with their org slug
  SELECT u.id, u.email, u.role, u.full_name, u.is_active, u.pin, o.slug AS org_slug
  INTO v_user
  FROM users u
  LEFT JOIN organizations o ON u.org_id = o.id
  WHERE u.email = p_email;

  -- User not found or wrong PIN — generic error to avoid email enumeration
  IF v_user.id IS NULL OR v_user.pin IS NULL OR v_user.pin <> p_pin THEN
    RETURN json_build_object('success', false, 'error', 'Invalid email or PIN');
  END IF;

  -- Inactive user
  IF NOT v_user.is_active THEN
    RETURN json_build_object('success', false, 'error', 'Account is deactivated');
  END IF;

  -- Optional org scoping
  IF p_org_slug IS NOT NULL AND v_user.org_slug IS DISTINCT FROM p_org_slug THEN
    RETURN json_build_object('success', false, 'error', 'User does not belong to this organization');
  END IF;

  RETURN json_build_object(
    'success', true,
    'user_id', v_user.id,
    'email',   v_user.email,
    'role',    v_user.role,
    'full_name', v_user.full_name
  );
END;
$$;


--
-- Name: membership_recompute(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.membership_recompute() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_total      numeric(12,2);
  v_balance    numeric(12,2);
  v_threshold  numeric(12,2);
  v_validity   int;
  v_activation date;
  v_already    boolean;
BEGIN
  PERFORM 1 FROM public.memberships WHERE id = NEW.membership_id FOR UPDATE;

  SELECT t.advance_amount, t.validity_days, m.activation_date IS NOT NULL
    INTO v_threshold, v_validity, v_already
  FROM public.memberships m
  JOIN public.membership_tiers t ON t.id = m.tier_id
  WHERE m.id = NEW.membership_id;

  SELECT COALESCE(SUM(amount) FILTER (WHERE kind = 'deposit'), 0),
         COALESCE(SUM(amount), 0)
    INTO v_total, v_balance
  FROM public.membership_transactions
  WHERE membership_id = NEW.membership_id;

  IF v_already OR v_total < v_threshold THEN
    UPDATE public.memberships
       SET total_deposited = v_total,
           balance         = v_balance
     WHERE id = NEW.membership_id;
  ELSE
    v_activation := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
    UPDATE public.memberships
       SET total_deposited = v_total,
           balance         = v_balance,
           activation_date = v_activation,
           expiry_date     = v_activation + (v_validity || ' days')::interval
     WHERE id = NEW.membership_id;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: notify_left_behind_bookings(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_left_behind_bookings() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_target_date date := ((now() AT TIME ZONE 'Asia/Kathmandu')::date + 1);
  v_count int := 0;
BEGIN
  WITH left_behind AS (
    SELECT DISTINCT
      b.id            AS booking_id,
      b.branch_id     AS branch_id,
      b.booking_number,
      t.name          AS staff_name
    FROM public.bookings b
    JOIN LATERAL (
      SELECT b.therapist_id AS therapist_id WHERE b.therapist_id IS NOT NULL
      UNION
      SELECT bt.therapist_id FROM public.booking_therapists bt WHERE bt.booking_id = b.id
    ) a ON true
    JOIN public.therapists t ON t.id = a.therapist_id
    WHERE b.date = v_target_date
      AND b.status NOT IN ('Cancelled', 'Completed', 'No Show')
      AND t.branch_id <> b.branch_id
      AND EXISTS (
        SELECT 1 FROM public.staff_transfers st
        WHERE st.therapist_id = t.id
          AND st.from_branch_id = b.branch_id
      )
  ),
  recipients AS (
    SELECT lb.booking_id, lb.branch_id, lb.booking_number, lb.staff_name, u.id AS user_id
    FROM left_behind lb
    JOIN public.users u ON u.branch_id = lb.branch_id
  )
  INSERT INTO public.notifications (user_id, type, title, body, booking_id)
  SELECT
    r.user_id,
    'transferred_staff_reminder',
    'Transferred staff booking tomorrow',
    r.staff_name || ' has transferred to another branch but is still assigned to booking '
      || r.booking_number || ' here tomorrow. Please reassign or follow up.',
    r.booking_id
  FROM recipients r
  WHERE NOT EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.user_id = r.user_id
      AND n.booking_id = r.booking_id
      AND n.type = 'transferred_staff_reminder'
  );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;


--
-- Name: record_membership_payment(uuid, numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_membership_payment(p_booking_id uuid, p_amount numeric, p_notes text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_caller_org    uuid := get_user_org_id();
  v_actor         uuid := auth.uid();
  v_customer_id   uuid;
  v_booking_org   uuid;
  v_membership_id uuid;
  v_balance       numeric(12,2);
  v_payment_id    uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'record_membership_payment: must be signed in';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'record_membership_payment: amount must be positive';
  END IF;

  -- Resolve the booking → customer → org. Walk-ins (NULL customer_id) cannot
  -- use a wallet because there's nothing to bill against.
  SELECT b.customer_id, br.org_id
    INTO v_customer_id, v_booking_org
  FROM public.bookings b
  JOIN public.branches br ON br.id = b.branch_id
  WHERE b.id = p_booking_id;

  IF v_booking_org IS NULL THEN
    RAISE EXCEPTION 'record_membership_payment: booking % not found', p_booking_id;
  END IF;

  IF v_booking_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'record_membership_payment: booking is not in your organization';
  END IF;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'record_membership_payment: booking has no linked customer (walk-in cannot use a wallet)';
  END IF;

  -- Find the most recent membership for this customer in the org and lock it.
  -- (One non-depleted membership per customer is enforced by the partial unique
  -- index in migration-045, so this is unambiguous in practice.)
  SELECT id, balance
    INTO v_membership_id, v_balance
  FROM public.memberships
  WHERE org_id = v_caller_org AND customer_id = v_customer_id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_membership_id IS NULL THEN
    RAISE EXCEPTION 'record_membership_payment: customer has no membership';
  END IF;

  IF v_balance < p_amount THEN
    RAISE EXCEPTION 'record_membership_payment: insufficient wallet balance (have %, need %)',
      v_balance, p_amount;
  END IF;

  -- Atomic pair: payments INSERT first so we can link the deduction back to it.
  INSERT INTO public.payments (booking_id, amount, payment_mode, recorded_by, notes)
  VALUES (p_booking_id, p_amount, 'Membership', v_actor, p_notes)
  RETURNING id INTO v_payment_id;

  INSERT INTO public.membership_transactions
    (membership_id, org_id, kind, amount, payment_mode, booking_id, payment_id, performed_by, notes)
  VALUES
    (v_membership_id, v_caller_org, 'deduction', -p_amount, NULL, p_booking_id, v_payment_id, v_actor,
     COALESCE(p_notes, 'Booking checkout'));

  RETURN v_payment_id;
END;
$$;


--
-- Name: record_membership_transaction(uuid, text, numeric, text, uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_membership_transaction(p_membership_id uuid, p_kind text, p_amount numeric, p_payment_mode text DEFAULT NULL::text, p_booking_id uuid DEFAULT NULL::uuid, p_payment_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_role         user_role := get_user_role();
  v_caller_org   uuid      := get_user_org_id();
  v_mem_org      uuid;
  v_balance      numeric(12,2);
  v_activation   date;
  v_expiry       date;
  v_perk_used    timestamptz;
  v_txn_id       uuid;
BEGIN
  IF p_kind NOT IN ('deposit','deduction','birthday_perk','adjustment') THEN
    RAISE EXCEPTION 'record_membership_transaction: invalid kind %', p_kind;
  END IF;

  -- Lock the membership row + load current state.
  SELECT org_id, balance, activation_date, expiry_date, birthday_perk_used_at
    INTO v_mem_org, v_balance, v_activation, v_expiry, v_perk_used
  FROM public.memberships
  WHERE id = p_membership_id
  FOR UPDATE;

  IF v_mem_org IS NULL THEN
    RAISE EXCEPTION 'record_membership_transaction: membership % not found', p_membership_id;
  END IF;

  IF v_mem_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'record_membership_transaction: membership is not in your organization';
  END IF;

  -- Per-kind authorization + sign/business-rule checks.
  IF p_kind IN ('deposit','deduction','birthday_perk') THEN
    IF v_role NOT IN ('manager','admin') THEN
      RAISE EXCEPTION 'record_membership_transaction: manager or admin role required';
    END IF;
  ELSIF p_kind = 'adjustment' THEN
    IF v_role <> 'admin' THEN
      RAISE EXCEPTION 'record_membership_transaction: adjustments are admin-only';
    END IF;
    IF p_notes IS NULL OR length(btrim(p_notes)) = 0 THEN
      RAISE EXCEPTION 'record_membership_transaction: adjustment requires a note';
    END IF;
  END IF;

  IF p_kind = 'deposit' AND p_amount <= 0 THEN
    RAISE EXCEPTION 'record_membership_transaction: deposit amount must be positive';
  END IF;

  IF p_kind = 'deduction' THEN
    IF p_amount >= 0 THEN
      RAISE EXCEPTION 'record_membership_transaction: deduction amount must be negative';
    END IF;
    IF abs(p_amount) > v_balance THEN
      RAISE EXCEPTION 'record_membership_transaction: insufficient balance (have %, need %)',
        v_balance, abs(p_amount);
    END IF;
  END IF;

  IF p_kind = 'birthday_perk' THEN
    IF p_amount <> 0 THEN
      RAISE EXCEPTION 'record_membership_transaction: birthday_perk amount must be 0';
    END IF;
    IF v_activation IS NULL THEN
      RAISE EXCEPTION 'record_membership_transaction: birthday perk requires an active membership';
    END IF;
    IF v_perk_used IS NOT NULL
       AND v_perk_used::date >= v_activation
       AND v_perk_used::date <= COALESCE(v_expiry, v_activation) THEN
      RAISE EXCEPTION 'record_membership_transaction: birthday perk already used in current cycle';
    END IF;
  END IF;

  -- Append the ledger row.
  INSERT INTO public.membership_transactions
    (membership_id, org_id, kind, amount, payment_mode, booking_id, payment_id, performed_by, notes)
  VALUES
    (p_membership_id, v_mem_org, p_kind, p_amount, p_payment_mode, p_booking_id, p_payment_id, auth.uid(), p_notes)
  RETURNING id INTO v_txn_id;

  -- Birthday perk side-effect: stamp the membership so we can block another in
  -- the same cycle. (The trigger handles balance/total_deposited/activation.)
  IF p_kind = 'birthday_perk' THEN
    UPDATE public.memberships
       SET birthday_perk_used_at = now()
     WHERE id = p_membership_id;
  END IF;

  RETURN v_txn_id;
END;
$$;


--
-- Name: renew_membership(uuid, numeric, text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.renew_membership(p_membership_id uuid, p_amount numeric, p_payment_mode text, p_tier_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_role         user_role := get_user_role();
  v_caller_org   uuid      := get_user_org_id();
  v_mem_org      uuid;
  v_current_tier uuid;
  v_final_tier   uuid;
  v_tier_org     uuid;
  v_validity     int;
  v_activation   date;
  v_balance      numeric(12,2);
  v_txn_id       uuid;
BEGIN
  IF v_role NOT IN ('manager','admin') THEN
    RAISE EXCEPTION 'renew_membership: manager or admin role required';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'renew_membership: amount must be positive';
  END IF;

  -- Lock the membership row + load current state.
  SELECT org_id, tier_id, balance
    INTO v_mem_org, v_current_tier, v_balance
  FROM public.memberships
  WHERE id = p_membership_id
  FOR UPDATE;

  IF v_mem_org IS NULL THEN
    RAISE EXCEPTION 'renew_membership: membership % not found', p_membership_id;
  END IF;

  IF v_mem_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'renew_membership: membership is not in your organization';
  END IF;

  -- Optional tier change.
  v_final_tier := COALESCE(p_tier_id, v_current_tier);
  IF p_tier_id IS NOT NULL AND p_tier_id IS DISTINCT FROM v_current_tier THEN
    SELECT org_id INTO v_tier_org FROM public.membership_tiers WHERE id = p_tier_id;
    IF v_tier_org IS NULL THEN
      RAISE EXCEPTION 'renew_membership: tier % not found', p_tier_id;
    END IF;
    IF v_tier_org IS DISTINCT FROM v_caller_org THEN
      RAISE EXCEPTION 'renew_membership: tier must be in your organization';
    END IF;
    UPDATE public.memberships SET tier_id = p_tier_id WHERE id = p_membership_id;
  END IF;

  SELECT validity_days INTO v_validity FROM public.membership_tiers WHERE id = v_final_tier;

  -- Forfeit any balance left over from the expired cycle -- renewal starts a
  -- fresh cycle, so old unspent money is written off (visible in history as
  -- an adjustment row, not dropped).
  IF v_balance <> 0 THEN
    INSERT INTO public.membership_transactions
      (membership_id, org_id, kind, amount, performed_by, notes)
    VALUES
      (p_membership_id, v_mem_org, 'adjustment', -v_balance, auth.uid(),
       'Previous cycle balance forfeited on renewal.');
  END IF;

  -- Record the deposit (trigger recomputes total_deposited/balance; won't
  -- touch activation_date/expiry_date since they're already set).
  v_txn_id := public.record_membership_transaction(
    p_membership_id, 'deposit', p_amount, p_payment_mode, NULL, NULL,
    COALESCE(p_notes, 'Renewal deposit')
  );

  -- Start a fresh cycle on this same row.
  v_activation := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  UPDATE public.memberships
     SET activation_date = v_activation,
         expiry_date     = v_activation + (v_validity || ' days')::interval
   WHERE id = p_membership_id;

  RETURN v_txn_id;
END;
$$;


--
-- Name: set_membership_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_membership_number() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_prefix text;
  v_seq    int;
BEGIN
  IF NEW.membership_number IS NOT NULL AND length(NEW.membership_number) > 0 THEN
    RETURN NEW;  -- caller supplied one (backfill / migration) — trust it
  END IF;

  SELECT code_prefix INTO v_prefix
  FROM public.membership_tiers
  WHERE id = NEW.tier_id;

  IF v_prefix IS NULL OR length(v_prefix) = 0 THEN
    RAISE EXCEPTION 'set_membership_number: tier % has no code_prefix', NEW.tier_id;
  END IF;

  SELECT COALESCE(count(*), 0) + 1 INTO v_seq
  FROM public.memberships
  WHERE org_id = NEW.org_id AND tier_id = NEW.tier_id;

  NEW.membership_number := v_prefix || '-' || lpad(v_seq::text, 4, '0');
  RETURN NEW;
END;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: transfer_therapist(uuid, uuid, text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.transfer_therapist(p_therapist_id uuid, p_to_branch_id uuid, p_note text DEFAULT NULL::text, p_effective_date date DEFAULT NULL::date) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_role          user_role;
  v_caller_org    uuid;
  v_caller_branch uuid;
  v_from_branch   uuid;
  v_therapist_org uuid;
  v_to_branch_org uuid;
  v_new_order     int;
  v_transfer_id   uuid;
  v_today         date;
  v_effective     date;
  v_immediate     boolean;
BEGIN
  v_role          := get_user_role();
  v_caller_org    := get_user_org_id();
  v_caller_branch := get_user_branch_id();
  v_today         := (now() AT TIME ZONE 'Asia/Kathmandu')::date;
  v_effective     := COALESCE(p_effective_date, v_today);

  SELECT branch_id, org_id INTO v_from_branch, v_therapist_org
  FROM public.therapists
  WHERE id = p_therapist_id;

  IF v_from_branch IS NULL THEN
    RAISE EXCEPTION 'transfer_therapist: therapist % not found', p_therapist_id;
  END IF;

  IF v_therapist_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'transfer_therapist: therapist is not in your organization';
  END IF;

  SELECT org_id INTO v_to_branch_org
  FROM public.branches
  WHERE id = p_to_branch_id;

  IF v_to_branch_org IS NULL THEN
    RAISE EXCEPTION 'transfer_therapist: destination branch % not found', p_to_branch_id;
  END IF;

  IF v_to_branch_org IS DISTINCT FROM v_caller_org THEN
    RAISE EXCEPTION 'transfer_therapist: destination branch is not in your organization';
  END IF;

  IF p_to_branch_id = v_from_branch THEN
    RAISE EXCEPTION 'transfer_therapist: staffer is already at that branch';
  END IF;

  IF NOT (
    v_role = 'admin'
    OR (v_role = 'manager' AND v_from_branch = v_caller_branch)
  ) THEN
    RAISE EXCEPTION 'transfer_therapist: only an admin or the current branch''s manager may transfer this staffer';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.staff_transfers
    WHERE therapist_id = p_therapist_id AND applied = false
  ) THEN
    RAISE EXCEPTION 'transfer_therapist: a scheduled transfer already exists for this staffer; cancel it first';
  END IF;

  v_immediate := v_effective <= v_today;

  IF v_immediate THEN
    SELECT COALESCE(max(display_order), -1) + 1 INTO v_new_order
    FROM public.therapists
    WHERE branch_id = p_to_branch_id;

    UPDATE public.therapists
       SET branch_id = p_to_branch_id,
           display_order = v_new_order
     WHERE id = p_therapist_id;

    -- migration-048: keep the staff user's login branch in sync (staff role only).
    PERFORM public._sync_user_branch_for_transfer(p_therapist_id, v_caller_org, p_to_branch_id);
  END IF;

  INSERT INTO public.staff_transfers
    (therapist_id, org_id, from_branch_id, to_branch_id, transferred_by, note, effective_date, applied)
  VALUES
    (p_therapist_id, v_caller_org, v_from_branch, p_to_branch_id, auth.uid(), p_note, v_effective, v_immediate)
  RETURNING id INTO v_transfer_id;

  RETURN v_transfer_id;
END;
$$;


--
-- Name: update_booking_payment_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_booking_payment_status() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_paid  numeric;
  v_final numeric;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM public.payments WHERE booking_id = NEW.booking_id;

  SELECT final_amount INTO v_final
  FROM public.bookings WHERE id = NEW.booking_id;

  UPDATE public.bookings
  SET payment_status = CASE
        WHEN v_paid >= v_final THEN 'paid'
        WHEN v_paid > 0        THEN 'partial'
        ELSE 'unpaid'
      END
  WHERE id = NEW.booking_id;

  RETURN NEW;
END;
$$;


--
-- Name: update_org_payment_methods(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_org_payment_methods(p_methods jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  DECLARE
    v_org_id  uuid := get_user_org_id();
    v_role    text := get_user_role();
    v_settings jsonb;
  BEGIN
    IF v_role IS DISTINCT FROM 'admin' THEN
      RAISE EXCEPTION 'update_org_payment_methods: admin only';
    END IF;

    IF v_org_id IS NULL THEN
      RAISE EXCEPTION 'update_org_payment_methods: no organization context';
    END IF;

    IF jsonb_typeof(p_methods) IS DISTINCT FROM 'array' OR jsonb_array_length(p_methods) = 0 THEN
      RAISE EXCEPTION 'update_org_payment_methods: p_methods must be a non-empty array';
    END IF;

    UPDATE public.organizations
    SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{paymentMethods}', p_methods, true)
    WHERE id = v_org_id
    RETURNING settings INTO v_settings;

    IF v_settings IS NULL THEN                       
      RAISE EXCEPTION 'update_org_payment_methods: organization % not found', v_org_id;
    END IF;

    RETURN v_settings;
  END;
  $$;


--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


--
-- Name: verify_pin(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.verify_pin(p_email text, p_pin text, p_org_slug text DEFAULT NULL::text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user record;
BEGIN
  SELECT u.*, o.slug as org_slug
  INTO v_user
  FROM users u
  LEFT JOIN organizations o ON u.org_id = o.id
  WHERE u.email = p_email AND u.pin = p_pin AND u.is_active = true;

  IF v_user IS NULL THEN
    RETURN json_build_object('valid', false, 'error', 'Invalid email or PIN');
  END IF;

  IF p_org_slug IS NOT NULL AND v_user.org_slug != p_org_slug THEN
    RETURN json_build_object('valid', false, 'error', 'User does not belong to this organization');
  END IF;

  RETURN json_build_object(
    'valid', true,
    'user_id', v_user.id,
    'email', v_user.email,
    'role', v_user.role,
    'full_name', v_user.full_name
  );
END;
$$;


--
-- Name: apply_rls(jsonb, integer); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer DEFAULT (1024 * 1024)) RETURNS SETOF realtime.wal_rls
    LANGUAGE plpgsql
    AS $$
declare
    -- Regclass of the table e.g. public.notes
    entity_ regclass = (quote_ident(wal ->> 'schema') || '.' || quote_ident(wal ->> 'table'))::regclass;

    -- I, U, D, T: insert, update ...
    action realtime.action = (
        case wal ->> 'action'
            when 'I' then 'INSERT'
            when 'U' then 'UPDATE'
            when 'D' then 'DELETE'
            else 'ERROR'
        end
    );

    -- Is row level security enabled for the table
    is_rls_enabled bool = relrowsecurity from pg_class where oid = entity_;

    subscriptions realtime.subscription[] = array_agg(subs)
        from
            realtime.subscription subs
        where
            subs.entity = entity_
            -- Filter by action early - only get subscriptions interested in this action
            -- action_filter column can be: '*' (all), 'INSERT', 'UPDATE', or 'DELETE'
            and (subs.action_filter = '*' or subs.action_filter = action::text);

    -- Subscription vars
    working_role regrole;
    working_selected_columns text[];
    claimed_role regrole;
    claims jsonb;

    subscription_id uuid;
    subscription_has_access bool;
    visible_to_subscription_ids uuid[] = '{}';

    -- structured info for wal's columns
    columns realtime.wal_column[];
    -- previous identity values for update/delete
    old_columns realtime.wal_column[];

    error_record_exceeds_max_size boolean = octet_length(wal::text) > max_record_bytes;

    -- Primary jsonb output for record
    output jsonb;

    -- Loop record for iterating unique roles (outer loop)
    role_record record;
    -- Loop record for iterating unique selected_columns within a role (inner loop)
    cols_record record;
    -- Subscription ids visible at the role level (before fanning out by selected_columns)
    visible_role_sub_ids uuid[] = '{}';

begin
    perform set_config('role', null, true);

    columns =
        array_agg(
            (
                x->>'name',
                x->>'type',
                x->>'typeoid',
                realtime.cast(
                    (x->'value') #>> '{}',
                    coalesce(
                        (x->>'typeoid')::regtype, -- null when wal2json version <= 2.4
                        (x->>'type')::regtype
                    )
                ),
                (pks ->> 'name') is not null,
                true
            )::realtime.wal_column
        )
        from
            jsonb_array_elements(wal -> 'columns') x
            left join jsonb_array_elements(wal -> 'pk') pks
                on (x ->> 'name') = (pks ->> 'name');

    old_columns =
        array_agg(
            (
                x->>'name',
                x->>'type',
                x->>'typeoid',
                realtime.cast(
                    (x->'value') #>> '{}',
                    coalesce(
                        (x->>'typeoid')::regtype, -- null when wal2json version <= 2.4
                        (x->>'type')::regtype
                    )
                ),
                (pks ->> 'name') is not null,
                true
            )::realtime.wal_column
        )
        from
            jsonb_array_elements(wal -> 'identity') x
            left join jsonb_array_elements(wal -> 'pk') pks
                on (x ->> 'name') = (pks ->> 'name');

    for role_record in
        select claims_role
        from (select distinct claims_role from unnest(subscriptions)) t
        order by claims_role::text
    loop
        working_role := role_record.claims_role;

        -- Update `is_selectable` for columns and old_columns (once per role)
        columns =
            array_agg(
                (
                    c.name,
                    c.type_name,
                    c.type_oid,
                    c.value,
                    c.is_pkey,
                    pg_catalog.has_column_privilege(working_role, entity_, c.name, 'SELECT')
                )::realtime.wal_column
            )
            from
                unnest(columns) c;

        old_columns =
                array_agg(
                    (
                        c.name,
                        c.type_name,
                        c.type_oid,
                        c.value,
                        c.is_pkey,
                        pg_catalog.has_column_privilege(working_role, entity_, c.name, 'SELECT')
                    )::realtime.wal_column
                )
                from
                    unnest(old_columns) c;

        if action <> 'DELETE' and count(1) = 0 from unnest(columns) c where c.is_pkey then
            -- Fan out 400 error per distinct selected_columns for this role
            for cols_record in
                select selected_columns
                from (select distinct selected_columns from unnest(subscriptions) s where s.claims_role = working_role) t
                order by coalesce(array_to_string(selected_columns, ','), '')
            loop
                working_selected_columns := cols_record.selected_columns;
                return next (
                    jsonb_build_object(
                        'schema', wal ->> 'schema',
                        'table', wal ->> 'table',
                        'type', action
                    ),
                    is_rls_enabled,
                    (select array_agg(s.subscription_id) from unnest(subscriptions) as s where s.claims_role = working_role and (s.selected_columns is not distinct from working_selected_columns)),
                    array['Error 400: Bad Request, no primary key']
                )::realtime.wal_rls;
            end loop;

        -- The claims role does not have SELECT permission to the primary key of entity
        elsif action <> 'DELETE' and sum(c.is_selectable::int) <> count(1) from unnest(columns) c where c.is_pkey then
            -- Fan out 401 error per distinct selected_columns for this role
            for cols_record in
                select selected_columns
                from (select distinct selected_columns from unnest(subscriptions) s where s.claims_role = working_role) t
                order by coalesce(array_to_string(selected_columns, ','), '')
            loop
                working_selected_columns := cols_record.selected_columns;
                return next (
                    jsonb_build_object(
                        'schema', wal ->> 'schema',
                        'table', wal ->> 'table',
                        'type', action
                    ),
                    is_rls_enabled,
                    (select array_agg(s.subscription_id) from unnest(subscriptions) as s where s.claims_role = working_role and (s.selected_columns is not distinct from working_selected_columns)),
                    array['Error 401: Unauthorized']
                )::realtime.wal_rls;
            end loop;

        else
            -- Create the prepared statement (once per role)
            if is_rls_enabled and action <> 'DELETE' then
                if (select 1 from pg_prepared_statements where name = 'walrus_rls_stmt' limit 1) > 0 then
                    deallocate walrus_rls_stmt;
                end if;
                execute realtime.build_prepared_statement_sql('walrus_rls_stmt', entity_, columns);
            end if;

            -- Collect all visible subscription IDs for this role (filter check + RLS check)
            visible_role_sub_ids = '{}';

            for subscription_id, claims in (
                    select
                        subs.subscription_id,
                        subs.claims
                    from
                        unnest(subscriptions) subs
                    where
                        subs.entity = entity_
                        and subs.claims_role = working_role
                        and (
                            realtime.is_visible_through_filters(columns, subs.filters)
                            or (
                              action = 'DELETE'
                              and realtime.is_visible_through_filters(old_columns, subs.filters)
                            )
                        )
            ) loop

                if not is_rls_enabled or action = 'DELETE' then
                    visible_role_sub_ids = visible_role_sub_ids || subscription_id;
                else
                    -- Check if RLS allows the role to see the record
                    perform
                        -- Trim leading and trailing quotes from working_role because set_config
                        -- doesn't recognize the role as valid if they are included
                        set_config('role', trim(both '"' from working_role::text), true),
                        set_config('request.jwt.claims', claims::text, true);

                    execute 'execute walrus_rls_stmt' into subscription_has_access;

                    -- Reset the role on every FOR..LOOP batch execution.
                    -- The first batch of 10 rows is pre-fetched using the current connection role (PG internal behaviour)
                    -- then we have to reset it again otherwise it would use the role defined in the `set_config` above
                    -- to fetch the remaining rows when rows>10, which could be a user-defined role that lacks execution grants.
                    -- The flow is:
                    --   1. run batch with conn role
                    --   2. set_config working_role
                    --   3. execute walrus
                    --   4. reset role (revert)
                    --   5. repeat
                    perform set_config('role', null, true);

                    if subscription_has_access then
                        visible_role_sub_ids = visible_role_sub_ids || subscription_id;
                    end if;
                end if;
            end loop;

            perform set_config('role', null, true);

            -- Inner loop: per distinct selected_columns for this role
            for cols_record in
                select selected_columns
                from (select distinct selected_columns from unnest(subscriptions) s where s.claims_role = working_role) t
                order by coalesce(array_to_string(selected_columns, ','), '')
            loop
                working_selected_columns := cols_record.selected_columns;

                output = jsonb_build_object(
                    'schema', wal ->> 'schema',
                    'table', wal ->> 'table',
                    'type', action,
                    'commit_timestamp', to_char(
                        ((wal ->> 'timestamp')::timestamptz at time zone 'utc'),
                        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                    ),
                    'columns', (
                        select
                            jsonb_agg(
                                jsonb_build_object(
                                    'name', pa.attname,
                                    'type', pt.typname
                                )
                                order by pa.attnum asc
                            )
                        from
                            pg_attribute pa
                            join pg_type pt
                                on pa.atttypid = pt.oid
                            left join (
                                select unnest(conkey) as pkey_attnum
                                from pg_constraint
                                where conrelid = entity_ and contype = 'p'
                            ) pk on pk.pkey_attnum = pa.attnum
                        where
                            attrelid = entity_
                            and attnum > 0
                            and pg_catalog.has_column_privilege(working_role, entity_, pa.attname, 'SELECT')
                            and (working_selected_columns is null or pa.attname = any(working_selected_columns) or pk.pkey_attnum is not null)
                    )
                )
                -- Add "record" key for insert and update
                || case
                    when action in ('INSERT', 'UPDATE') then
                        jsonb_build_object(
                            'record',
                            (
                                select
                                    jsonb_object_agg(
                                        -- if unchanged toast, get column name and value from old record
                                        coalesce((c).name, (oc).name),
                                        case
                                            when (c).name is null then (oc).value
                                            else (c).value
                                        end
                                    )
                                from
                                    unnest(columns) c
                                    full outer join unnest(old_columns) oc
                                        on (c).name = (oc).name
                                where
                                    coalesce((c).is_selectable, (oc).is_selectable)
                                    and (working_selected_columns is null or coalesce((c).name, (oc).name) = any(working_selected_columns) or coalesce((c).is_pkey, (oc).is_pkey))
                                    and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                            )
                        )
                    else '{}'::jsonb
                end
                -- Add "old_record" key for update and delete
                || case
                    when action = 'UPDATE' then
                        jsonb_build_object(
                                'old_record',
                                (
                                    select jsonb_object_agg((c).name, (c).value)
                                    from unnest(old_columns) c
                                    where
                                        (c).is_selectable
                                        and (working_selected_columns is null or (c).name = any(working_selected_columns) or (c).is_pkey)
                                        and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                                )
                            )
                    when action = 'DELETE' then
                        jsonb_build_object(
                            'old_record',
                            (
                                select jsonb_object_agg((c).name, (c).value)
                                from unnest(old_columns) c
                                where
                                    (c).is_selectable
                                    and (working_selected_columns is null or (c).name = any(working_selected_columns) or (c).is_pkey)
                                    and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                                    and ( not is_rls_enabled or (c).is_pkey ) -- if RLS enabled, we can't secure deletes so filter to pkey
                            )
                        )
                    else '{}'::jsonb
                end;

                -- Filter visible_role_sub_ids to those matching the current selected_columns group
                visible_to_subscription_ids = coalesce(
                    (
                        select array_agg(s.subscription_id)
                        from unnest(subscriptions) s
                        where s.claims_role = working_role
                          and (s.selected_columns is not distinct from working_selected_columns)
                          and s.subscription_id = any(visible_role_sub_ids)
                    ),
                    '{}'::uuid[]
                );

                return next (
                    output,
                    is_rls_enabled,
                    visible_to_subscription_ids,
                    case
                        when error_record_exceeds_max_size then array['Error 413: Payload Too Large']
                        else '{}'
                    end
                )::realtime.wal_rls;
            end loop;

        end if;
    end loop;

    perform set_config('role', null, true);
end;
$$;


--
-- Name: broadcast_changes(text, text, text, text, text, record, record, text); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.broadcast_changes(topic_name text, event_name text, operation text, table_name text, table_schema text, new record, old record, level text DEFAULT 'ROW'::text) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
    -- Declare a variable to hold the JSONB representation of the row
    row_data jsonb := '{}'::jsonb;
BEGIN
    IF level = 'STATEMENT' THEN
        RAISE EXCEPTION 'function can only be triggered for each row, not for each statement';
    END IF;
    -- Check the operation type and handle accordingly
    IF operation = 'INSERT' OR operation = 'UPDATE' OR operation = 'DELETE' THEN
        row_data := jsonb_build_object('old_record', OLD, 'record', NEW, 'operation', operation, 'table', table_name, 'schema', table_schema);
        PERFORM realtime.send (row_data, event_name, topic_name);
    ELSE
        RAISE EXCEPTION 'Unexpected operation type: %', operation;
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Failed to process the row: %', SQLERRM;
END;

$$;


--
-- Name: build_prepared_statement_sql(text, regclass, realtime.wal_column[]); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) RETURNS text
    LANGUAGE sql
    AS $$
      /*
      Builds a sql string that, if executed, creates a prepared statement to
      tests retrive a row from *entity* by its primary key columns.
      Example
          select realtime.build_prepared_statement_sql('public.notes', '{"id"}'::text[], '{"bigint"}'::text[])
      */
          select
      'prepare ' || prepared_statement_name || ' as
          select
              exists(
                  select
                      1
                  from
                      ' || entity || '
                  where
                      ' || string_agg(quote_ident(pkc.name) || '=' || quote_nullable(pkc.value #>> '{}') , ' and ') || '
              )'
          from
              unnest(columns) pkc
          where
              pkc.is_pkey
          group by
              entity
      $$;


--
-- Name: cast(text, regtype); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime."cast"(val text, type_ regtype) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    AS $$
declare
  res jsonb;
begin
  if type_::text = 'bytea' then
    return to_jsonb(val);
  end if;
  execute format('select to_jsonb(%L::'|| type_::text || ')', val) into res;
  return res;
end
$$;


--
-- Name: check_equality_op(realtime.equality_op, regtype, text, text); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
/*
Casts *val_1* and *val_2* as type *type_* and check the *op* condition for truthiness
*/
declare
    op_symbol text = (
        case
            when op = 'eq' then '='
            when op = 'neq' then '!='
            when op = 'lt' then '<'
            when op = 'lte' then '<='
            when op = 'gt' then '>'
            when op = 'gte' then '>='
            when op = 'in' then '= any'
            else 'UNKNOWN OP'
        end
    );
    res boolean;
begin
    execute format(
        'select %L::'|| type_::text || ' ' || op_symbol
        || ' ( %L::'
        || (
            case
                when op = 'in' then type_::text || '[]'
                else type_::text end
        )
        || ')', val_1, val_2) into res;
    return res;
end;
$$;


--
-- Name: check_equality_op(realtime.equality_op, regtype, text, text, boolean); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text, negate boolean) RETURNS boolean
    LANGUAGE plpgsql STABLE
    AS $$
declare
    op_symbol text;
    res boolean;
begin
    -- IS DISTINCT FROM / IS NOT DISTINCT FROM: infix, both sides typed literals
    if op = 'isdistinct' then
        execute format(
            'select %L::%s %s %L::%s',
            val_1,
            type_::text,
            case when negate then 'IS NOT DISTINCT FROM' else 'IS DISTINCT FROM' end,
            val_2,
            type_::text
        ) into res;
        return res;
    end if;

    -- IS requires a keyword RHS (NULL, TRUE, FALSE, UNKNOWN), not a typed literal
    if op = 'is' then
        if val_2 not in ('null', 'true', 'false', 'unknown') then
            raise exception 'invalid value for is filter: must be null, true, false, or unknown';
        end if;
        execute format(
            'select %L::%s %s %s',
            val_1,
            type_::text,
            case when negate then 'IS NOT' else 'IS' end,
            upper(val_2)
        ) into res;
        return res;
    end if;

    op_symbol = case
        when op = 'eq'    then '='
        when op = 'neq'   then '!='
        when op = 'lt'    then '<'
        when op = 'lte'   then '<='
        when op = 'gt'    then '>'
        when op = 'gte'   then '>='
        when op = 'in'    then '= any'
        when op = 'like'   then 'LIKE'
        when op = 'ilike'  then 'ILIKE'
        when op = 'match'  then '~'
        when op = 'imatch' then '~*'
        else null
    end;

    if op_symbol is null then
        raise exception 'unsupported equality operator: %', op::text;
    end if;

    execute format(
        'select %L::%s %s (%L::%s)',
        val_1,
        type_::text,
        op_symbol,
        val_2,
        case when op = 'in' then type_::text || '[]' else type_::text end
    ) into res;

    return case when negate then not res else res end;
end;
$$;


--
-- Name: is_visible_through_filters(realtime.wal_column[], realtime.user_defined_filter[]); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
    select
        filters is null
        or array_length(filters, 1) is null
        or coalesce(
            count(col.name) = count(1)
            and sum(
                realtime.check_equality_op(
                    op:=f.op,
                    type_:=coalesce(col.type_oid::regtype, col.type_name::regtype),
                    val_1:=col.value #>> '{}',
                    val_2:=f.value,
                    negate:=coalesce(f.negate, false)
                )::int
            ) filter (where col.name is not null) = count(col.name),
            false
        )
    from
        unnest(filters) f
        left join unnest(columns) col
            on f.column_name = col.name;
$$;


--
-- Name: list_changes(name, name, integer, integer); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer) RETURNS TABLE(wal jsonb, is_rls_enabled boolean, subscription_ids uuid[], errors text[], slot_changes_count bigint)
    LANGUAGE sql
    SET log_min_messages TO 'fatal'
    AS $$
  WITH pub AS (
    SELECT
      concat_ws(
        ',',
        CASE WHEN bool_or(pubinsert) THEN 'insert' ELSE NULL END,
        CASE WHEN bool_or(pubupdate) THEN 'update' ELSE NULL END,
        CASE WHEN bool_or(pubdelete) THEN 'delete' ELSE NULL END
      ) AS w2j_actions,
      coalesce(
        string_agg(
          realtime.quote_wal2json(format('%I.%I', schemaname, tablename)::regclass),
          ','
        ) filter (WHERE ppt.tablename IS NOT NULL),
        ''
      ) AS w2j_add_tables
    FROM pg_publication pp
    LEFT JOIN pg_publication_tables ppt ON pp.pubname = ppt.pubname
    WHERE pp.pubname = publication
    GROUP BY pp.pubname
    LIMIT 1
  ),
  -- MATERIALIZED ensures pg_logical_slot_get_changes is called exactly once
  w2j AS MATERIALIZED (
    SELECT x.*, pub.w2j_add_tables
    FROM pub,
         pg_logical_slot_get_changes(
           slot_name, null, max_changes,
           'include-pk', 'true',
           'include-transaction', 'false',
           'include-timestamp', 'true',
           'include-type-oids', 'true',
           'format-version', '2',
           'actions', pub.w2j_actions,
           'add-tables', pub.w2j_add_tables
         ) x
  ),
  slot_count AS (
    SELECT count(*)::bigint AS cnt
    FROM w2j
    WHERE w2j.w2j_add_tables <> ''
  ),
  rls_filtered AS (
    SELECT xyz.wal, xyz.is_rls_enabled, xyz.subscription_ids, xyz.errors
    FROM w2j,
         realtime.apply_rls(
           wal := w2j.data::jsonb,
           max_record_bytes := max_record_bytes
         ) xyz(wal, is_rls_enabled, subscription_ids, errors)
    WHERE w2j.w2j_add_tables <> ''
      AND xyz.subscription_ids[1] IS NOT NULL
  )
  SELECT rf.wal, rf.is_rls_enabled, rf.subscription_ids, rf.errors, sc.cnt
  FROM rls_filtered rf, slot_count sc

  UNION ALL

  SELECT null, null, null, null, sc.cnt
  FROM slot_count sc
  WHERE NOT EXISTS (SELECT 1 FROM rls_filtered)
$$;


--
-- Name: quote_wal2json(regclass); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.quote_wal2json(entity regclass) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
  SELECT
    realtime.wal2json_escape_identifier(nsp.nspname::text)
    || '.'
    || realtime.wal2json_escape_identifier(pc.relname::text)
  FROM pg_class pc
  JOIN pg_namespace nsp ON pc.relnamespace = nsp.oid
  WHERE pc.oid = entity
$$;


--
-- Name: send(jsonb, text, text, boolean); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  generated_id uuid;
  final_payload jsonb;
BEGIN
  BEGIN
    generated_id := gen_random_uuid();

    -- Check if payload has an 'id' key, if not, add the generated UUID
    IF payload ? 'id' THEN
      final_payload := payload;
    ELSE
      final_payload := jsonb_set(payload, '{id}', to_jsonb(generated_id));
    END IF;

    -- Set the topic configuration
    EXECUTE format('SET LOCAL realtime.topic TO %L', topic);

    INSERT INTO realtime.messages (id, payload, event, topic, private, extension)
    VALUES (generated_id, final_payload, event, topic, private, 'broadcast');
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'WarnSendingBroadcastMessage: %', SQLERRM;
  END;
END;
$$;


--
-- Name: send_binary(bytea, text, text, boolean); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.send_binary(payload bytea, event text, topic text, private boolean DEFAULT true) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  generated_id uuid;
BEGIN
  BEGIN
    generated_id := gen_random_uuid();

    EXECUTE format('SET LOCAL realtime.topic TO %L', topic);

    INSERT INTO realtime.messages (id, binary_payload, event, topic, private, extension)
    VALUES (generated_id, payload, event, topic, private, 'broadcast');
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'WarnSendingBroadcastMessage: %', SQLERRM;
  END;
END;
$$;


--
-- Name: subscription_check_filters(); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.subscription_check_filters() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
    col_names text[] = coalesce(
            array_agg(a.attname order by a.attnum),
            '{}'::text[]
        )
        from
            pg_catalog.pg_attribute a
        where
            a.attrelid = new.entity
            and a.attnum > 0
            and not a.attisdropped
            and pg_catalog.has_column_privilege(
                (new.claims ->> 'role'),
                a.attrelid,
                a.attnum,
                'SELECT'
            );
    filter realtime.user_defined_filter;
    col_type regtype;
    in_val jsonb;
    selected_col text;
begin
    for filter in select * from unnest(new.filters) loop
        if not filter.column_name = any(col_names) then
            raise exception 'invalid column for filter %', filter.column_name;
        end if;

        col_type = (
            select atttypid::regtype
            from pg_catalog.pg_attribute
            where attrelid = new.entity
                  and attname = filter.column_name
        );
        if col_type is null then
            raise exception 'failed to lookup type for column %', filter.column_name;
        end if;

        if filter.op = 'in'::realtime.equality_op then
            in_val = realtime.cast(filter.value, (col_type::text || '[]')::regtype);
            if coalesce(jsonb_array_length(in_val), 0) > 100 then
                raise exception 'too many values for `in` filter. Maximum 100';
            end if;
        elsif filter.op = 'is'::realtime.equality_op then
            -- `is` requires a keyword RHS rather than a typed literal
            if filter.value not in ('null', 'true', 'false', 'unknown') then
                raise exception 'invalid value for is filter: must be null, true, false, or unknown';
            end if;
            -- IS NULL works for any type, but IS TRUE/FALSE/UNKNOWN require a boolean
            -- operand. Reject the non-null keywords on non-boolean columns here so they
            -- don't abort apply_rls at WAL time.
            if filter.value <> 'null' and col_type <> 'boolean'::regtype then
                raise exception 'is % filter requires a boolean column, got %', filter.value, col_type::text;
            end if;
        elsif filter.op in ('like'::realtime.equality_op, 'ilike'::realtime.equality_op) then
            -- like/ilike apply the text pattern operator (~~); reject column types that
            -- have no such operator instead of failing at WAL time
            if not exists (
                select 1 from pg_catalog.pg_operator
                where oprname = '~~' and oprleft = col_type
            ) then
                raise exception 'operator % requires a text-compatible column type, got %', filter.op::text, col_type::text;
            end if;
        elsif filter.op in ('match'::realtime.equality_op, 'imatch'::realtime.equality_op) then
            -- match/imatch apply the regex operators ~ / ~*; reject column types that have
            -- no such operator (e.g. integer) instead of failing at WAL time, mirroring the
            -- like/ilike guard above.
            if not exists (
                select 1 from pg_catalog.pg_operator
                where oprname = case when filter.op = 'imatch'::realtime.equality_op then '~*' else '~' end
                  and oprleft = col_type
                  and oprright = col_type
                  and oprresult = 'boolean'::regtype
            ) then
                raise exception 'operator % requires a text-compatible column type, got %', filter.op::text, col_type::text;
            end if;
            -- validate the regex eagerly so a bad pattern is rejected here, not inside
            -- apply_rls where it would abort the WAL stream for the entity
            begin
                perform '' ~ filter.value;
            exception when others then
                raise exception 'invalid regular expression for % filter: %', filter.op::text, sqlerrm;
            end;
        else
            -- eq/neq/lt/lte/gt/gte: value must be coercable to the type
            perform realtime.cast(filter.value, col_type);
        end if;
    end loop;

    if new.selected_columns is not null then
        for selected_col in select * from unnest(new.selected_columns) loop
            if not selected_col = any(col_names) then
                raise exception 'invalid column for select %', selected_col;
            end if;
        end loop;
    end if;

    -- Apply consistent order to filters so the unique constraint can't be tricked by a
    -- different filter order. negate is part of the sort key.
    new.filters = coalesce(
        array_agg(f order by f.column_name, f.op, f.value, f.negate),
        '{}'
    ) from unnest(new.filters) f;

    new.selected_columns = (
        select array_agg(c order by c)
        from unnest(new.selected_columns) c
    );

    return new;
end;
$$;


--
-- Name: to_regrole(text); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.to_regrole(role_name text) RETURNS regrole
    LANGUAGE sql IMMUTABLE
    AS $$ select role_name::regrole $$;


--
-- Name: topic(); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.topic() RETURNS text
    LANGUAGE sql STABLE
    AS $$
select nullif(current_setting('realtime.topic', true), '')::text;
$$;


--
-- Name: wal2json_escape_identifier(text); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.wal2json_escape_identifier(name text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
  -- Prefix `\`, `,`, `.`, and any whitespace with `\`
  SELECT regexp_replace(name, '([\\,.[:space:]])', '\\\1', 'g')
$$;


--
-- Name: allow_any_operation(text[]); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.allow_any_operation(expected_operations text[]) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  WITH current_operation AS (
    SELECT storage.operation() AS raw_operation
  ),
  normalized AS (
    SELECT CASE
      WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9)
      ELSE raw_operation
    END AS current_operation
    FROM current_operation
  )
  SELECT EXISTS (
    SELECT 1
    FROM normalized n
    CROSS JOIN LATERAL unnest(expected_operations) AS expected_operation
    WHERE expected_operation IS NOT NULL
      AND expected_operation <> ''
      AND n.current_operation = CASE
        WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9)
        ELSE expected_operation
      END
  );
$$;


--
-- Name: allow_only_operation(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.allow_only_operation(expected_operation text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  WITH current_operation AS (
    SELECT storage.operation() AS raw_operation
  ),
  normalized AS (
    SELECT
      CASE
        WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9)
        ELSE raw_operation
      END AS current_operation,
      CASE
        WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9)
        ELSE expected_operation
      END AS requested_operation
    FROM current_operation
  )
  SELECT CASE
    WHEN requested_operation IS NULL OR requested_operation = '' THEN FALSE
    ELSE COALESCE(current_operation = requested_operation, FALSE)
  END
  FROM normalized;
$$;


--
-- Name: can_insert_object(text, text, uuid, jsonb); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.can_insert_object(bucketid text, name text, owner uuid, metadata jsonb) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO "storage"."objects" ("bucket_id", "name", "owner", "metadata") VALUES (bucketid, name, owner, metadata);
  -- hack to rollback the successful insert
  RAISE sqlstate 'PT200' using
  message = 'ROLLBACK',
  detail = 'rollback successful insert';
END
$$;


--
-- Name: enforce_bucket_name_length(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.enforce_bucket_name_length() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
    if length(new.name) > 100 then
        raise exception 'bucket name "%" is too long (% characters). Max is 100.', new.name, length(new.name);
    end if;
    return new;
end;
$$;


--
-- Name: extension(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.extension(name text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
    _filename text;
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Get the last path segment (the actual filename)
    SELECT _parts[array_length(_parts, 1)] INTO _filename;
    -- Extract extension: reverse, split on '.', then reverse again
    RETURN reverse(split_part(reverse(_filename), '.', 1));
END
$$;


--
-- Name: filename(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.filename(name text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
BEGIN
    SELECT string_to_array(name, '/') INTO _parts;
    RETURN _parts[array_length(_parts, 1)];
END
$$;


--
-- Name: foldername(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.foldername(name text) RETURNS text[]
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Return everything except the last segment
    RETURN _parts[1 : array_length(_parts,1) - 1];
END
$$;


--
-- Name: get_common_prefix(text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.get_common_prefix(p_key text, p_prefix text, p_delimiter text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
SELECT CASE
    WHEN position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)) > 0
    THEN left(p_key, length(p_prefix) + position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)))
    ELSE NULL
END;
$$;


--
-- Name: get_size_by_bucket(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.get_size_by_bucket() RETURNS TABLE(size bigint, bucket_id text)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    return query
        select sum((metadata->>'size')::bigint)::bigint as size, obj.bucket_id
        from "storage".objects as obj
        group by obj.bucket_id;
END
$$;


--
-- Name: list_multipart_uploads_with_delimiter(text, text, text, integer, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.list_multipart_uploads_with_delimiter(bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, next_key_token text DEFAULT ''::text, next_upload_token text DEFAULT ''::text) RETURNS TABLE(key text, id text, created_at timestamp with time zone)
    LANGUAGE plpgsql
    AS $_$
BEGIN
    RETURN QUERY EXECUTE
        'SELECT DISTINCT ON(key COLLATE "C") * from (
            SELECT
                CASE
                    WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                        substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1)))
                    ELSE
                        key
                END AS key, id, created_at
            FROM
                storage.s3_multipart_uploads
            WHERE
                bucket_id = $5 AND
                key ILIKE $1 || ''%'' AND
                CASE
                    WHEN $4 != '''' AND $6 = '''' THEN
                        CASE
                            WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                                substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1))) COLLATE "C" > $4
                            ELSE
                                key COLLATE "C" > $4
                            END
                    ELSE
                        true
                END AND
                CASE
                    WHEN $6 != '''' THEN
                        id COLLATE "C" > $6
                    ELSE
                        true
                    END
            ORDER BY
                key COLLATE "C" ASC, created_at ASC) as e order by key COLLATE "C" LIMIT $3'
        USING prefix_param, delimiter_param, max_keys, next_key_token, bucket_id, next_upload_token;
END;
$_$;


--
-- Name: list_objects_with_delimiter(text, text, text, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.list_objects_with_delimiter(_bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, start_after text DEFAULT ''::text, next_token text DEFAULT ''::text, sort_order text DEFAULT 'asc'::text) RETURNS TABLE(name text, id uuid, metadata jsonb, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;

    -- Configuration
    v_is_asc BOOLEAN;
    v_prefix TEXT;
    v_start TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;

    -- Seek state
    v_next_seek TEXT;
    v_count INT := 0;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;

BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_is_asc := lower(coalesce(sort_order, 'asc')) = 'asc';
    v_prefix := coalesce(prefix_param, '');
    v_start := CASE WHEN coalesce(next_token, '') <> '' THEN next_token ELSE coalesce(start_after, '') END;
    v_file_batch_size := LEAST(GREATEST(max_keys * 2, 100), 1000);

    -- Calculate upper bound for prefix filtering (bytewise, using COLLATE "C")
    IF v_prefix = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix, 1) = delimiter_param THEN
        v_upper_bound := left(v_prefix, -1) || chr(ascii(delimiter_param) + 1);
    ELSE
        v_upper_bound := left(v_prefix, -1) || chr(ascii(right(v_prefix, 1)) + 1);
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" >= $2 ' ||
                'AND o.name COLLATE "C" < $3 ORDER BY o.name COLLATE "C" ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" >= $2 ' ||
                'ORDER BY o.name COLLATE "C" ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" < $2 ' ||
                'AND o.name COLLATE "C" >= $3 ORDER BY o.name COLLATE "C" DESC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" < $2 ' ||
                'ORDER BY o.name COLLATE "C" DESC LIMIT $4';
        END IF;
    END IF;

    -- ========================================================================
    -- SEEK INITIALIZATION: Determine starting position
    -- ========================================================================
    IF v_start = '' THEN
        IF v_is_asc THEN
            v_next_seek := v_prefix;
        ELSE
            -- DESC without cursor: find the last item in range
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_prefix AND o.name COLLATE "C" < v_upper_bound
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix <> '' THEN
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            END IF;

            IF v_next_seek IS NOT NULL THEN
                v_next_seek := v_next_seek || delimiter_param;
            ELSE
                RETURN;
            END IF;
        END IF;
    ELSE
        -- Cursor provided: determine if it refers to a folder or leaf
        IF EXISTS (
            SELECT 1 FROM storage.objects o
            WHERE o.bucket_id = _bucket_id
              AND o.name COLLATE "C" LIKE v_start || delimiter_param || '%'
            LIMIT 1
        ) THEN
            -- Cursor refers to a folder
            IF v_is_asc THEN
                v_next_seek := v_start || chr(ascii(delimiter_param) + 1);
            ELSE
                v_next_seek := v_start || delimiter_param;
            END IF;
        ELSE
            -- Cursor refers to a leaf object
            IF v_is_asc THEN
                v_next_seek := v_start || delimiter_param;
            ELSE
                v_next_seek := v_start;
            END IF;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= max_keys;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        IF v_is_asc THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_next_seek AND o.name COLLATE "C" < v_upper_bound
                ORDER BY o.name COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_next_seek
                ORDER BY o.name COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSE
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix <> '' THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(v_peek_name, v_prefix, delimiter_param);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Emit and skip to next folder (no heap access needed)
            name := rtrim(v_common_prefix, delimiter_param);
            id := NULL;
            updated_at := NULL;
            created_at := NULL;
            last_accessed_at := NULL;
            metadata := NULL;
            RETURN NEXT;
            v_count := v_count + 1;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := left(v_common_prefix, -1) || chr(ascii(delimiter_param) + 1);
            ELSE
                v_next_seek := v_common_prefix;
            END IF;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query USING _bucket_id, v_next_seek,
                CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix) ELSE v_prefix END, v_file_batch_size
            LOOP
                v_common_prefix := storage.get_common_prefix(v_current.name, v_prefix, delimiter_param);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it
                    v_next_seek := v_current.name;
                    EXIT;
                END IF;

                -- Emit file
                name := v_current.name;
                id := v_current.id;
                updated_at := v_current.updated_at;
                created_at := v_current.created_at;
                last_accessed_at := v_current.last_accessed_at;
                metadata := v_current.metadata;
                RETURN NEXT;
                v_count := v_count + 1;

                -- Advance seek past this file
                IF v_is_asc THEN
                    v_next_seek := v_current.name || delimiter_param;
                ELSE
                    v_next_seek := v_current.name;
                END IF;

                EXIT WHEN v_count >= max_keys;
            END LOOP;
        END IF;
    END LOOP;
END;
$_$;


--
-- Name: operation(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.operation() RETURNS text
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    RETURN current_setting('storage.operation', true);
END;
$$;


--
-- Name: protect_delete(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.protect_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Check if storage.allow_delete_query is set to 'true'
    IF COALESCE(current_setting('storage.allow_delete_query', true), 'false') != 'true' THEN
        RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
            USING HINT = 'This prevents accidental data loss from orphaned objects.',
                  ERRCODE = '42501';
    END IF;
    RETURN NULL;
END;
$$;


--
-- Name: search(text, text, integer, integer, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search(prefix text, bucketname text, limits integer DEFAULT 100, levels integer DEFAULT 1, offsets integer DEFAULT 0, search text DEFAULT ''::text, sortcolumn text DEFAULT 'name'::text, sortorder text DEFAULT 'asc'::text) RETURNS TABLE(name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;
    v_delimiter CONSTANT TEXT := '/';

    -- Configuration
    v_limit INT;
    v_prefix TEXT;
    v_prefix_lower TEXT;
    v_is_asc BOOLEAN;
    v_order_by TEXT;
    v_sort_order TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;

    -- Seek state
    v_next_seek TEXT;
    v_count INT := 0;
    v_skipped INT := 0;
BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_limit := LEAST(coalesce(limits, 100), 1500);
    v_prefix := coalesce(prefix, '') || coalesce(search, '');
    v_prefix_lower := lower(v_prefix);
    v_is_asc := lower(coalesce(sortorder, 'asc')) = 'asc';
    v_file_batch_size := LEAST(GREATEST(v_limit * 2, 100), 1000);

    -- Validate sort column
    CASE lower(coalesce(sortcolumn, 'name'))
        WHEN 'name' THEN v_order_by := 'name';
        WHEN 'updated_at' THEN v_order_by := 'updated_at';
        WHEN 'created_at' THEN v_order_by := 'created_at';
        WHEN 'last_accessed_at' THEN v_order_by := 'last_accessed_at';
        ELSE v_order_by := 'name';
    END CASE;

    v_sort_order := CASE WHEN v_is_asc THEN 'asc' ELSE 'desc' END;

    -- ========================================================================
    -- NON-NAME SORTING: Use path_tokens approach (unchanged)
    -- ========================================================================
    IF v_order_by != 'name' THEN
        RETURN QUERY EXECUTE format(
            $sql$
            WITH folders AS (
                SELECT path_tokens[$1] AS folder
                FROM storage.objects
                WHERE objects.name ILIKE $2 || '%%'
                  AND bucket_id = $3
                  AND array_length(objects.path_tokens, 1) <> $1
                GROUP BY folder
                ORDER BY folder %s
            )
            (SELECT folder AS "name",
                   NULL::uuid AS id,
                   NULL::timestamptz AS updated_at,
                   NULL::timestamptz AS created_at,
                   NULL::timestamptz AS last_accessed_at,
                   NULL::jsonb AS metadata FROM folders)
            UNION ALL
            (SELECT path_tokens[$1] AS "name",
                   id, updated_at, created_at, last_accessed_at, metadata
             FROM storage.objects
             WHERE objects.name ILIKE $2 || '%%'
               AND bucket_id = $3
               AND array_length(objects.path_tokens, 1) = $1
             ORDER BY %I %s)
            LIMIT $4 OFFSET $5
            $sql$, v_sort_order, v_order_by, v_sort_order
        ) USING levels, v_prefix, bucketname, v_limit, offsets;
        RETURN;
    END IF;

    -- ========================================================================
    -- NAME SORTING: Hybrid skip-scan with batch optimization
    -- ========================================================================

    -- Calculate upper bound for prefix filtering
    IF v_prefix_lower = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix_lower, 1) = v_delimiter THEN
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(v_delimiter) + 1);
    ELSE
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(right(v_prefix_lower, 1)) + 1);
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" >= $2 ' ||
                'AND lower(o.name) COLLATE "C" < $3 ORDER BY lower(o.name) COLLATE "C" ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" >= $2 ' ||
                'ORDER BY lower(o.name) COLLATE "C" ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 ' ||
                'AND lower(o.name) COLLATE "C" >= $3 ORDER BY lower(o.name) COLLATE "C" DESC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 ' ||
                'ORDER BY lower(o.name) COLLATE "C" DESC LIMIT $4';
        END IF;
    END IF;

    -- Initialize seek position
    IF v_is_asc THEN
        v_next_seek := v_prefix_lower;
    ELSE
        -- DESC: find the last item in range first (static SQL)
        IF v_upper_bound IS NOT NULL THEN
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_prefix_lower AND lower(o.name) COLLATE "C" < v_upper_bound
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        ELSIF v_prefix_lower <> '' THEN
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_prefix_lower
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        ELSE
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        END IF;

        IF v_peek_name IS NOT NULL THEN
            v_next_seek := lower(v_peek_name) || v_delimiter;
        ELSE
            RETURN;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= v_limit;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        IF v_is_asc THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek AND lower(o.name) COLLATE "C" < v_upper_bound
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSE
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix_lower <> '' THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(lower(v_peek_name), v_prefix_lower, v_delimiter);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Handle offset, emit if needed, skip to next folder
            IF v_skipped < offsets THEN
                v_skipped := v_skipped + 1;
            ELSE
                name := split_part(rtrim(storage.get_common_prefix(v_peek_name, v_prefix, v_delimiter), v_delimiter), v_delimiter, levels);
                id := NULL;
                updated_at := NULL;
                created_at := NULL;
                last_accessed_at := NULL;
                metadata := NULL;
                RETURN NEXT;
                v_count := v_count + 1;
            END IF;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := lower(left(v_common_prefix, -1)) || chr(ascii(v_delimiter) + 1);
            ELSE
                v_next_seek := lower(v_common_prefix);
            END IF;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix_lower is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query
                USING bucketname, v_next_seek,
                    CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix_lower) ELSE v_prefix_lower END, v_file_batch_size
            LOOP
                v_common_prefix := storage.get_common_prefix(lower(v_current.name), v_prefix_lower, v_delimiter);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it
                    v_next_seek := lower(v_current.name);
                    EXIT;
                END IF;

                -- Handle offset skipping
                IF v_skipped < offsets THEN
                    v_skipped := v_skipped + 1;
                ELSE
                    -- Emit file
                    name := split_part(v_current.name, v_delimiter, levels);
                    id := v_current.id;
                    updated_at := v_current.updated_at;
                    created_at := v_current.created_at;
                    last_accessed_at := v_current.last_accessed_at;
                    metadata := v_current.metadata;
                    RETURN NEXT;
                    v_count := v_count + 1;
                END IF;

                -- Advance seek past this file
                IF v_is_asc THEN
                    v_next_seek := lower(v_current.name) || v_delimiter;
                ELSE
                    v_next_seek := lower(v_current.name);
                END IF;

                EXIT WHEN v_count >= v_limit;
            END LOOP;
        END IF;
    END LOOP;
END;
$_$;


--
-- Name: search_by_timestamp(text, text, integer, integer, text, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search_by_timestamp(p_prefix text, p_bucket_id text, p_limit integer, p_level integer, p_start_after text, p_sort_order text, p_sort_column text, p_sort_column_after text) RETURNS TABLE(key text, name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_cursor_op text;
    v_query text;
    v_prefix text;
BEGIN
    v_prefix := coalesce(p_prefix, '');

    IF p_sort_order = 'asc' THEN
        v_cursor_op := '>';
    ELSE
        v_cursor_op := '<';
    END IF;

    v_query := format($sql$
        WITH raw_objects AS (
            SELECT
                o.name AS obj_name,
                o.id AS obj_id,
                o.updated_at AS obj_updated_at,
                o.created_at AS obj_created_at,
                o.last_accessed_at AS obj_last_accessed_at,
                o.metadata AS obj_metadata,
                storage.get_common_prefix(o.name, $1, '/') AS common_prefix
            FROM storage.objects o
            WHERE o.bucket_id = $2
              AND o.name COLLATE "C" LIKE $1 || '%%'
        ),
        -- Aggregate common prefixes (folders)
        -- Both created_at and updated_at use MIN(obj_created_at) to match the old prefixes table behavior
        aggregated_prefixes AS (
            SELECT
                rtrim(common_prefix, '/') AS name,
                NULL::uuid AS id,
                MIN(obj_created_at) AS updated_at,
                MIN(obj_created_at) AS created_at,
                NULL::timestamptz AS last_accessed_at,
                NULL::jsonb AS metadata,
                TRUE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NOT NULL
            GROUP BY common_prefix
        ),
        leaf_objects AS (
            SELECT
                obj_name AS name,
                obj_id AS id,
                obj_updated_at AS updated_at,
                obj_created_at AS created_at,
                obj_last_accessed_at AS last_accessed_at,
                obj_metadata AS metadata,
                FALSE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NULL
        ),
        combined AS (
            SELECT * FROM aggregated_prefixes
            UNION ALL
            SELECT * FROM leaf_objects
        ),
        filtered AS (
            SELECT *
            FROM combined
            WHERE (
                $5 = ''
                OR ROW(
                    date_trunc('milliseconds', %I),
                    name COLLATE "C"
                ) %s ROW(
                    COALESCE(NULLIF($6, '')::timestamptz, 'epoch'::timestamptz),
                    $5
                )
            )
        )
        SELECT
            split_part(name, '/', $3) AS key,
            name,
            id,
            updated_at,
            created_at,
            last_accessed_at,
            metadata
        FROM filtered
        ORDER BY
            COALESCE(date_trunc('milliseconds', %I), 'epoch'::timestamptz) %s,
            name COLLATE "C" %s
        LIMIT $4
    $sql$,
        p_sort_column,
        v_cursor_op,
        p_sort_column,
        p_sort_order,
        p_sort_order
    );

    RETURN QUERY EXECUTE v_query
    USING v_prefix, p_bucket_id, p_level, p_limit, p_start_after, p_sort_column_after;
END;
$_$;


--
-- Name: search_v2(text, text, integer, integer, text, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search_v2(prefix text, bucket_name text, limits integer DEFAULT 100, levels integer DEFAULT 1, start_after text DEFAULT ''::text, sort_order text DEFAULT 'asc'::text, sort_column text DEFAULT 'name'::text, sort_column_after text DEFAULT ''::text) RETURNS TABLE(key text, name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
    v_sort_col text;
    v_sort_ord text;
    v_limit int;
BEGIN
    -- Cap limit to maximum of 1500 records
    v_limit := LEAST(coalesce(limits, 100), 1500);

    -- Validate and normalize sort_order
    v_sort_ord := lower(coalesce(sort_order, 'asc'));
    IF v_sort_ord NOT IN ('asc', 'desc') THEN
        v_sort_ord := 'asc';
    END IF;

    -- Validate and normalize sort_column
    v_sort_col := lower(coalesce(sort_column, 'name'));
    IF v_sort_col NOT IN ('name', 'updated_at', 'created_at') THEN
        v_sort_col := 'name';
    END IF;

    -- Route to appropriate implementation
    IF v_sort_col = 'name' THEN
        -- Use list_objects_with_delimiter for name sorting (most efficient: O(k * log n))
        RETURN QUERY
        SELECT
            split_part(l.name, '/', levels) AS key,
            l.name AS name,
            l.id,
            l.updated_at,
            l.created_at,
            l.last_accessed_at,
            l.metadata
        FROM storage.list_objects_with_delimiter(
            bucket_name,
            coalesce(prefix, ''),
            '/',
            v_limit,
            start_after,
            '',
            v_sort_ord
        ) l;
    ELSE
        -- Use aggregation approach for timestamp sorting
        -- Not efficient for large datasets but supports correct pagination
        RETURN QUERY SELECT * FROM storage.search_by_timestamp(
            prefix, bucket_name, v_limit, levels, start_after,
            v_sort_ord, v_sort_col, sort_column_after
        );
    END IF;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW; 
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: audit_log_entries; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.audit_log_entries (
    instance_id uuid,
    id uuid NOT NULL,
    payload json,
    created_at timestamp with time zone,
    ip_address character varying(64) DEFAULT ''::character varying NOT NULL
);


--
-- Name: TABLE audit_log_entries; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.audit_log_entries IS 'Auth: Audit trail for user actions.';


--
-- Name: custom_oauth_providers; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.custom_oauth_providers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_type text NOT NULL,
    identifier text NOT NULL,
    name text NOT NULL,
    client_id text NOT NULL,
    client_secret text NOT NULL,
    acceptable_client_ids text[] DEFAULT '{}'::text[] NOT NULL,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    pkce_enabled boolean DEFAULT true NOT NULL,
    attribute_mapping jsonb DEFAULT '{}'::jsonb NOT NULL,
    authorization_params jsonb DEFAULT '{}'::jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    email_optional boolean DEFAULT false NOT NULL,
    issuer text,
    discovery_url text,
    skip_nonce_check boolean DEFAULT false NOT NULL,
    cached_discovery jsonb,
    discovery_cached_at timestamp with time zone,
    authorization_url text,
    token_url text,
    userinfo_url text,
    jwks_uri text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    custom_claims_allowlist text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT custom_oauth_providers_authorization_url_https CHECK (((authorization_url IS NULL) OR (authorization_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_authorization_url_length CHECK (((authorization_url IS NULL) OR (char_length(authorization_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_client_id_length CHECK (((char_length(client_id) >= 1) AND (char_length(client_id) <= 512))),
    CONSTRAINT custom_oauth_providers_discovery_url_length CHECK (((discovery_url IS NULL) OR (char_length(discovery_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_identifier_format CHECK ((identifier ~ '^[a-z0-9][a-z0-9:-]{0,48}[a-z0-9]$'::text)),
    CONSTRAINT custom_oauth_providers_issuer_length CHECK (((issuer IS NULL) OR ((char_length(issuer) >= 1) AND (char_length(issuer) <= 2048)))),
    CONSTRAINT custom_oauth_providers_jwks_uri_https CHECK (((jwks_uri IS NULL) OR (jwks_uri ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_jwks_uri_length CHECK (((jwks_uri IS NULL) OR (char_length(jwks_uri) <= 2048))),
    CONSTRAINT custom_oauth_providers_name_length CHECK (((char_length(name) >= 1) AND (char_length(name) <= 100))),
    CONSTRAINT custom_oauth_providers_oauth2_requires_endpoints CHECK (((provider_type <> 'oauth2'::text) OR ((authorization_url IS NOT NULL) AND (token_url IS NOT NULL) AND (userinfo_url IS NOT NULL)))),
    CONSTRAINT custom_oauth_providers_oidc_discovery_url_https CHECK (((provider_type <> 'oidc'::text) OR (discovery_url IS NULL) OR (discovery_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_oidc_issuer_https CHECK (((provider_type <> 'oidc'::text) OR (issuer IS NULL) OR (issuer ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_oidc_requires_issuer CHECK (((provider_type <> 'oidc'::text) OR (issuer IS NOT NULL))),
    CONSTRAINT custom_oauth_providers_provider_type_check CHECK ((provider_type = ANY (ARRAY['oauth2'::text, 'oidc'::text]))),
    CONSTRAINT custom_oauth_providers_token_url_https CHECK (((token_url IS NULL) OR (token_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_token_url_length CHECK (((token_url IS NULL) OR (char_length(token_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_userinfo_url_https CHECK (((userinfo_url IS NULL) OR (userinfo_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_userinfo_url_length CHECK (((userinfo_url IS NULL) OR (char_length(userinfo_url) <= 2048)))
);


--
-- Name: flow_state; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.flow_state (
    id uuid NOT NULL,
    user_id uuid,
    auth_code text,
    code_challenge_method auth.code_challenge_method,
    code_challenge text,
    provider_type text NOT NULL,
    provider_access_token text,
    provider_refresh_token text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    authentication_method text NOT NULL,
    auth_code_issued_at timestamp with time zone,
    invite_token text,
    referrer text,
    oauth_client_state_id uuid,
    linking_target_id uuid,
    email_optional boolean DEFAULT false NOT NULL
);


--
-- Name: TABLE flow_state; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.flow_state IS 'Stores metadata for all OAuth/SSO login flows';


--
-- Name: identities; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.identities (
    provider_id text NOT NULL,
    user_id uuid NOT NULL,
    identity_data jsonb NOT NULL,
    provider text NOT NULL,
    last_sign_in_at timestamp with time zone,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    email text GENERATED ALWAYS AS (lower((identity_data ->> 'email'::text))) STORED,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


--
-- Name: TABLE identities; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.identities IS 'Auth: Stores identities associated to a user.';


--
-- Name: COLUMN identities.email; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.identities.email IS 'Auth: Email is a generated column that references the optional email property in the identity_data';


--
-- Name: instances; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.instances (
    id uuid NOT NULL,
    uuid uuid,
    raw_base_config text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);


--
-- Name: TABLE instances; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.instances IS 'Auth: Manages users across multiple sites.';


--
-- Name: mfa_amr_claims; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.mfa_amr_claims (
    session_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    authentication_method text NOT NULL,
    id uuid NOT NULL
);


--
-- Name: TABLE mfa_amr_claims; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.mfa_amr_claims IS 'auth: stores authenticator method reference claims for multi factor authentication';


--
-- Name: mfa_challenges; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.mfa_challenges (
    id uuid NOT NULL,
    factor_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    verified_at timestamp with time zone,
    ip_address inet NOT NULL,
    otp_code text,
    web_authn_session_data jsonb
);


--
-- Name: TABLE mfa_challenges; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.mfa_challenges IS 'auth: stores metadata about challenge requests made';


--
-- Name: mfa_factors; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.mfa_factors (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    friendly_name text,
    factor_type auth.factor_type NOT NULL,
    status auth.factor_status NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    secret text,
    phone text,
    last_challenged_at timestamp with time zone,
    web_authn_credential jsonb,
    web_authn_aaguid uuid,
    last_webauthn_challenge_data jsonb
);


--
-- Name: TABLE mfa_factors; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.mfa_factors IS 'auth: stores metadata about factors';


--
-- Name: COLUMN mfa_factors.last_webauthn_challenge_data; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.mfa_factors.last_webauthn_challenge_data IS 'Stores the latest WebAuthn challenge data including attestation/assertion for customer verification';


--
-- Name: oauth_authorizations; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_authorizations (
    id uuid NOT NULL,
    authorization_id text NOT NULL,
    client_id uuid NOT NULL,
    user_id uuid,
    redirect_uri text NOT NULL,
    scope text NOT NULL,
    state text,
    resource text,
    code_challenge text,
    code_challenge_method auth.code_challenge_method,
    response_type auth.oauth_response_type DEFAULT 'code'::auth.oauth_response_type NOT NULL,
    status auth.oauth_authorization_status DEFAULT 'pending'::auth.oauth_authorization_status NOT NULL,
    authorization_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '00:03:00'::interval) NOT NULL,
    approved_at timestamp with time zone,
    nonce text,
    CONSTRAINT oauth_authorizations_authorization_code_length CHECK ((char_length(authorization_code) <= 255)),
    CONSTRAINT oauth_authorizations_code_challenge_length CHECK ((char_length(code_challenge) <= 128)),
    CONSTRAINT oauth_authorizations_expires_at_future CHECK ((expires_at > created_at)),
    CONSTRAINT oauth_authorizations_nonce_length CHECK ((char_length(nonce) <= 255)),
    CONSTRAINT oauth_authorizations_redirect_uri_length CHECK ((char_length(redirect_uri) <= 2048)),
    CONSTRAINT oauth_authorizations_resource_length CHECK ((char_length(resource) <= 2048)),
    CONSTRAINT oauth_authorizations_scope_length CHECK ((char_length(scope) <= 4096)),
    CONSTRAINT oauth_authorizations_state_length CHECK ((char_length(state) <= 4096))
);


--
-- Name: oauth_client_states; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_client_states (
    id uuid NOT NULL,
    provider_type text NOT NULL,
    code_verifier text,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: TABLE oauth_client_states; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.oauth_client_states IS 'Stores OAuth states for third-party provider authentication flows where Supabase acts as the OAuth client.';


--
-- Name: oauth_clients; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_clients (
    id uuid NOT NULL,
    client_secret_hash text,
    registration_type auth.oauth_registration_type NOT NULL,
    redirect_uris text NOT NULL,
    grant_types text NOT NULL,
    client_name text,
    client_uri text,
    logo_uri text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    client_type auth.oauth_client_type DEFAULT 'confidential'::auth.oauth_client_type NOT NULL,
    token_endpoint_auth_method text NOT NULL,
    CONSTRAINT oauth_clients_client_name_length CHECK ((char_length(client_name) <= 1024)),
    CONSTRAINT oauth_clients_client_uri_length CHECK ((char_length(client_uri) <= 2048)),
    CONSTRAINT oauth_clients_logo_uri_length CHECK ((char_length(logo_uri) <= 2048)),
    CONSTRAINT oauth_clients_token_endpoint_auth_method_check CHECK ((token_endpoint_auth_method = ANY (ARRAY['client_secret_basic'::text, 'client_secret_post'::text, 'none'::text])))
);


--
-- Name: oauth_consents; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_consents (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    client_id uuid NOT NULL,
    scopes text NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT oauth_consents_revoked_after_granted CHECK (((revoked_at IS NULL) OR (revoked_at >= granted_at))),
    CONSTRAINT oauth_consents_scopes_length CHECK ((char_length(scopes) <= 2048)),
    CONSTRAINT oauth_consents_scopes_not_empty CHECK ((char_length(TRIM(BOTH FROM scopes)) > 0))
);


--
-- Name: one_time_tokens; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.one_time_tokens (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    token_type auth.one_time_token_type NOT NULL,
    token_hash text NOT NULL,
    relates_to text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT one_time_tokens_token_hash_check CHECK ((char_length(token_hash) > 0))
);


--
-- Name: refresh_tokens; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.refresh_tokens (
    instance_id uuid,
    id bigint NOT NULL,
    token character varying(255),
    user_id character varying(255),
    revoked boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    parent character varying(255),
    session_id uuid
);


--
-- Name: TABLE refresh_tokens; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.refresh_tokens IS 'Auth: Store of tokens used to refresh JWT tokens once they expire.';


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE; Schema: auth; Owner: -
--

CREATE SEQUENCE auth.refresh_tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: auth; Owner: -
--

ALTER SEQUENCE auth.refresh_tokens_id_seq OWNED BY auth.refresh_tokens.id;


--
-- Name: saml_providers; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.saml_providers (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    entity_id text NOT NULL,
    metadata_xml text NOT NULL,
    metadata_url text,
    attribute_mapping jsonb,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    name_id_format text,
    CONSTRAINT "entity_id not empty" CHECK ((char_length(entity_id) > 0)),
    CONSTRAINT "metadata_url not empty" CHECK (((metadata_url = NULL::text) OR (char_length(metadata_url) > 0))),
    CONSTRAINT "metadata_xml not empty" CHECK ((char_length(metadata_xml) > 0))
);


--
-- Name: TABLE saml_providers; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.saml_providers IS 'Auth: Manages SAML Identity Provider connections.';


--
-- Name: saml_relay_states; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.saml_relay_states (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    request_id text NOT NULL,
    for_email text,
    redirect_to text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    flow_state_id uuid,
    CONSTRAINT "request_id not empty" CHECK ((char_length(request_id) > 0))
);


--
-- Name: TABLE saml_relay_states; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.saml_relay_states IS 'Auth: Contains SAML Relay State information for each Service Provider initiated login.';


--
-- Name: schema_migrations; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.schema_migrations (
    version character varying(255) NOT NULL
);


--
-- Name: TABLE schema_migrations; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.schema_migrations IS 'Auth: Manages updates to the auth system.';


--
-- Name: sessions; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.sessions (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    factor_id uuid,
    aal auth.aal_level,
    not_after timestamp with time zone,
    refreshed_at timestamp without time zone,
    user_agent text,
    ip inet,
    tag text,
    oauth_client_id uuid,
    refresh_token_hmac_key text,
    refresh_token_counter bigint,
    scopes text,
    CONSTRAINT sessions_scopes_length CHECK ((char_length(scopes) <= 4096))
);


--
-- Name: TABLE sessions; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.sessions IS 'Auth: Stores session data associated to a user.';


--
-- Name: COLUMN sessions.not_after; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sessions.not_after IS 'Auth: Not after is a nullable column that contains a timestamp after which the session should be regarded as expired.';


--
-- Name: COLUMN sessions.refresh_token_hmac_key; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sessions.refresh_token_hmac_key IS 'Holds a HMAC-SHA256 key used to sign refresh tokens for this session.';


--
-- Name: COLUMN sessions.refresh_token_counter; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sessions.refresh_token_counter IS 'Holds the ID (counter) of the last issued refresh token.';


--
-- Name: sso_domains; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.sso_domains (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    domain text NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    CONSTRAINT "domain not empty" CHECK ((char_length(domain) > 0))
);


--
-- Name: TABLE sso_domains; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.sso_domains IS 'Auth: Manages SSO email address domain mapping to an SSO Identity Provider.';


--
-- Name: sso_providers; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.sso_providers (
    id uuid NOT NULL,
    resource_id text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    disabled boolean,
    CONSTRAINT "resource_id not empty" CHECK (((resource_id = NULL::text) OR (char_length(resource_id) > 0)))
);


--
-- Name: TABLE sso_providers; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.sso_providers IS 'Auth: Manages SSO identity provider information; see saml_providers for SAML.';


--
-- Name: COLUMN sso_providers.resource_id; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sso_providers.resource_id IS 'Auth: Uniquely identifies a SSO provider according to a user-chosen resource ID (case insensitive), useful in infrastructure as code.';


--
-- Name: users; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.users (
    instance_id uuid,
    id uuid NOT NULL,
    aud character varying(255),
    role character varying(255),
    email character varying(255),
    encrypted_password character varying(255),
    email_confirmed_at timestamp with time zone,
    invited_at timestamp with time zone,
    confirmation_token character varying(255),
    confirmation_sent_at timestamp with time zone,
    recovery_token character varying(255),
    recovery_sent_at timestamp with time zone,
    email_change_token_new character varying(255),
    email_change character varying(255),
    email_change_sent_at timestamp with time zone,
    last_sign_in_at timestamp with time zone,
    raw_app_meta_data jsonb,
    raw_user_meta_data jsonb,
    is_super_admin boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    phone text DEFAULT NULL::character varying,
    phone_confirmed_at timestamp with time zone,
    phone_change text DEFAULT ''::character varying,
    phone_change_token character varying(255) DEFAULT ''::character varying,
    phone_change_sent_at timestamp with time zone,
    confirmed_at timestamp with time zone GENERATED ALWAYS AS (LEAST(email_confirmed_at, phone_confirmed_at)) STORED,
    email_change_token_current character varying(255) DEFAULT ''::character varying,
    email_change_confirm_status smallint DEFAULT 0,
    banned_until timestamp with time zone,
    reauthentication_token character varying(255) DEFAULT ''::character varying,
    reauthentication_sent_at timestamp with time zone,
    is_sso_user boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    is_anonymous boolean DEFAULT false NOT NULL,
    CONSTRAINT users_email_change_confirm_status_check CHECK (((email_change_confirm_status >= 0) AND (email_change_confirm_status <= 2)))
);


--
-- Name: TABLE users; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.users IS 'Auth: Stores user login data within a secure schema.';


--
-- Name: COLUMN users.is_sso_user; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.users.is_sso_user IS 'Auth: Set this column to true when the account comes from SSO. These accounts can have duplicate emails.';


--
-- Name: webauthn_challenges; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.webauthn_challenges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    challenge_type text NOT NULL,
    session_data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT webauthn_challenges_challenge_type_check CHECK ((challenge_type = ANY (ARRAY['signup'::text, 'registration'::text, 'authentication'::text])))
);


--
-- Name: webauthn_credentials; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.webauthn_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    credential_id bytea NOT NULL,
    public_key bytea NOT NULL,
    attestation_type text DEFAULT ''::text NOT NULL,
    aaguid uuid,
    sign_count bigint DEFAULT 0 NOT NULL,
    transports jsonb DEFAULT '[]'::jsonb NOT NULL,
    backup_eligible boolean DEFAULT false NOT NULL,
    backed_up boolean DEFAULT false NOT NULL,
    friendly_name text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone
);


--
-- Name: attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    date date NOT NULL,
    check_in timestamp with time zone DEFAULT now() NOT NULL,
    check_out timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid,
    table_name text NOT NULL,
    record_id uuid NOT NULL,
    action_type text NOT NULL,
    old_data jsonb,
    new_data jsonb,
    changed_by uuid,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: backup_20260613_bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.backup_20260613_bookings (
    id uuid,
    booking_number text,
    branch_id uuid,
    room_id uuid,
    service_id uuid,
    therapist_id uuid,
    customer_name text,
    customer_email text,
    customer_phone text,
    customer_gender text,
    date date,
    start_time time without time zone,
    end_time time without time zone,
    start_datetime timestamp with time zone,
    end_datetime timestamp with time zone,
    status public.booking_status,
    special_requests text,
    payment_status text,
    base_amount numeric(10,2),
    discount_amount numeric(10,2),
    final_amount numeric(10,2),
    discount_status public.discount_status_enum,
    discount_approved_by uuid,
    created_by uuid,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    is_locked boolean,
    service_name_snapshot text,
    service_duration_snapshot integer,
    service_price_snapshot numeric(10,2),
    therapist_name_snapshot text,
    room_name_snapshot text,
    customer_id uuid,
    client_request_id text,
    discount_reason text,
    discount_requested_by uuid,
    discount_requested_to uuid,
    booking_group_id uuid,
    referred_by text
);


--
-- Name: backup_20260613_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.backup_20260613_payments (
    id uuid,
    booking_id uuid,
    amount numeric(10,2),
    payment_mode text,
    recorded_by uuid,
    notes text,
    created_at timestamp with time zone
);


--
-- Name: booking_therapists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_therapists (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid NOT NULL,
    therapist_id uuid NOT NULL,
    assigned_at timestamp with time zone DEFAULT now(),
    start_time time without time zone,
    end_time time without time zone
);


--
-- Name: COLUMN booking_therapists.start_time; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.booking_therapists.start_time IS 'Therapist-specific start time within the booking window';


--
-- Name: COLUMN booking_therapists.end_time; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.booking_therapists.end_time IS 'Therapist-specific end time within the booking window';


--
-- Name: bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_number text,
    branch_id uuid NOT NULL,
    room_id uuid,
    service_id uuid NOT NULL,
    therapist_id uuid,
    customer_name text NOT NULL,
    customer_email text,
    customer_phone text,
    customer_gender text,
    date date NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    start_datetime timestamp with time zone NOT NULL,
    end_datetime timestamp with time zone NOT NULL,
    status public.booking_status DEFAULT 'Pending'::public.booking_status NOT NULL,
    special_requests text,
    payment_status text DEFAULT 'unpaid'::text NOT NULL,
    base_amount numeric(10,2) NOT NULL,
    discount_amount numeric(10,2) DEFAULT 0 NOT NULL,
    final_amount numeric(10,2) NOT NULL,
    discount_status public.discount_status_enum DEFAULT 'none'::public.discount_status_enum NOT NULL,
    discount_approved_by uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    is_locked boolean DEFAULT false NOT NULL,
    service_name_snapshot text NOT NULL,
    service_duration_snapshot integer NOT NULL,
    service_price_snapshot numeric(10,2) NOT NULL,
    therapist_name_snapshot text,
    room_name_snapshot text,
    customer_id uuid,
    client_request_id text,
    discount_reason text,
    discount_requested_by uuid,
    discount_requested_to uuid,
    booking_group_id uuid,
    referred_by text,
    due_holder_name text,
    referral_commission_type text,
    referral_commission_value numeric,
    CONSTRAINT chk_base_positive CHECK ((base_amount > (0)::numeric)),
    CONSTRAINT chk_discount_approval CHECK (((discount_status <> 'approved'::public.discount_status_enum) OR (discount_approved_by IS NOT NULL))),
    CONSTRAINT chk_discount_positive CHECK ((discount_amount >= (0)::numeric)),
    CONSTRAINT chk_final_amount CHECK ((final_amount = (base_amount - discount_amount))),
    CONSTRAINT chk_payment_status CHECK ((payment_status = ANY (ARRAY['unpaid'::text, 'partial'::text, 'paid'::text]))),
    CONSTRAINT chk_referral_commission CHECK (((referral_commission_type IS NULL) OR ((referral_commission_type = ANY (ARRAY['percentage'::text, 'amount'::text])) AND (referral_commission_value IS NOT NULL) AND (referral_commission_value >= (0)::numeric) AND ((referral_commission_type <> 'percentage'::text) OR (referral_commission_value <= (100)::numeric)))))
);


--
-- Name: branches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.branches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    address text,
    phone text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    open_time time without time zone DEFAULT '09:00:00'::time without time zone NOT NULL,
    close_time time without time zone DEFAULT '21:00:00'::time without time zone NOT NULL,
    timezone text DEFAULT 'Asia/Kathmandu'::text NOT NULL,
    org_id uuid NOT NULL,
    excluded_service_categories text[] DEFAULT '{}'::text[] NOT NULL
);


--
-- Name: COLUMN branches.excluded_service_categories; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.branches.excluded_service_categories IS 'Service categories to hide for this branch (matched against services.category). Empty array = show all.';


--
-- Name: customer_merge_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_merge_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    merged_id uuid NOT NULL,
    canonical_id uuid NOT NULL,
    org_id uuid,
    nphone text,
    merged_row jsonb NOT NULL,
    merged_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid NOT NULL,
    full_name text NOT NULL,
    phone text NOT NULL,
    email text,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_id uuid NOT NULL,
    gender text
);


--
-- Name: daily_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid NOT NULL,
    report_date date NOT NULL,
    total_bookings integer DEFAULT 0 NOT NULL,
    completed_bookings integer DEFAULT 0 NOT NULL,
    cancelled_bookings integer DEFAULT 0 NOT NULL,
    gross_revenue numeric(12,2) DEFAULT 0 NOT NULL,
    total_discounts numeric(12,2) DEFAULT 0 NOT NULL,
    net_revenue numeric(12,2) DEFAULT 0 NOT NULL,
    cash_total numeric(12,2) DEFAULT 0 NOT NULL,
    card_total numeric(12,2) DEFAULT 0 NOT NULL,
    fonepay_total numeric(12,2) DEFAULT 0 NOT NULL,
    unpaid_count integer DEFAULT 0 NOT NULL,
    closed_by uuid NOT NULL,
    closed_at timestamp with time zone DEFAULT now() NOT NULL,
    is_locked boolean DEFAULT true NOT NULL
);


--
-- Name: industries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.industries (
    id text NOT NULL,
    name text NOT NULL,
    description text,
    staff_label text DEFAULT 'Therapist'::text,
    staff_label_plural text DEFAULT 'Therapists'::text,
    location_label text DEFAULT 'Room'::text,
    location_label_plural text DEFAULT 'Rooms'::text,
    session_label text DEFAULT 'Session'::text,
    session_label_plural text DEFAULT 'Sessions'::text,
    enable_rooms boolean DEFAULT true,
    enable_staff_gender boolean DEFAULT true,
    enable_specialties boolean DEFAULT true,
    enable_customer_gender boolean DEFAULT true,
    default_categories jsonb DEFAULT '[]'::jsonb,
    icon text,
    color text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: membership_tiers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.membership_tiers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    advance_amount numeric(12,2) NOT NULL,
    validity_days integer DEFAULT 365 NOT NULL,
    discount_rules jsonb DEFAULT '{}'::jsonb NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    code_prefix text DEFAULT ''::text NOT NULL,
    CONSTRAINT membership_tiers_advance_amount_check CHECK ((advance_amount > (0)::numeric)),
    CONSTRAINT membership_tiers_code_prefix_nonempty CHECK ((length(btrim(code_prefix)) > 0)),
    CONSTRAINT membership_tiers_validity_days_check CHECK ((validity_days > 0))
);


--
-- Name: membership_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.membership_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    membership_id uuid NOT NULL,
    org_id uuid NOT NULL,
    kind text NOT NULL,
    amount numeric(12,2) NOT NULL,
    payment_mode text,
    booking_id uuid,
    payment_id uuid,
    performed_by uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT membership_transactions_amount_sign CHECK ((((kind = 'deposit'::text) AND (amount > (0)::numeric)) OR ((kind = 'deduction'::text) AND (amount < (0)::numeric)) OR ((kind = 'adjustment'::text) AND (amount <> (0)::numeric)) OR ((kind = 'birthday_perk'::text) AND (amount = (0)::numeric)) OR ((kind = 'extension'::text) AND (amount = (0)::numeric)))),
    CONSTRAINT membership_transactions_kind_check CHECK ((kind = ANY (ARRAY['deposit'::text, 'deduction'::text, 'birthday_perk'::text, 'adjustment'::text, 'extension'::text]))),
    CONSTRAINT membership_transactions_payment_mode_check CHECK (((payment_mode IS NULL) OR ((length(TRIM(BOTH FROM payment_mode)) > 0) AND (length(payment_mode) <= 40))))
);


--
-- Name: memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    tier_id uuid NOT NULL,
    total_deposited numeric(12,2) DEFAULT 0 NOT NULL,
    balance numeric(12,2) DEFAULT 0 NOT NULL,
    activation_date date,
    expiry_date date,
    birthday_perk_used_at timestamp with time zone,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    membership_number text
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    body text,
    booking_id uuid,
    read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    slug text NOT NULL,
    owner_email text,
    timezone text DEFAULT 'Asia/Kathmandu'::text,
    currency text DEFAULT 'NPR'::text,
    is_active boolean DEFAULT true,
    settings jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    industry_type text DEFAULT 'spa'::text
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid NOT NULL,
    amount numeric(10,2) NOT NULL,
    payment_mode text NOT NULL,
    recorded_by uuid NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT payments_payment_mode_check CHECK (((payment_mode IS NOT NULL) AND (length(TRIM(BOTH FROM payment_mode)) > 0) AND (length(payment_mode) <= 40)))
);


--
-- Name: payroll_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payroll_run_id uuid NOT NULL,
    therapist_id uuid NOT NULL,
    therapist_name text NOT NULL,
    monthly_salary numeric DEFAULT 0 NOT NULL,
    commission_rate numeric DEFAULT 0 NOT NULL,
    days_in_month integer NOT NULL,
    present_days integer DEFAULT 0 NOT NULL,
    absent_days numeric DEFAULT 0 NOT NULL,
    half_days integer DEFAULT 0 NOT NULL,
    leave_days integer DEFAULT 0 NOT NULL,
    attendance_deduction numeric DEFAULT 0 NOT NULL,
    service_revenue numeric DEFAULT 0 NOT NULL,
    service_commission numeric DEFAULT 0 NOT NULL,
    referral_commission numeric DEFAULT 0 NOT NULL,
    net_pay numeric DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payroll_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid NOT NULL,
    period_month date NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    total_net numeric DEFAULT 0 NOT NULL,
    generated_by uuid,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    finalized_by uuid,
    finalized_at timestamp with time zone,
    CONSTRAINT payroll_runs_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'finalized'::text])))
);


--
-- Name: rooms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rooms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    display_order integer DEFAULT 0 NOT NULL,
    amenities text[] DEFAULT '{}'::text[],
    floor text
);


--
-- Name: COLUMN rooms.amenities; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.rooms.amenities IS 'List of features/amenities available in the room (e.g., 1 Bed, 3 Chair, 1 Jacuzzi & Shower)';


--
-- Name: COLUMN rooms.floor; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.rooms.floor IS 'Floor where the room is located (e.g., Ground Floor, Nepali Floor, Thai Floor)';


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version text NOT NULL,
    name text,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: service_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    org_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.services (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    duration_minutes integer NOT NULL,
    price_npr numeric(10,2) NOT NULL,
    description text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    org_id uuid NOT NULL,
    image_url text,
    category text DEFAULT 'Spa'::text
);


--
-- Name: COLUMN services.image_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.services.image_url IS 'URL to service image displayed in customer booking portal';


--
-- Name: COLUMN services.category; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.services.category IS 'Service category: Spa, Salon, Facial, Wellness, Waxing, Threading, Hair Color, Hair Treatment, Nail, Packages, Other';


--
-- Name: staff_compensation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_compensation (
    therapist_id uuid NOT NULL,
    monthly_salary numeric DEFAULT 0 NOT NULL,
    commission_rate numeric DEFAULT 0 NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT staff_compensation_commission_rate_check CHECK (((commission_rate >= (0)::numeric) AND (commission_rate <= (100)::numeric))),
    CONSTRAINT staff_compensation_monthly_salary_check CHECK ((monthly_salary >= (0)::numeric))
);


--
-- Name: staff_transfers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_transfers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    therapist_id uuid NOT NULL,
    org_id uuid NOT NULL,
    from_branch_id uuid NOT NULL,
    to_branch_id uuid NOT NULL,
    transferred_by uuid,
    transferred_at timestamp with time zone DEFAULT now() NOT NULL,
    note text,
    effective_date date DEFAULT CURRENT_DATE NOT NULL,
    applied boolean DEFAULT true NOT NULL,
    CONSTRAINT staff_transfers_distinct_branches CHECK ((from_branch_id <> to_branch_id))
);


--
-- Name: therapist_attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.therapist_attendance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid NOT NULL,
    therapist_id uuid NOT NULL,
    date date NOT NULL,
    status text NOT NULL,
    check_in_time time without time zone,
    check_out_time time without time zone,
    notes text,
    marked_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT therapist_attendance_status_check CHECK ((status = ANY (ARRAY['Present'::text, 'Absent'::text, 'Leave'::text, 'Half-Day'::text])))
);


--
-- Name: therapists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.therapists (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid NOT NULL,
    name text NOT NULL,
    gender text NOT NULL,
    specialties text[] DEFAULT '{}'::text[],
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    display_order integer DEFAULT 0 NOT NULL,
    "position" text,
    is_service_staff boolean DEFAULT true,
    org_id uuid NOT NULL,
    CONSTRAINT therapists_gender_check CHECK ((gender = ANY (ARRAY['Male'::text, 'Female'::text])))
);


--
-- Name: COLUMN therapists."position"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.therapists."position" IS 'Employee position/category (e.g., Therapist, Hairdresser, Beautician, Housekeeping)';


--
-- Name: COLUMN therapists.is_service_staff; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.therapists.is_service_staff IS 'true = assigned to bookings (Therapist, Hairdresser, etc.), false = support staff (Housekeeping, Gardener, etc.)';


--
-- Name: user_branches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_branches (
    user_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    email text NOT NULL,
    full_name text NOT NULL,
    role public.user_role DEFAULT 'staff'::public.user_role NOT NULL,
    branch_id uuid,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    org_id uuid NOT NULL,
    pin text
);


--
-- Name: messages; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.messages (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    binary_payload bytea
)
PARTITION BY RANGE (inserted_at);


--
-- Name: messages_2026_08_10; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.messages_2026_08_10 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    binary_payload bytea,
    CONSTRAINT messages_payload_exclusive CHECK (((payload IS NULL) OR (binary_payload IS NULL)))
);


--
-- Name: messages_2026_08_11; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.messages_2026_08_11 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    binary_payload bytea,
    CONSTRAINT messages_payload_exclusive CHECK (((payload IS NULL) OR (binary_payload IS NULL)))
);


--
-- Name: messages_2026_08_12; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.messages_2026_08_12 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    binary_payload bytea,
    CONSTRAINT messages_payload_exclusive CHECK (((payload IS NULL) OR (binary_payload IS NULL)))
);


--
-- Name: messages_2026_08_13; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.messages_2026_08_13 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    binary_payload bytea,
    CONSTRAINT messages_payload_exclusive CHECK (((payload IS NULL) OR (binary_payload IS NULL)))
);


--
-- Name: messages_2026_08_14; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.messages_2026_08_14 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    binary_payload bytea,
    CONSTRAINT messages_payload_exclusive CHECK (((payload IS NULL) OR (binary_payload IS NULL)))
);


--
-- Name: messages_2026_08_15; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.messages_2026_08_15 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    binary_payload bytea,
    CONSTRAINT messages_payload_exclusive CHECK (((payload IS NULL) OR (binary_payload IS NULL)))
);


--
-- Name: messages_2026_08_16; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.messages_2026_08_16 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    binary_payload bytea,
    CONSTRAINT messages_payload_exclusive CHECK (((payload IS NULL) OR (binary_payload IS NULL)))
);


--
-- Name: schema_migrations; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.schema_migrations (
    version bigint NOT NULL,
    inserted_at timestamp(0) without time zone
);


--
-- Name: subscription; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.subscription (
    id bigint NOT NULL,
    subscription_id uuid NOT NULL,
    entity regclass NOT NULL,
    filters realtime.user_defined_filter[] DEFAULT '{}'::realtime.user_defined_filter[] NOT NULL,
    claims jsonb NOT NULL,
    claims_role regrole GENERATED ALWAYS AS (realtime.to_regrole((claims ->> 'role'::text))) STORED NOT NULL,
    created_at timestamp without time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    action_filter text DEFAULT '*'::text,
    selected_columns text[],
    CONSTRAINT subscription_action_filter_check CHECK ((action_filter = ANY (ARRAY['*'::text, 'INSERT'::text, 'UPDATE'::text, 'DELETE'::text])))
);


--
-- Name: subscription_id_seq; Type: SEQUENCE; Schema: realtime; Owner: -
--

ALTER TABLE realtime.subscription ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME realtime.subscription_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: buckets; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.buckets (
    id text NOT NULL,
    name text NOT NULL,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    public boolean DEFAULT false,
    avif_autodetection boolean DEFAULT false,
    file_size_limit bigint,
    allowed_mime_types text[],
    owner_id text,
    type storage.buckettype DEFAULT 'STANDARD'::storage.buckettype NOT NULL
);


--
-- Name: COLUMN buckets.owner; Type: COMMENT; Schema: storage; Owner: -
--

COMMENT ON COLUMN storage.buckets.owner IS 'Field is deprecated, use owner_id instead';


--
-- Name: buckets_analytics; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.buckets_analytics (
    name text NOT NULL,
    type storage.buckettype DEFAULT 'ANALYTICS'::storage.buckettype NOT NULL,
    format text DEFAULT 'ICEBERG'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: buckets_vectors; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.buckets_vectors (
    id text NOT NULL,
    type storage.buckettype DEFAULT 'VECTOR'::storage.buckettype NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: migrations; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.migrations (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    hash character varying(40) NOT NULL,
    executed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: objects; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.objects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bucket_id text,
    name text,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_accessed_at timestamp with time zone DEFAULT now(),
    metadata jsonb,
    path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/'::text)) STORED,
    version text,
    owner_id text,
    user_metadata jsonb
);


--
-- Name: COLUMN objects.owner; Type: COMMENT; Schema: storage; Owner: -
--

COMMENT ON COLUMN storage.objects.owner IS 'Field is deprecated, use owner_id instead';


--
-- Name: s3_multipart_uploads; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.s3_multipart_uploads (
    id text NOT NULL,
    in_progress_size bigint DEFAULT 0 NOT NULL,
    upload_signature text NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL COLLATE pg_catalog."C",
    version text NOT NULL,
    owner_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_metadata jsonb,
    metadata jsonb
);


--
-- Name: s3_multipart_uploads_parts; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.s3_multipart_uploads_parts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    upload_id text NOT NULL,
    size bigint DEFAULT 0 NOT NULL,
    part_number integer NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL COLLATE pg_catalog."C",
    etag text NOT NULL,
    owner_id text,
    version text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vector_indexes; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.vector_indexes (
    id text DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL COLLATE pg_catalog."C",
    bucket_id text NOT NULL,
    data_type text NOT NULL,
    dimension integer NOT NULL,
    distance_metric text NOT NULL,
    metadata_configuration jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: schema_migrations; Type: TABLE; Schema: supabase_migrations; Owner: -
--

CREATE TABLE supabase_migrations.schema_migrations (
    version text NOT NULL,
    statements text[],
    name text,
    created_by text,
    idempotency_key text,
    rollback text[]
);


--
-- Name: messages_2026_08_10; Type: TABLE ATTACH; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2026_08_10 FOR VALUES FROM ('2026-08-10 00:00:00') TO ('2026-08-11 00:00:00');


--
-- Name: messages_2026_08_11; Type: TABLE ATTACH; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2026_08_11 FOR VALUES FROM ('2026-08-11 00:00:00') TO ('2026-08-12 00:00:00');


--
-- Name: messages_2026_08_12; Type: TABLE ATTACH; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2026_08_12 FOR VALUES FROM ('2026-08-12 00:00:00') TO ('2026-08-13 00:00:00');


--
-- Name: messages_2026_08_13; Type: TABLE ATTACH; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2026_08_13 FOR VALUES FROM ('2026-08-13 00:00:00') TO ('2026-08-14 00:00:00');


--
-- Name: messages_2026_08_14; Type: TABLE ATTACH; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2026_08_14 FOR VALUES FROM ('2026-08-14 00:00:00') TO ('2026-08-15 00:00:00');


--
-- Name: messages_2026_08_15; Type: TABLE ATTACH; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2026_08_15 FOR VALUES FROM ('2026-08-15 00:00:00') TO ('2026-08-16 00:00:00');


--
-- Name: messages_2026_08_16; Type: TABLE ATTACH; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2026_08_16 FOR VALUES FROM ('2026-08-16 00:00:00') TO ('2026-08-17 00:00:00');


--
-- Name: refresh_tokens id; Type: DEFAULT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens ALTER COLUMN id SET DEFAULT nextval('auth.refresh_tokens_id_seq'::regclass);


--
-- Name: mfa_amr_claims amr_id_pk; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT amr_id_pk PRIMARY KEY (id);


--
-- Name: audit_log_entries audit_log_entries_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.audit_log_entries
    ADD CONSTRAINT audit_log_entries_pkey PRIMARY KEY (id);


--
-- Name: custom_oauth_providers custom_oauth_providers_identifier_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.custom_oauth_providers
    ADD CONSTRAINT custom_oauth_providers_identifier_key UNIQUE (identifier);


--
-- Name: custom_oauth_providers custom_oauth_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.custom_oauth_providers
    ADD CONSTRAINT custom_oauth_providers_pkey PRIMARY KEY (id);


--
-- Name: flow_state flow_state_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.flow_state
    ADD CONSTRAINT flow_state_pkey PRIMARY KEY (id);


--
-- Name: identities identities_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_pkey PRIMARY KEY (id);


--
-- Name: identities identities_provider_id_provider_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_provider_id_provider_unique UNIQUE (provider_id, provider);


--
-- Name: instances instances_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.instances
    ADD CONSTRAINT instances_pkey PRIMARY KEY (id);


--
-- Name: mfa_amr_claims mfa_amr_claims_session_id_authentication_method_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT mfa_amr_claims_session_id_authentication_method_pkey UNIQUE (session_id, authentication_method);


--
-- Name: mfa_challenges mfa_challenges_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_challenges
    ADD CONSTRAINT mfa_challenges_pkey PRIMARY KEY (id);


--
-- Name: mfa_factors mfa_factors_last_challenged_at_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_last_challenged_at_key UNIQUE (last_challenged_at);


--
-- Name: mfa_factors mfa_factors_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_pkey PRIMARY KEY (id);


--
-- Name: oauth_authorizations oauth_authorizations_authorization_code_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_authorization_code_key UNIQUE (authorization_code);


--
-- Name: oauth_authorizations oauth_authorizations_authorization_id_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_authorization_id_key UNIQUE (authorization_id);


--
-- Name: oauth_authorizations oauth_authorizations_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_pkey PRIMARY KEY (id);


--
-- Name: oauth_client_states oauth_client_states_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_client_states
    ADD CONSTRAINT oauth_client_states_pkey PRIMARY KEY (id);


--
-- Name: oauth_clients oauth_clients_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_clients
    ADD CONSTRAINT oauth_clients_pkey PRIMARY KEY (id);


--
-- Name: oauth_consents oauth_consents_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_pkey PRIMARY KEY (id);


--
-- Name: oauth_consents oauth_consents_user_client_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_user_client_unique UNIQUE (user_id, client_id);


--
-- Name: one_time_tokens one_time_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.one_time_tokens
    ADD CONSTRAINT one_time_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_unique UNIQUE (token);


--
-- Name: saml_providers saml_providers_entity_id_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_entity_id_key UNIQUE (entity_id);


--
-- Name: saml_providers saml_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_pkey PRIMARY KEY (id);


--
-- Name: saml_relay_states saml_relay_states_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sso_domains sso_domains_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sso_domains
    ADD CONSTRAINT sso_domains_pkey PRIMARY KEY (id);


--
-- Name: sso_providers sso_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sso_providers
    ADD CONSTRAINT sso_providers_pkey PRIMARY KEY (id);


--
-- Name: users users_phone_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_phone_key UNIQUE (phone);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: webauthn_challenges webauthn_challenges_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_pkey PRIMARY KEY (id);


--
-- Name: webauthn_credentials webauthn_credentials_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_pkey PRIMARY KEY (id);


--
-- Name: attendance attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: booking_therapists booking_therapists_booking_id_therapist_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_therapists
    ADD CONSTRAINT booking_therapists_booking_id_therapist_id_key UNIQUE (booking_id, therapist_id);


--
-- Name: booking_therapists booking_therapists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_therapists
    ADD CONSTRAINT booking_therapists_pkey PRIMARY KEY (id);


--
-- Name: bookings bookings_booking_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_booking_number_key UNIQUE (booking_number);


--
-- Name: bookings bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);


--
-- Name: branches branches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_pkey PRIMARY KEY (id);


--
-- Name: customer_merge_log customer_merge_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_merge_log
    ADD CONSTRAINT customer_merge_log_pkey PRIMARY KEY (id);


--
-- Name: customers customers_branch_phone_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_branch_phone_unique UNIQUE (branch_id, phone);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: daily_reports daily_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_reports
    ADD CONSTRAINT daily_reports_pkey PRIMARY KEY (id);


--
-- Name: industries industries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.industries
    ADD CONSTRAINT industries_pkey PRIMARY KEY (id);


--
-- Name: membership_tiers membership_tiers_org_name_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_tiers
    ADD CONSTRAINT membership_tiers_org_name_uniq UNIQUE (org_id, name);


--
-- Name: membership_tiers membership_tiers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_tiers
    ADD CONSTRAINT membership_tiers_pkey PRIMARY KEY (id);


--
-- Name: membership_transactions membership_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_transactions
    ADD CONSTRAINT membership_transactions_pkey PRIMARY KEY (id);


--
-- Name: memberships memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_code_key UNIQUE (code);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_slug_key UNIQUE (slug);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: payroll_items payroll_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_items
    ADD CONSTRAINT payroll_items_pkey PRIMARY KEY (id);


--
-- Name: payroll_runs payroll_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_runs
    ADD CONSTRAINT payroll_runs_pkey PRIMARY KEY (id);


--
-- Name: rooms rooms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: service_categories service_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_categories
    ADD CONSTRAINT service_categories_pkey PRIMARY KEY (id);


--
-- Name: services services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_pkey PRIMARY KEY (id);


--
-- Name: staff_compensation staff_compensation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_compensation
    ADD CONSTRAINT staff_compensation_pkey PRIMARY KEY (therapist_id);


--
-- Name: staff_transfers staff_transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_transfers
    ADD CONSTRAINT staff_transfers_pkey PRIMARY KEY (id);


--
-- Name: therapist_attendance therapist_attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.therapist_attendance
    ADD CONSTRAINT therapist_attendance_pkey PRIMARY KEY (id);


--
-- Name: therapists therapists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.therapists
    ADD CONSTRAINT therapists_pkey PRIMARY KEY (id);


--
-- Name: service_categories unique_category_name_per_org; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_categories
    ADD CONSTRAINT unique_category_name_per_org UNIQUE (org_id, name);


--
-- Name: attendance uq_attendance_user_date; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT uq_attendance_user_date UNIQUE (user_id, date);


--
-- Name: daily_reports uq_daily_report_branch_date; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_reports
    ADD CONSTRAINT uq_daily_report_branch_date UNIQUE (branch_id, report_date);


--
-- Name: payroll_items uq_payroll_item_run_therapist; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_items
    ADD CONSTRAINT uq_payroll_item_run_therapist UNIQUE (payroll_run_id, therapist_id);


--
-- Name: payroll_runs uq_payroll_run_branch_month; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_runs
    ADD CONSTRAINT uq_payroll_run_branch_month UNIQUE (branch_id, period_month);


--
-- Name: therapist_attendance uq_therapist_date; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.therapist_attendance
    ADD CONSTRAINT uq_therapist_date UNIQUE (therapist_id, date);


--
-- Name: user_branches user_branches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_branches
    ADD CONSTRAINT user_branches_pkey PRIMARY KEY (user_id, branch_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2026_08_10 messages_2026_08_10_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages_2026_08_10
    ADD CONSTRAINT messages_2026_08_10_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2026_08_11 messages_2026_08_11_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages_2026_08_11
    ADD CONSTRAINT messages_2026_08_11_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2026_08_12 messages_2026_08_12_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages_2026_08_12
    ADD CONSTRAINT messages_2026_08_12_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2026_08_13 messages_2026_08_13_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages_2026_08_13
    ADD CONSTRAINT messages_2026_08_13_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2026_08_14 messages_2026_08_14_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages_2026_08_14
    ADD CONSTRAINT messages_2026_08_14_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2026_08_15 messages_2026_08_15_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages_2026_08_15
    ADD CONSTRAINT messages_2026_08_15_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2026_08_16 messages_2026_08_16_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages_2026_08_16
    ADD CONSTRAINT messages_2026_08_16_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages messages_payload_exclusive; Type: CHECK CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE realtime.messages
    ADD CONSTRAINT messages_payload_exclusive CHECK (((payload IS NULL) OR (binary_payload IS NULL))) NOT VALID;


--
-- Name: subscription pk_subscription; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.subscription
    ADD CONSTRAINT pk_subscription PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: buckets_analytics buckets_analytics_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.buckets_analytics
    ADD CONSTRAINT buckets_analytics_pkey PRIMARY KEY (id);


--
-- Name: buckets buckets_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.buckets
    ADD CONSTRAINT buckets_pkey PRIMARY KEY (id);


--
-- Name: buckets_vectors buckets_vectors_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.buckets_vectors
    ADD CONSTRAINT buckets_vectors_pkey PRIMARY KEY (id);


--
-- Name: migrations migrations_name_key; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.migrations
    ADD CONSTRAINT migrations_name_key UNIQUE (name);


--
-- Name: migrations migrations_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.migrations
    ADD CONSTRAINT migrations_pkey PRIMARY KEY (id);


--
-- Name: objects objects_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT objects_pkey PRIMARY KEY (id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_pkey PRIMARY KEY (id);


--
-- Name: s3_multipart_uploads s3_multipart_uploads_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads
    ADD CONSTRAINT s3_multipart_uploads_pkey PRIMARY KEY (id);


--
-- Name: vector_indexes vector_indexes_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.vector_indexes
    ADD CONSTRAINT vector_indexes_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_idempotency_key_key; Type: CONSTRAINT; Schema: supabase_migrations; Owner: -
--

ALTER TABLE ONLY supabase_migrations.schema_migrations
    ADD CONSTRAINT schema_migrations_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: supabase_migrations; Owner: -
--

ALTER TABLE ONLY supabase_migrations.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: audit_logs_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX audit_logs_instance_id_idx ON auth.audit_log_entries USING btree (instance_id);


--
-- Name: confirmation_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX confirmation_token_idx ON auth.users USING btree (confirmation_token) WHERE ((confirmation_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: custom_oauth_providers_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX custom_oauth_providers_created_at_idx ON auth.custom_oauth_providers USING btree (created_at);


--
-- Name: custom_oauth_providers_enabled_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX custom_oauth_providers_enabled_idx ON auth.custom_oauth_providers USING btree (enabled);


--
-- Name: custom_oauth_providers_identifier_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX custom_oauth_providers_identifier_idx ON auth.custom_oauth_providers USING btree (identifier);


--
-- Name: custom_oauth_providers_provider_type_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX custom_oauth_providers_provider_type_idx ON auth.custom_oauth_providers USING btree (provider_type);


--
-- Name: email_change_token_current_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX email_change_token_current_idx ON auth.users USING btree (email_change_token_current) WHERE ((email_change_token_current)::text !~ '^[0-9 ]*$'::text);


--
-- Name: email_change_token_new_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX email_change_token_new_idx ON auth.users USING btree (email_change_token_new) WHERE ((email_change_token_new)::text !~ '^[0-9 ]*$'::text);


--
-- Name: factor_id_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX factor_id_created_at_idx ON auth.mfa_factors USING btree (user_id, created_at);


--
-- Name: flow_state_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX flow_state_created_at_idx ON auth.flow_state USING btree (created_at DESC);


--
-- Name: identities_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX identities_email_idx ON auth.identities USING btree (email text_pattern_ops);


--
-- Name: INDEX identities_email_idx; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON INDEX auth.identities_email_idx IS 'Auth: Ensures indexed queries on the email column';


--
-- Name: identities_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX identities_user_id_idx ON auth.identities USING btree (user_id);


--
-- Name: idx_auth_code; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_auth_code ON auth.flow_state USING btree (auth_code);


--
-- Name: idx_oauth_client_states_created_at; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_oauth_client_states_created_at ON auth.oauth_client_states USING btree (created_at);


--
-- Name: idx_user_id_auth_method; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_user_id_auth_method ON auth.flow_state USING btree (user_id, authentication_method);


--
-- Name: mfa_challenge_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX mfa_challenge_created_at_idx ON auth.mfa_challenges USING btree (created_at DESC);


--
-- Name: mfa_factors_user_friendly_name_unique; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX mfa_factors_user_friendly_name_unique ON auth.mfa_factors USING btree (friendly_name, user_id) WHERE (TRIM(BOTH FROM friendly_name) <> ''::text);


--
-- Name: mfa_factors_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX mfa_factors_user_id_idx ON auth.mfa_factors USING btree (user_id);


--
-- Name: oauth_auth_pending_exp_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_auth_pending_exp_idx ON auth.oauth_authorizations USING btree (expires_at) WHERE (status = 'pending'::auth.oauth_authorization_status);


--
-- Name: oauth_clients_deleted_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_clients_deleted_at_idx ON auth.oauth_clients USING btree (deleted_at);


--
-- Name: oauth_consents_active_client_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_consents_active_client_idx ON auth.oauth_consents USING btree (client_id) WHERE (revoked_at IS NULL);


--
-- Name: oauth_consents_active_user_client_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_consents_active_user_client_idx ON auth.oauth_consents USING btree (user_id, client_id) WHERE (revoked_at IS NULL);


--
-- Name: oauth_consents_user_order_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_consents_user_order_idx ON auth.oauth_consents USING btree (user_id, granted_at DESC);


--
-- Name: one_time_tokens_relates_to_hash_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX one_time_tokens_relates_to_hash_idx ON auth.one_time_tokens USING hash (relates_to);


--
-- Name: one_time_tokens_token_hash_hash_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX one_time_tokens_token_hash_hash_idx ON auth.one_time_tokens USING hash (token_hash);


--
-- Name: one_time_tokens_user_id_token_type_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX one_time_tokens_user_id_token_type_key ON auth.one_time_tokens USING btree (user_id, token_type);


--
-- Name: reauthentication_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX reauthentication_token_idx ON auth.users USING btree (reauthentication_token) WHERE ((reauthentication_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: recovery_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX recovery_token_idx ON auth.users USING btree (recovery_token) WHERE ((recovery_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: refresh_tokens_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_instance_id_idx ON auth.refresh_tokens USING btree (instance_id);


--
-- Name: refresh_tokens_instance_id_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_instance_id_user_id_idx ON auth.refresh_tokens USING btree (instance_id, user_id);


--
-- Name: refresh_tokens_parent_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_parent_idx ON auth.refresh_tokens USING btree (parent);


--
-- Name: refresh_tokens_session_id_revoked_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_session_id_revoked_idx ON auth.refresh_tokens USING btree (session_id, revoked);


--
-- Name: refresh_tokens_updated_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_updated_at_idx ON auth.refresh_tokens USING btree (updated_at DESC);


--
-- Name: saml_providers_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_providers_sso_provider_id_idx ON auth.saml_providers USING btree (sso_provider_id);


--
-- Name: saml_relay_states_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_relay_states_created_at_idx ON auth.saml_relay_states USING btree (created_at DESC);


--
-- Name: saml_relay_states_for_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_relay_states_for_email_idx ON auth.saml_relay_states USING btree (for_email);


--
-- Name: saml_relay_states_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_relay_states_sso_provider_id_idx ON auth.saml_relay_states USING btree (sso_provider_id);


--
-- Name: sessions_not_after_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sessions_not_after_idx ON auth.sessions USING btree (not_after DESC);


--
-- Name: sessions_oauth_client_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sessions_oauth_client_id_idx ON auth.sessions USING btree (oauth_client_id);


--
-- Name: sessions_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sessions_user_id_idx ON auth.sessions USING btree (user_id);


--
-- Name: sso_domains_domain_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX sso_domains_domain_idx ON auth.sso_domains USING btree (lower(domain));


--
-- Name: sso_domains_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sso_domains_sso_provider_id_idx ON auth.sso_domains USING btree (sso_provider_id);


--
-- Name: sso_providers_resource_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX sso_providers_resource_id_idx ON auth.sso_providers USING btree (lower(resource_id));


--
-- Name: sso_providers_resource_id_pattern_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sso_providers_resource_id_pattern_idx ON auth.sso_providers USING btree (resource_id text_pattern_ops);


--
-- Name: unique_phone_factor_per_user; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX unique_phone_factor_per_user ON auth.mfa_factors USING btree (user_id, phone);


--
-- Name: user_id_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX user_id_created_at_idx ON auth.sessions USING btree (user_id, created_at);


--
-- Name: users_email_partial_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX users_email_partial_key ON auth.users USING btree (email) WHERE (is_sso_user = false);


--
-- Name: INDEX users_email_partial_key; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON INDEX auth.users_email_partial_key IS 'Auth: A partial unique index that applies only when is_sso_user is false';


--
-- Name: users_instance_id_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_instance_id_email_idx ON auth.users USING btree (instance_id, lower((email)::text));


--
-- Name: users_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_instance_id_idx ON auth.users USING btree (instance_id);


--
-- Name: users_is_anonymous_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_is_anonymous_idx ON auth.users USING btree (is_anonymous);


--
-- Name: webauthn_challenges_expires_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX webauthn_challenges_expires_at_idx ON auth.webauthn_challenges USING btree (expires_at);


--
-- Name: webauthn_challenges_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX webauthn_challenges_user_id_idx ON auth.webauthn_challenges USING btree (user_id);


--
-- Name: webauthn_credentials_credential_id_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX webauthn_credentials_credential_id_key ON auth.webauthn_credentials USING btree (credential_id);


--
-- Name: webauthn_credentials_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX webauthn_credentials_user_id_idx ON auth.webauthn_credentials USING btree (user_id);


--
-- Name: customers_org_nphone_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customers_org_nphone_uniq ON public.customers USING btree (org_id, NULLIF(regexp_replace(COALESCE(phone, ''::text), '\D'::text, ''::text, 'g'::text), ''::text)) WHERE (NULLIF(regexp_replace(COALESCE(phone, ''::text), '\D'::text, ''::text, 'g'::text), ''::text) IS NOT NULL);


--
-- Name: idx_attendance_branch_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_branch_date ON public.therapist_attendance USING btree (branch_id, date);


--
-- Name: idx_attendance_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_date ON public.attendance USING btree (date);


--
-- Name: idx_attendance_therapist_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_therapist_date ON public.therapist_attendance USING btree (therapist_id, date);


--
-- Name: idx_audit_logs_branch_changed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_branch_changed_at ON public.audit_logs USING btree (branch_id, changed_at DESC);


--
-- Name: idx_audit_logs_record_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_record_id ON public.audit_logs USING btree (record_id);


--
-- Name: idx_audit_logs_table_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_table_name ON public.audit_logs USING btree (table_name);


--
-- Name: idx_booking_therapists_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_booking_therapists_booking ON public.booking_therapists USING btree (booking_id);


--
-- Name: idx_booking_therapists_therapist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_booking_therapists_therapist ON public.booking_therapists USING btree (therapist_id);


--
-- Name: idx_bookings_booking_group_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_booking_group_id ON public.bookings USING btree (booking_group_id) WHERE (booking_group_id IS NOT NULL);


--
-- Name: idx_bookings_branch_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_branch_date ON public.bookings USING btree (branch_id, date);


--
-- Name: idx_bookings_client_request_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_bookings_client_request_id ON public.bookings USING btree (client_request_id) WHERE (client_request_id IS NOT NULL);


--
-- Name: idx_bookings_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_customer_id ON public.bookings USING btree (customer_id);


--
-- Name: idx_bookings_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_date ON public.bookings USING btree (date);


--
-- Name: idx_bookings_discount_requested_to; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_discount_requested_to ON public.bookings USING btree (discount_requested_to) WHERE (discount_status = 'pending'::public.discount_status_enum);


--
-- Name: idx_bookings_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_status ON public.bookings USING btree (status);


--
-- Name: idx_branches_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_branches_org ON public.branches USING btree (org_id);


--
-- Name: idx_branches_org_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_branches_org_active ON public.branches USING btree (org_id, is_active) WHERE (is_active = true);


--
-- Name: idx_customers_branch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_branch_id ON public.customers USING btree (branch_id);


--
-- Name: idx_customers_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_org ON public.customers USING btree (org_id);


--
-- Name: idx_customers_org_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_org_active ON public.customers USING btree (org_id, is_active) WHERE is_active;


--
-- Name: idx_customers_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_phone ON public.customers USING btree (phone);


--
-- Name: idx_daily_reports_branch_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_reports_branch_date ON public.daily_reports USING btree (branch_id, report_date);


--
-- Name: idx_membership_tiers_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_membership_tiers_org ON public.membership_tiers USING btree (org_id);


--
-- Name: idx_membership_txns_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_membership_txns_booking ON public.membership_transactions USING btree (booking_id) WHERE (booking_id IS NOT NULL);


--
-- Name: idx_membership_txns_membership; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_membership_txns_membership ON public.membership_transactions USING btree (membership_id, created_at DESC);


--
-- Name: idx_memberships_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memberships_customer ON public.memberships USING btree (org_id, customer_id);


--
-- Name: idx_memberships_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memberships_org ON public.memberships USING btree (org_id);


--
-- Name: idx_notifications_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_created ON public.notifications USING btree (user_id, created_at DESC);


--
-- Name: idx_organizations_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_organizations_active ON public.organizations USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_organizations_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_organizations_code ON public.organizations USING btree (code);


--
-- Name: idx_organizations_industry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_organizations_industry ON public.organizations USING btree (industry_type);


--
-- Name: idx_organizations_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_organizations_slug ON public.organizations USING btree (slug);


--
-- Name: idx_payments_booking_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_booking_id ON public.payments USING btree (booking_id);


--
-- Name: idx_payments_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_created_at ON public.payments USING btree (created_at);


--
-- Name: idx_payroll_items_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_items_run ON public.payroll_items USING btree (payroll_run_id);


--
-- Name: idx_payroll_runs_branch_month; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payroll_runs_branch_month ON public.payroll_runs USING btree (branch_id, period_month);


--
-- Name: idx_rooms_branch_display_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rooms_branch_display_order ON public.rooms USING btree (branch_id, display_order);


--
-- Name: idx_service_categories_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_categories_active ON public.service_categories USING btree (is_active);


--
-- Name: idx_service_categories_org_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_categories_org_id ON public.service_categories USING btree (org_id);


--
-- Name: idx_services_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_services_category ON public.services USING btree (category);


--
-- Name: idx_services_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_services_org ON public.services USING btree (org_id);


--
-- Name: idx_services_org_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_services_org_active ON public.services USING btree (org_id, is_active) WHERE (is_active = true);


--
-- Name: idx_staff_transfers_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_transfers_org ON public.staff_transfers USING btree (org_id);


--
-- Name: idx_staff_transfers_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_transfers_pending ON public.staff_transfers USING btree (effective_date) WHERE (applied = false);


--
-- Name: idx_staff_transfers_therapist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_transfers_therapist ON public.staff_transfers USING btree (therapist_id);


--
-- Name: idx_therapists_branch_display_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_therapists_branch_display_order ON public.therapists USING btree (branch_id, display_order);


--
-- Name: idx_therapists_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_therapists_org ON public.therapists USING btree (org_id);


--
-- Name: idx_users_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_org ON public.users USING btree (org_id);


--
-- Name: uniq_active_membership_per_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_active_membership_per_customer ON public.memberships USING btree (org_id, customer_id) WHERE ((balance > (0)::numeric) OR (activation_date IS NULL));


--
-- Name: uniq_org_membership_number; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_org_membership_number ON public.memberships USING btree (org_id, membership_number) WHERE (membership_number IS NOT NULL);


--
-- Name: ix_realtime_subscription_entity; Type: INDEX; Schema: realtime; Owner: -
--

CREATE INDEX ix_realtime_subscription_entity ON realtime.subscription USING btree (entity);


--
-- Name: messages_inserted_at_topic_index; Type: INDEX; Schema: realtime; Owner: -
--

CREATE INDEX messages_inserted_at_topic_index ON ONLY realtime.messages USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));


--
-- Name: messages_2026_08_10_inserted_at_topic_idx; Type: INDEX; Schema: realtime; Owner: -
--

CREATE INDEX messages_2026_08_10_inserted_at_topic_idx ON realtime.messages_2026_08_10 USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));


--
-- Name: messages_2026_08_11_inserted_at_topic_idx; Type: INDEX; Schema: realtime; Owner: -
--

CREATE INDEX messages_2026_08_11_inserted_at_topic_idx ON realtime.messages_2026_08_11 USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));


--
-- Name: messages_2026_08_12_inserted_at_topic_idx; Type: INDEX; Schema: realtime; Owner: -
--

CREATE INDEX messages_2026_08_12_inserted_at_topic_idx ON realtime.messages_2026_08_12 USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));


--
-- Name: messages_2026_08_13_inserted_at_topic_idx; Type: INDEX; Schema: realtime; Owner: -
--

CREATE INDEX messages_2026_08_13_inserted_at_topic_idx ON realtime.messages_2026_08_13 USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));


--
-- Name: messages_2026_08_14_inserted_at_topic_idx; Type: INDEX; Schema: realtime; Owner: -
--

CREATE INDEX messages_2026_08_14_inserted_at_topic_idx ON realtime.messages_2026_08_14 USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));


--
-- Name: messages_2026_08_15_inserted_at_topic_idx; Type: INDEX; Schema: realtime; Owner: -
--

CREATE INDEX messages_2026_08_15_inserted_at_topic_idx ON realtime.messages_2026_08_15 USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));


--
-- Name: messages_2026_08_16_inserted_at_topic_idx; Type: INDEX; Schema: realtime; Owner: -
--

CREATE INDEX messages_2026_08_16_inserted_at_topic_idx ON realtime.messages_2026_08_16 USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));


--
-- Name: subscription_subscription_id_entity_filters_action_filter_selec; Type: INDEX; Schema: realtime; Owner: -
--

CREATE UNIQUE INDEX subscription_subscription_id_entity_filters_action_filter_selec ON realtime.subscription USING btree (subscription_id, entity, filters, action_filter, COALESCE(selected_columns, '{}'::text[]));


--
-- Name: bname; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX bname ON storage.buckets USING btree (name);


--
-- Name: bucketid_objname; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX bucketid_objname ON storage.objects USING btree (bucket_id, name);


--
-- Name: buckets_analytics_unique_name_idx; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX buckets_analytics_unique_name_idx ON storage.buckets_analytics USING btree (name) WHERE (deleted_at IS NULL);


--
-- Name: idx_multipart_uploads_list; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_multipart_uploads_list ON storage.s3_multipart_uploads USING btree (bucket_id, key, created_at);


--
-- Name: idx_objects_bucket_id_name; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_objects_bucket_id_name ON storage.objects USING btree (bucket_id, name COLLATE "C");


--
-- Name: idx_objects_bucket_id_name_lower; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_objects_bucket_id_name_lower ON storage.objects USING btree (bucket_id, lower(name) COLLATE "C");


--
-- Name: name_prefix_search; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX name_prefix_search ON storage.objects USING btree (name text_pattern_ops);


--
-- Name: vector_indexes_name_bucket_id_idx; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX vector_indexes_name_bucket_id_idx ON storage.vector_indexes USING btree (name, bucket_id);


--
-- Name: messages_2026_08_10_inserted_at_topic_idx; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_inserted_at_topic_index ATTACH PARTITION realtime.messages_2026_08_10_inserted_at_topic_idx;


--
-- Name: messages_2026_08_10_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2026_08_10_pkey;


--
-- Name: messages_2026_08_11_inserted_at_topic_idx; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_inserted_at_topic_index ATTACH PARTITION realtime.messages_2026_08_11_inserted_at_topic_idx;


--
-- Name: messages_2026_08_11_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2026_08_11_pkey;


--
-- Name: messages_2026_08_12_inserted_at_topic_idx; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_inserted_at_topic_index ATTACH PARTITION realtime.messages_2026_08_12_inserted_at_topic_idx;


--
-- Name: messages_2026_08_12_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2026_08_12_pkey;


--
-- Name: messages_2026_08_13_inserted_at_topic_idx; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_inserted_at_topic_index ATTACH PARTITION realtime.messages_2026_08_13_inserted_at_topic_idx;


--
-- Name: messages_2026_08_13_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2026_08_13_pkey;


--
-- Name: messages_2026_08_14_inserted_at_topic_idx; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_inserted_at_topic_index ATTACH PARTITION realtime.messages_2026_08_14_inserted_at_topic_idx;


--
-- Name: messages_2026_08_14_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2026_08_14_pkey;


--
-- Name: messages_2026_08_15_inserted_at_topic_idx; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_inserted_at_topic_index ATTACH PARTITION realtime.messages_2026_08_15_inserted_at_topic_idx;


--
-- Name: messages_2026_08_15_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2026_08_15_pkey;


--
-- Name: messages_2026_08_16_inserted_at_topic_idx; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_inserted_at_topic_index ATTACH PARTITION realtime.messages_2026_08_16_inserted_at_topic_idx;


--
-- Name: messages_2026_08_16_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2026_08_16_pkey;


--
-- Name: service_categories set_service_categories_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_service_categories_updated_at BEFORE UPDATE ON public.service_categories FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: therapist_attendance trg_attendance_day_lock; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_attendance_day_lock BEFORE UPDATE ON public.therapist_attendance FOR EACH ROW EXECUTE FUNCTION public.check_attendance_day_lock();


--
-- Name: therapist_attendance trg_attendance_day_lock_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_attendance_day_lock_insert BEFORE INSERT ON public.therapist_attendance FOR EACH ROW EXECUTE FUNCTION public.check_attendance_day_lock();


--
-- Name: bookings trg_audit_bookings; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_bookings AFTER UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.fn_insert_audit_log();


--
-- Name: daily_reports trg_audit_daily_reports; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_daily_reports AFTER INSERT ON public.daily_reports FOR EACH ROW EXECUTE FUNCTION public.fn_insert_audit_log();


--
-- Name: payments trg_audit_payments; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_payments AFTER INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION public.fn_insert_audit_log();


--
-- Name: rooms trg_audit_rooms; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_rooms AFTER UPDATE ON public.rooms FOR EACH ROW EXECUTE FUNCTION public.fn_insert_audit_log();


--
-- Name: services trg_audit_services; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_services AFTER UPDATE ON public.services FOR EACH ROW EXECUTE FUNCTION public.fn_insert_audit_log();


--
-- Name: therapists trg_audit_therapists; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_therapists AFTER UPDATE ON public.therapists FOR EACH ROW EXECUTE FUNCTION public.fn_insert_audit_log();


--
-- Name: bookings trg_booking_number; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_booking_number BEFORE INSERT ON public.bookings FOR EACH ROW WHEN ((new.booking_number IS NULL)) EXECUTE FUNCTION public.generate_booking_number();


--
-- Name: daily_reports trg_check_unpaid_before_close; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_check_unpaid_before_close BEFORE INSERT ON public.daily_reports FOR EACH ROW EXECUTE FUNCTION public.check_unpaid_before_daily_close();


--
-- Name: bookings trg_compute_datetimes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_compute_datetimes BEFORE INSERT OR UPDATE OF date, start_time, service_id ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.compute_booking_datetimes();


--
-- Name: bookings trg_compute_final_amount; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_compute_final_amount BEFORE INSERT OR UPDATE OF base_amount, discount_amount ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.compute_final_amount();


--
-- Name: bookings trg_enforce_booking_immutability; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enforce_booking_immutability BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.enforce_booking_immutability();


--
-- Name: payroll_items trg_enforce_payroll_items_immutability; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enforce_payroll_items_immutability BEFORE DELETE OR UPDATE ON public.payroll_items FOR EACH ROW EXECUTE FUNCTION public.enforce_payroll_immutability();


--
-- Name: payroll_runs trg_enforce_payroll_runs_immutability; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enforce_payroll_runs_immutability BEFORE DELETE OR UPDATE ON public.payroll_runs FOR EACH ROW EXECUTE FUNCTION public.enforce_payroll_immutability();


--
-- Name: bookings trg_enforce_therapist_required; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enforce_therapist_required BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.enforce_therapist_for_active_bookings();


--
-- Name: industries trg_industries_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_industries_updated_at BEFORE UPDATE ON public.industries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: membership_transactions trg_membership_recompute; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_membership_recompute AFTER INSERT ON public.membership_transactions FOR EACH ROW EXECUTE FUNCTION public.membership_recompute();


--
-- Name: organizations trg_organizations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_organizations_updated_at BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: payments trg_payment_update_booking_status; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_payment_update_booking_status AFTER INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION public.update_booking_payment_status();


--
-- Name: memberships trg_set_membership_number; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_set_membership_number BEFORE INSERT ON public.memberships FOR EACH ROW EXECUTE FUNCTION public.set_membership_number();


--
-- Name: bookings trg_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: therapist_attendance trg_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at BEFORE UPDATE ON public.therapist_attendance FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: subscription tr_check_filters; Type: TRIGGER; Schema: realtime; Owner: -
--

CREATE TRIGGER tr_check_filters BEFORE INSERT OR UPDATE ON realtime.subscription FOR EACH ROW EXECUTE FUNCTION realtime.subscription_check_filters();


--
-- Name: buckets enforce_bucket_name_length_trigger; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER enforce_bucket_name_length_trigger BEFORE INSERT OR UPDATE OF name ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_bucket_name_length();


--
-- Name: buckets protect_buckets_delete; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER protect_buckets_delete BEFORE DELETE ON storage.buckets FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();


--
-- Name: objects protect_objects_delete; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER protect_objects_delete BEFORE DELETE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();


--
-- Name: objects update_objects_updated_at; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER update_objects_updated_at BEFORE UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.update_updated_at_column();


--
-- Name: identities identities_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: mfa_amr_claims mfa_amr_claims_session_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT mfa_amr_claims_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;


--
-- Name: mfa_challenges mfa_challenges_auth_factor_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_challenges
    ADD CONSTRAINT mfa_challenges_auth_factor_id_fkey FOREIGN KEY (factor_id) REFERENCES auth.mfa_factors(id) ON DELETE CASCADE;


--
-- Name: mfa_factors mfa_factors_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: oauth_authorizations oauth_authorizations_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_client_id_fkey FOREIGN KEY (client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_authorizations oauth_authorizations_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: oauth_consents oauth_consents_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_client_id_fkey FOREIGN KEY (client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_consents oauth_consents_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: one_time_tokens one_time_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.one_time_tokens
    ADD CONSTRAINT one_time_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_session_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;


--
-- Name: saml_providers saml_providers_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: saml_relay_states saml_relay_states_flow_state_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_flow_state_id_fkey FOREIGN KEY (flow_state_id) REFERENCES auth.flow_state(id) ON DELETE CASCADE;


--
-- Name: saml_relay_states saml_relay_states_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_oauth_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_oauth_client_id_fkey FOREIGN KEY (oauth_client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: sso_domains sso_domains_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sso_domains
    ADD CONSTRAINT sso_domains_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: webauthn_challenges webauthn_challenges_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: webauthn_credentials webauthn_credentials_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: attendance attendance_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: attendance attendance_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: booking_therapists booking_therapists_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_therapists
    ADD CONSTRAINT booking_therapists_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: booking_therapists booking_therapists_therapist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_therapists
    ADD CONSTRAINT booking_therapists_therapist_id_fkey FOREIGN KEY (therapist_id) REFERENCES public.therapists(id) ON DELETE CASCADE;


--
-- Name: bookings bookings_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: bookings bookings_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: bookings bookings_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;


--
-- Name: bookings bookings_discount_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_discount_approved_by_fkey FOREIGN KEY (discount_approved_by) REFERENCES public.users(id);


--
-- Name: bookings bookings_discount_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_discount_requested_by_fkey FOREIGN KEY (discount_requested_by) REFERENCES public.users(id);


--
-- Name: bookings bookings_discount_requested_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_discount_requested_to_fkey FOREIGN KEY (discount_requested_to) REFERENCES public.users(id);


--
-- Name: bookings bookings_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id);


--
-- Name: bookings bookings_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id);


--
-- Name: bookings bookings_therapist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_therapist_id_fkey FOREIGN KEY (therapist_id) REFERENCES public.therapists(id);


--
-- Name: branches branches_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: customers customers_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE RESTRICT;


--
-- Name: customers customers_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: daily_reports daily_reports_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_reports
    ADD CONSTRAINT daily_reports_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: daily_reports daily_reports_closed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_reports
    ADD CONSTRAINT daily_reports_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES public.users(id);


--
-- Name: membership_tiers membership_tiers_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_tiers
    ADD CONSTRAINT membership_tiers_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: membership_transactions membership_transactions_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_transactions
    ADD CONSTRAINT membership_transactions_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: membership_transactions membership_transactions_membership_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_transactions
    ADD CONSTRAINT membership_transactions_membership_id_fkey FOREIGN KEY (membership_id) REFERENCES public.memberships(id) ON DELETE CASCADE;


--
-- Name: membership_transactions membership_transactions_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_transactions
    ADD CONSTRAINT membership_transactions_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: membership_transactions membership_transactions_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_transactions
    ADD CONSTRAINT membership_transactions_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE SET NULL;


--
-- Name: membership_transactions membership_transactions_performed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_transactions
    ADD CONSTRAINT membership_transactions_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES public.users(id);


--
-- Name: memberships memberships_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: memberships memberships_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;


--
-- Name: memberships memberships_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: memberships memberships_tier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_tier_id_fkey FOREIGN KEY (tier_id) REFERENCES public.membership_tiers(id);


--
-- Name: notifications notifications_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: organizations organizations_industry_type_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_industry_type_fkey FOREIGN KEY (industry_type) REFERENCES public.industries(id);


--
-- Name: payments payments_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE RESTRICT;


--
-- Name: payments payments_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id);


--
-- Name: payroll_items payroll_items_payroll_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_items
    ADD CONSTRAINT payroll_items_payroll_run_id_fkey FOREIGN KEY (payroll_run_id) REFERENCES public.payroll_runs(id) ON DELETE CASCADE;


--
-- Name: payroll_items payroll_items_therapist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_items
    ADD CONSTRAINT payroll_items_therapist_id_fkey FOREIGN KEY (therapist_id) REFERENCES public.therapists(id);


--
-- Name: payroll_runs payroll_runs_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_runs
    ADD CONSTRAINT payroll_runs_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: payroll_runs payroll_runs_finalized_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_runs
    ADD CONSTRAINT payroll_runs_finalized_by_fkey FOREIGN KEY (finalized_by) REFERENCES public.users(id);


--
-- Name: payroll_runs payroll_runs_generated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_runs
    ADD CONSTRAINT payroll_runs_generated_by_fkey FOREIGN KEY (generated_by) REFERENCES public.users(id);


--
-- Name: rooms rooms_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: service_categories service_categories_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_categories
    ADD CONSTRAINT service_categories_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: services services_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: staff_compensation staff_compensation_therapist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_compensation
    ADD CONSTRAINT staff_compensation_therapist_id_fkey FOREIGN KEY (therapist_id) REFERENCES public.therapists(id) ON DELETE CASCADE;


--
-- Name: staff_compensation staff_compensation_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_compensation
    ADD CONSTRAINT staff_compensation_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: staff_transfers staff_transfers_from_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_transfers
    ADD CONSTRAINT staff_transfers_from_branch_id_fkey FOREIGN KEY (from_branch_id) REFERENCES public.branches(id);


--
-- Name: staff_transfers staff_transfers_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_transfers
    ADD CONSTRAINT staff_transfers_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: staff_transfers staff_transfers_therapist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_transfers
    ADD CONSTRAINT staff_transfers_therapist_id_fkey FOREIGN KEY (therapist_id) REFERENCES public.therapists(id) ON DELETE CASCADE;


--
-- Name: staff_transfers staff_transfers_to_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_transfers
    ADD CONSTRAINT staff_transfers_to_branch_id_fkey FOREIGN KEY (to_branch_id) REFERENCES public.branches(id);


--
-- Name: staff_transfers staff_transfers_transferred_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_transfers
    ADD CONSTRAINT staff_transfers_transferred_by_fkey FOREIGN KEY (transferred_by) REFERENCES public.users(id);


--
-- Name: therapist_attendance therapist_attendance_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.therapist_attendance
    ADD CONSTRAINT therapist_attendance_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE RESTRICT;


--
-- Name: therapist_attendance therapist_attendance_marked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.therapist_attendance
    ADD CONSTRAINT therapist_attendance_marked_by_fkey FOREIGN KEY (marked_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: therapist_attendance therapist_attendance_therapist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.therapist_attendance
    ADD CONSTRAINT therapist_attendance_therapist_id_fkey FOREIGN KEY (therapist_id) REFERENCES public.therapists(id) ON DELETE RESTRICT;


--
-- Name: therapists therapists_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.therapists
    ADD CONSTRAINT therapists_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: therapists therapists_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.therapists
    ADD CONSTRAINT therapists_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: user_branches user_branches_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_branches
    ADD CONSTRAINT user_branches_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: user_branches user_branches_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_branches
    ADD CONSTRAINT user_branches_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: users users_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id);


--
-- Name: users users_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: objects objects_bucketId_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT "objects_bucketId_fkey" FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads s3_multipart_uploads_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads
    ADD CONSTRAINT s3_multipart_uploads_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_upload_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES storage.s3_multipart_uploads(id) ON DELETE CASCADE;


--
-- Name: vector_indexes vector_indexes_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.vector_indexes
    ADD CONSTRAINT vector_indexes_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets_vectors(id);


--
-- Name: audit_log_entries; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.audit_log_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: flow_state; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.flow_state ENABLE ROW LEVEL SECURITY;

--
-- Name: identities; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.identities ENABLE ROW LEVEL SECURITY;

--
-- Name: instances; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.instances ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_amr_claims; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.mfa_amr_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_challenges; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.mfa_challenges ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_factors; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.mfa_factors ENABLE ROW LEVEL SECURITY;

--
-- Name: one_time_tokens; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.one_time_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: refresh_tokens; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.refresh_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: saml_providers; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.saml_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: saml_relay_states; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.saml_relay_states ENABLE ROW LEVEL SECURITY;

--
-- Name: schema_migrations; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.schema_migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: sessions; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: sso_domains; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.sso_domains ENABLE ROW LEVEL SECURITY;

--
-- Name: sso_providers; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.sso_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;

--
-- Name: service_categories Admin can create org categories; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can create org categories" ON public.service_categories FOR INSERT TO authenticated WITH CHECK (((public.get_user_role() = 'admin'::public.user_role) AND (org_id = public.get_user_org_id())));


--
-- Name: service_categories Admin can delete org categories; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can delete org categories" ON public.service_categories FOR DELETE TO authenticated USING (((public.get_user_role() = 'admin'::public.user_role) AND (org_id = public.get_user_org_id())));


--
-- Name: membership_tiers Admin can manage membership tiers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can manage membership tiers" ON public.membership_tiers TO authenticated USING (((public.get_user_role() = 'admin'::public.user_role) AND (org_id = public.get_user_org_id()))) WITH CHECK (((public.get_user_role() = 'admin'::public.user_role) AND (org_id = public.get_user_org_id())));


--
-- Name: audit_logs Admin can read all audit logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can read all audit logs" ON public.audit_logs FOR SELECT TO authenticated USING ((public.get_user_role() = 'admin'::public.user_role));


--
-- Name: service_categories Admin can update org categories; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can update org categories" ON public.service_categories FOR UPDATE TO authenticated USING (((public.get_user_role() = 'admin'::public.user_role) AND (org_id = public.get_user_org_id()))) WITH CHECK (((public.get_user_role() = 'admin'::public.user_role) AND (org_id = public.get_user_org_id())));


--
-- Name: payroll_items Admin manage payroll items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin manage payroll items" ON public.payroll_items TO authenticated USING ((public.get_user_role() = 'admin'::public.user_role)) WITH CHECK ((public.get_user_role() = 'admin'::public.user_role));


--
-- Name: payroll_runs Admin manage payroll runs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin manage payroll runs" ON public.payroll_runs TO authenticated USING ((public.get_user_role() = 'admin'::public.user_role)) WITH CHECK ((public.get_user_role() = 'admin'::public.user_role));


--
-- Name: staff_compensation Admin manage staff compensation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin manage staff compensation" ON public.staff_compensation TO authenticated USING ((public.get_user_role() = 'admin'::public.user_role)) WITH CHECK ((public.get_user_role() = 'admin'::public.user_role));


--
-- Name: attendance Admin viewer can read org attendance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin viewer can read org attendance" ON public.attendance FOR SELECT TO authenticated USING (((public.get_user_role() = 'admin_viewer'::public.user_role) AND (EXISTS ( SELECT 1
   FROM public.branches b
  WHERE ((b.id = attendance.branch_id) AND (b.org_id = public.get_user_org_id()))))));


--
-- Name: audit_logs Admin viewer can read org audit logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin viewer can read org audit logs" ON public.audit_logs FOR SELECT TO authenticated USING (((public.get_user_role() = 'admin_viewer'::public.user_role) AND ((branch_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.branches b
  WHERE ((b.id = audit_logs.branch_id) AND (b.org_id = public.get_user_org_id())))))));


--
-- Name: bookings Admin viewer can read org bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin viewer can read org bookings" ON public.bookings FOR SELECT TO authenticated USING (((public.get_user_role() = 'admin_viewer'::public.user_role) AND (EXISTS ( SELECT 1
   FROM public.branches b
  WHERE ((b.id = bookings.branch_id) AND (b.org_id = public.get_user_org_id()))))));


--
-- Name: daily_reports Admin viewer can read org daily reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin viewer can read org daily reports" ON public.daily_reports FOR SELECT TO authenticated USING (((public.get_user_role() = 'admin_viewer'::public.user_role) AND (EXISTS ( SELECT 1
   FROM public.branches b
  WHERE ((b.id = daily_reports.branch_id) AND (b.org_id = public.get_user_org_id()))))));


--
-- Name: payments Admin viewer can read org payments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin viewer can read org payments" ON public.payments FOR SELECT TO authenticated USING (((public.get_user_role() = 'admin_viewer'::public.user_role) AND (EXISTS ( SELECT 1
   FROM (public.bookings bk
     JOIN public.branches b ON ((b.id = bk.branch_id)))
  WHERE ((bk.id = payments.booking_id) AND (b.org_id = public.get_user_org_id()))))));


--
-- Name: therapist_attendance Admin viewer can read org therapist attendance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin viewer can read org therapist attendance" ON public.therapist_attendance FOR SELECT TO authenticated USING (((public.get_user_role() = 'admin_viewer'::public.user_role) AND (EXISTS ( SELECT 1
   FROM public.branches b
  WHERE ((b.id = therapist_attendance.branch_id) AND (b.org_id = public.get_user_org_id()))))));


--
-- Name: users Admin viewer can read org users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin viewer can read org users" ON public.users FOR SELECT TO authenticated USING (((org_id = public.get_user_org_id()) AND (public.get_user_role() = 'admin_viewer'::public.user_role)));


--
-- Name: payroll_items Admin viewer can read payroll items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin viewer can read payroll items" ON public.payroll_items FOR SELECT TO authenticated USING ((public.get_user_role() = 'admin_viewer'::public.user_role));


--
-- Name: payroll_runs Admin viewer can read payroll runs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin viewer can read payroll runs" ON public.payroll_runs FOR SELECT TO authenticated USING ((public.get_user_role() = 'admin_viewer'::public.user_role));


--
-- Name: staff_compensation Admin viewer can read staff compensation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin viewer can read staff compensation" ON public.staff_compensation FOR SELECT TO authenticated USING ((public.get_user_role() = 'admin_viewer'::public.user_role));


--
-- Name: user_branches Admins can grant org branch access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can grant org branch access" ON public.user_branches FOR INSERT TO authenticated WITH CHECK (((public.get_user_role() = 'admin'::public.user_role) AND (EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = user_branches.user_id) AND (u.org_id = public.get_user_org_id())))) AND (EXISTS ( SELECT 1
   FROM public.branches b
  WHERE ((b.id = user_branches.branch_id) AND (b.org_id = public.get_user_org_id()))))));


--
-- Name: user_branches Admins can read org branch grants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read org branch grants" ON public.user_branches FOR SELECT TO authenticated USING (((public.get_user_role() = 'admin'::public.user_role) AND (EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = user_branches.user_id) AND (u.org_id = public.get_user_org_id()))))));


--
-- Name: user_branches Admins can revoke org branch access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can revoke org branch access" ON public.user_branches FOR DELETE TO authenticated USING (((public.get_user_role() = 'admin'::public.user_role) AND (EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = user_branches.user_id) AND (u.org_id = public.get_user_org_id()))))));


--
-- Name: branches Anonymous can read active branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anonymous can read active branches" ON public.branches FOR SELECT TO anon USING ((is_active = true));


--
-- Name: rooms Anonymous can read active rooms; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anonymous can read active rooms" ON public.rooms FOR SELECT TO anon USING ((is_active = true));


--
-- Name: services Anonymous can read active services; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anonymous can read active services" ON public.services FOR SELECT TO anon USING ((is_active = true));


--
-- Name: therapists Anonymous can read active therapists; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anonymous can read active therapists" ON public.therapists FOR SELECT TO anon USING ((is_active = true));


--
-- Name: industries Anyone can read industries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can read industries" ON public.industries FOR SELECT USING (true);


--
-- Name: membership_tiers Anyone can read membership tiers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can read membership tiers" ON public.membership_tiers FOR SELECT TO authenticated, anon USING (true);


--
-- Name: services Manager and admin can create org services; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Manager and admin can create org services" ON public.services FOR INSERT TO authenticated WITH CHECK (((public.get_user_role() = ANY (ARRAY['manager'::public.user_role, 'admin'::public.user_role])) AND (org_id = public.get_user_org_id())));


--
-- Name: services Manager and admin can delete org services; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Manager and admin can delete org services" ON public.services FOR DELETE TO authenticated USING (((public.get_user_role() = ANY (ARRAY['manager'::public.user_role, 'admin'::public.user_role])) AND (org_id = public.get_user_org_id())));


--
-- Name: services Manager and admin can update org services; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Manager and admin can update org services" ON public.services FOR UPDATE TO authenticated USING (((public.get_user_role() = ANY (ARRAY['manager'::public.user_role, 'admin'::public.user_role])) AND (org_id = public.get_user_org_id()))) WITH CHECK (((public.get_user_role() = ANY (ARRAY['manager'::public.user_role, 'admin'::public.user_role])) AND (org_id = public.get_user_org_id())));


--
-- Name: daily_reports Manager can close day; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Manager can close day" ON public.daily_reports FOR INSERT TO authenticated WITH CHECK (((public.get_user_role() = ANY (ARRAY['manager'::public.user_role, 'admin'::public.user_role])) AND ((branch_id = ANY (public.get_user_branch_ids())) OR (public.get_user_role() = 'admin'::public.user_role))));


--
-- Name: daily_reports Manager can close own org day; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Manager can close own org day" ON public.daily_reports FOR INSERT TO authenticated WITH CHECK (((public.get_user_role() = ANY (ARRAY['manager'::public.user_role, 'admin'::public.user_role])) AND (EXISTS ( SELECT 1
   FROM public.branches b
  WHERE ((b.id = daily_reports.branch_id) AND (b.org_id = public.get_user_org_id())))) AND ((branch_id = public.get_user_branch_id()) OR (public.get_user_role() = 'admin'::public.user_role))));


--
-- Name: rooms Manager can create branch rooms; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Manager can create branch rooms" ON public.rooms FOR INSERT TO authenticated WITH CHECK (((public.get_user_role() = 'admin'::public.user_role) OR ((public.get_user_role() = 'manager'::public.user_role) AND (branch_id = public.get_user_branch_id()))));


--
-- Name: therapists Manager can create branch therapists; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Manager can create branch therapists" ON public.therapists FOR INSERT TO authenticated WITH CHECK (((public.get_user_role() = 'admin'::public.user_role) OR ((public.get_user_role() = 'manager'::public.user_role) AND (branch_id = public.get_user_branch_id()))));


--
-- Name: rooms Manager can create org rooms; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Manager can create org rooms" ON public.rooms FOR INSERT TO authenticated WITH CHECK (((public.get_user_role() = ANY (ARRAY['manager'::public.user_role, 'admin'::public.user_role])) AND (EXISTS ( SELECT 1
   FROM public.branches b
  WHERE ((b.id = rooms.branch_id) AND (b.org_id = public.get_user_org_id()))))));


--
-- Name: therapists Manager can create org therapists; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Manager can create org therapists" ON public.therapists FOR INSERT TO authenticated WITH CHECK (((public.get_user_role() = ANY (ARRAY['manager'::public.user_role, 'admin'::public.user_role])) AND (EXISTS ( SELECT 1
   FROM public.branches b
  WHERE ((b.id = therapists.branch_id) AND (b.org_id = public.get_user_org_id()))))));


--
-- Name: therapist_attendance Manager can create own org therapist attendance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Manager can create own org therapist attendance" ON public.therapist_attendance FOR INSERT TO authenticated WITH CHECK (((public.get_user_role() = ANY (ARRAY['manager'::public.user_role, 'admin'::public.user_role])) AND (EXISTS ( SELECT 1
   FROM public.branches b
  WHERE ((b.id = therapist_attendance.branch_id) AND (b.org_id = public.get_user_org_id())))) AND ((branch_id = public.get_user_branch_id()) OR (public.get_user_role() = 'admin'::public.user_role))));


--
-- Name: rooms Manager can delete org rooms; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Manager can delete org rooms" ON public.rooms FOR DELETE TO authenticated USING (((public.get_user_role() = ANY (ARRAY['manager'::public.user_role, 'admin'::public.user_role])) AND (EXISTS ( SELECT 1
   FROM public.branches b
  WHERE ((b.id = rooms.branch_id) AND (b.org_id = public.get_user_org_id()))))));


--
-- Name: therapists Manager can delete org therapists; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Manager can delete org therapists" ON public.therapists FOR DELETE TO authenticated USING (((public.get_user_role() = ANY (ARRAY['manager'::public.user_role, 'admin'::public.user_role])) AND (EXISTS ( SELECT 1
   FROM public.branches b
  WHERE ((b.id = therapists.branch_id) AND (b.org_id = public.get_user_org_id()))))));


--
-- Name: therapist_attendance Manager can manage therapist attendance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Manager can manage therapist attendance" ON public.therapist_attendance FOR INSERT TO authenticated WITH CHECK (((public.get_user_role() = ANY (ARRAY['manager'::public.user_role, 'admin'::public.user_role])) AND ((branch_id = ANY (public.get_user_branch_ids())) OR (public.get_user_role() = 'admin'::public.user_role))));


--
-- Name: therapist_attendance Manager can mark attendance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Manager can mark attendance" ON public.therapist_attendance FOR INSERT WITH CHECK (((public.get_user_role() = 'admin'::public.user_role) OR ((public.get_user_role() = 'manager'::public.user_role) AND (branch_id = public.get_user_branch_id()))));


--
-- Name: audit_logs Manager can read branch audit logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Manager can read branch audit logs" ON public.audit_logs FOR SELECT TO authenticated USING (((public.get_user_role() = ANY (ARRAY['manager'::public.user_role, 'admin'::public.user_role])) AND ((branch_id = ANY (public.get_user_branch_ids())) OR (public.get_user_role() = 'admin'::public.user_role))));


--
-- Name: daily_reports Manager can read branch daily reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Manager can read branch daily reports" ON public.daily_reports FOR SELECT TO authenticated USING (((branch_id = ANY (public.get_user_branch_ids())) OR (public.get_user_role() = 'admin'::public.user_role)));


--
-- Name: attendance Manager can read own org attendance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Manager can read own org attendance" ON public.attendance FOR SELECT TO authenticated USING (((public.get_user_role() = ANY (ARRAY['manager'::public.user_role, 'admin'::public.user_role])) AND (EXISTS ( SELECT 1
   FROM public.branches b
  WHERE ((b.id = attendance.branch_id) AND (b.org_id = public.get_user_org_id())))) AND ((branch_id = public.get_user_branch_id()) OR (public.get_user_role() = 'admin'::public.user_role))));


--
-- Name: audit_logs Manager can read own org audit logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Manager can read own org audit logs" ON public.audit_logs FOR SELECT TO authenticated USING (((public.get_user_role() = ANY (ARRAY['manager'::public.user_role, 'admin'::public.user_role])) AND ((branch_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.branches b
  WHERE ((b.id = audit_logs.branch_id) AND (b.org_id = public.get_user_org_id()))))) AND ((branch_id IS NULL) OR (branch_id = public.get_user_branch_id()) OR (public.get_user_role() = 'admin'::public.user_role))));


--
-- Name: daily_reports Manager can read own org daily reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Manager can read own org daily reports" ON public.daily_reports FOR SELECT TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.branches b
  WHERE ((b.id = daily_reports.branch_id) AND (b.org_id = public.get_user_org_id())))) AND ((branch_id = public.get_user_branch_id()) OR (public.get_user_role() = 'admin'::public.user_role))));


--
-- Name: users Manager can read own org users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Manager can read own org users" ON public.users FOR SELECT TO authenticated USING (((org_id = public.get_user_org_id()) AND (public.get_user_role() = ANY (ARRAY['manager'::public.user_role, 'admin'::public.user_role]))));


--
-- Name: therapist_attendance Manager can update attendance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Manager can update attendance" ON public.therapist_attendance FOR UPDATE USING (((public.get_user_role() = 'admin'::public.user_role) OR ((public.get_user_role() = 'manager'::public.user_role) AND (branch_id = public.get_user_branch_id())))) WITH CHECK (((public.get_user_role() = 'admin'::public.user_role) OR ((public.get_user_role() = 'manager'::public.user_role) AND (branch_id = public.get_user_branch_id()))));


--
-- Name: rooms Manager can update branch rooms; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Manager can update branch rooms" ON public.rooms FOR UPDATE TO authenticated USING (((public.get_user_role() = 'admin'::public.user_role) OR ((public.get_user_role() = 'manager'::public.user_role) AND (branch_id = public.get_user_branch_id())))) WITH CHECK (((public.get_user_role() = 'admin'::public.user_role) OR ((public.get_user_role() = 'manager'::public.user_role) AND (branch_id = public.get_user_branch_id()))));


--
-- Name: therapists Manager can update branch therapists; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Manager can update branch therapists" ON public.therapists FOR UPDATE TO authenticated USING (((public.get_user_role() = 'admin'::public.user_role) OR ((public.get_user_role() = 'manager'::public.user_role) AND (branch_id = public.get_user_branch_id())))) WITH CHECK (((public.get_user_role() = 'admin'::public.user_role) OR ((public.get_user_role() = 'manager'::public.user_role) AND (branch_id = public.get_user_branch_id()))));


--
-- Name: rooms Manager can update org rooms; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Manager can update org rooms" ON public.rooms FOR UPDATE TO authenticated USING (((public.get_user_role() = ANY (ARRAY['manager'::public.user_role, 'admin'::public.user_role])) AND (EXISTS ( SELECT 1
   FROM public.branches b
  WHERE ((b.id = rooms.branch_id) AND (b.org_id = public.get_user_org_id())))))) WITH CHECK (((public.get_user_role() = ANY (ARRAY['manager'::public.user_role, 'admin'::public.user_role])) AND (EXISTS ( SELECT 1
   FROM public.branches b
  WHERE ((b.id = rooms.branch_id) AND (b.org_id = public.get_user_org_id()))))));


--
-- Name: therapists Manager can update org therapists; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Manager can update org therapists" ON public.therapists FOR UPDATE TO authenticated USING (((public.get_user_role() = ANY (ARRAY['manager'::public.user_role, 'admin'::public.user_role])) AND (EXISTS ( SELECT 1
   FROM public.branches b
  WHERE ((b.id = therapists.branch_id) AND (b.org_id = public.get_user_org_id())))))) WITH CHECK (((public.get_user_role() = ANY (ARRAY['manager'::public.user_role, 'admin'::public.user_role])) AND (EXISTS ( SELECT 1
   FROM public.branches b
  WHERE ((b.id = therapists.branch_id) AND (b.org_id = public.get_user_org_id()))))));


--
-- Name: therapist_attendance Manager can update own org therapist attendance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Manager can update own org therapist attendance" ON public.therapist_attendance FOR UPDATE TO authenticated USING (((public.get_user_role() = ANY (ARRAY['manager'::public.user_role, 'admin'::public.user_role])) AND (EXISTS ( SELECT 1
   FROM public.branches b
  WHERE ((b.id = therapist_attendance.branch_id) AND (b.org_id = public.get_user_org_id())))) AND ((branch_id = public.get_user_branch_id()) OR (public.get_user_role() = 'admin'::public.user_role)))) WITH CHECK (((public.get_user_role() = ANY (ARRAY['manager'::public.user_role, 'admin'::public.user_role])) AND (EXISTS ( SELECT 1
   FROM public.branches b
  WHERE ((b.id = therapist_attendance.branch_id) AND (b.org_id = public.get_user_org_id())))) AND ((branch_id = public.get_user_branch_id()) OR (public.get_user_role() = 'admin'::public.user_role))));


--
-- Name: therapist_attendance Manager can update therapist attendance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Manager can update therapist attendance" ON public.therapist_attendance FOR UPDATE TO authenticated USING (((public.get_user_role() = ANY (ARRAY['manager'::public.user_role, 'admin'::public.user_role])) AND ((branch_id = ANY (public.get_user_branch_ids())) OR (public.get_user_role() = 'admin'::public.user_role)))) WITH CHECK (((public.get_user_role() = ANY (ARRAY['manager'::public.user_role, 'admin'::public.user_role])) AND ((branch_id = ANY (public.get_user_branch_ids())) OR (public.get_user_role() = 'admin'::public.user_role))));


--
-- Name: users Managers can read branch users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can read branch users" ON public.users FOR SELECT TO authenticated USING (((public.get_user_role() = ANY (ARRAY['manager'::public.user_role, 'admin'::public.user_role])) AND ((branch_id = ANY (public.get_user_branch_ids())) OR (public.get_user_role() = 'admin'::public.user_role))));


--
-- Name: customers Managers can update branch customers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Managers can update branch customers" ON public.customers FOR UPDATE USING (((branch_id = public.get_user_branch_id()) OR (public.get_user_role() = 'admin'::public.user_role))) WITH CHECK (((branch_id = public.get_user_branch_id()) OR (public.get_user_role() = 'admin'::public.user_role)));


--
-- Name: branches Public can read active branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can read active branches" ON public.branches FOR SELECT TO anon USING ((is_active = true));


--
-- Name: organizations Public can read active organizations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can read active organizations" ON public.organizations FOR SELECT TO authenticated, anon USING ((is_active = true));


--
-- Name: services Public can read active services; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can read active services" ON public.services FOR SELECT TO anon USING ((is_active = true));


--
-- Name: industries Public can read industries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can read industries" ON public.industries FOR SELECT TO authenticated, anon USING (true);


--
-- Name: bookings Staff can create branch bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can create branch bookings" ON public.bookings FOR INSERT TO authenticated WITH CHECK (((branch_id = ANY (public.get_user_branch_ids())) OR (public.get_user_role() = 'admin'::public.user_role)));


--
-- Name: customers Staff can create customers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can create customers" ON public.customers FOR INSERT TO authenticated WITH CHECK (((branch_id = ANY (public.get_user_branch_ids())) OR (public.get_user_role() = 'admin'::public.user_role)));


--
-- Name: bookings Staff can create own org bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can create own org bookings" ON public.bookings FOR INSERT TO authenticated WITH CHECK (((EXISTS ( SELECT 1
   FROM public.branches b
  WHERE ((b.id = bookings.branch_id) AND (b.org_id = public.get_user_org_id())))) AND ((branch_id = public.get_user_branch_id()) OR (public.get_user_role() = 'admin'::public.user_role))));


--
-- Name: customers Staff can create own org customers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can create own org customers" ON public.customers FOR INSERT TO authenticated WITH CHECK ((org_id = public.get_user_org_id()));


--
-- Name: therapist_attendance Staff can read branch attendance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can read branch attendance" ON public.therapist_attendance FOR SELECT USING (((branch_id = public.get_user_branch_id()) OR (public.get_user_role() = 'admin'::public.user_role)));


--
-- Name: bookings Staff can read branch bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can read branch bookings" ON public.bookings FOR SELECT TO authenticated USING (((branch_id = ANY (public.get_user_branch_ids())) OR (public.get_user_role() = 'admin'::public.user_role)));


--
-- Name: customers Staff can read branch customers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can read branch customers" ON public.customers FOR SELECT TO authenticated USING (((branch_id = ANY (public.get_user_branch_ids())) OR (public.get_user_role() = 'admin'::public.user_role)));


--
-- Name: payments Staff can read branch payments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can read branch payments" ON public.payments FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.bookings b
  WHERE ((b.id = payments.booking_id) AND ((b.branch_id = ANY (public.get_user_branch_ids())) OR (public.get_user_role() = 'admin'::public.user_role))))));


--
-- Name: therapist_attendance Staff can read branch therapist attendance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can read branch therapist attendance" ON public.therapist_attendance FOR SELECT TO authenticated USING (((branch_id = ANY (public.get_user_branch_ids())) OR (public.get_user_role() = 'admin'::public.user_role)));


--
-- Name: bookings Staff can read own org bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can read own org bookings" ON public.bookings FOR SELECT TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.branches b
  WHERE ((b.id = bookings.branch_id) AND (b.org_id = public.get_user_org_id())))) AND ((branch_id = public.get_user_branch_id()) OR (public.get_user_role() = 'admin'::public.user_role))));


--
-- Name: customers Staff can read own org customers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can read own org customers" ON public.customers FOR SELECT TO authenticated USING ((org_id = public.get_user_org_id()));


--
-- Name: payments Staff can read own org payments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can read own org payments" ON public.payments FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.bookings bk
     JOIN public.branches b ON ((b.id = bk.branch_id)))
  WHERE ((bk.id = payments.booking_id) AND (b.org_id = public.get_user_org_id()) AND ((bk.branch_id = public.get_user_branch_id()) OR (public.get_user_role() = 'admin'::public.user_role))))));


--
-- Name: therapist_attendance Staff can read own org therapist attendance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can read own org therapist attendance" ON public.therapist_attendance FOR SELECT TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.branches b
  WHERE ((b.id = therapist_attendance.branch_id) AND (b.org_id = public.get_user_org_id())))) AND ((branch_id = public.get_user_branch_id()) OR (public.get_user_role() = 'admin'::public.user_role))));


--
-- Name: payments Staff can record own org payments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can record own org payments" ON public.payments FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.bookings bk
     JOIN public.branches b ON ((b.id = bk.branch_id)))
  WHERE ((bk.id = payments.booking_id) AND (b.org_id = public.get_user_org_id()) AND ((bk.branch_id = public.get_user_branch_id()) OR (public.get_user_role() = 'admin'::public.user_role))))));


--
-- Name: payments Staff can record payments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can record payments" ON public.payments FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.bookings b
  WHERE ((b.id = payments.booking_id) AND ((b.branch_id = ANY (public.get_user_branch_ids())) OR (public.get_user_role() = 'admin'::public.user_role))))));


--
-- Name: rooms Staff can reorder branch rooms; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can reorder branch rooms" ON public.rooms FOR UPDATE TO authenticated USING (((public.get_user_role() = 'staff'::public.user_role) AND (branch_id = public.get_user_branch_id()))) WITH CHECK (((public.get_user_role() = 'staff'::public.user_role) AND (branch_id = public.get_user_branch_id())));


--
-- Name: therapists Staff can reorder branch therapists; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can reorder branch therapists" ON public.therapists FOR UPDATE TO authenticated USING (((public.get_user_role() = 'staff'::public.user_role) AND (branch_id = public.get_user_branch_id()))) WITH CHECK (((public.get_user_role() = 'staff'::public.user_role) AND (branch_id = public.get_user_branch_id())));


--
-- Name: bookings Staff can update branch bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can update branch bookings" ON public.bookings FOR UPDATE TO authenticated USING (((branch_id = ANY (public.get_user_branch_ids())) OR (public.get_user_role() = 'admin'::public.user_role))) WITH CHECK (((branch_id = ANY (public.get_user_branch_ids())) OR (public.get_user_role() = 'admin'::public.user_role)));


--
-- Name: customers Staff can update branch customers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can update branch customers" ON public.customers FOR UPDATE TO authenticated USING (((branch_id = ANY (public.get_user_branch_ids())) OR (public.get_user_role() = 'admin'::public.user_role))) WITH CHECK (((branch_id = ANY (public.get_user_branch_ids())) OR (public.get_user_role() = 'admin'::public.user_role)));


--
-- Name: bookings Staff can update own org bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can update own org bookings" ON public.bookings FOR UPDATE TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.branches b
  WHERE ((b.id = bookings.branch_id) AND (b.org_id = public.get_user_org_id())))) AND ((branch_id = public.get_user_branch_id()) OR (public.get_user_role() = 'admin'::public.user_role)))) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.branches b
  WHERE ((b.id = bookings.branch_id) AND (b.org_id = public.get_user_org_id())))) AND ((branch_id = public.get_user_branch_id()) OR (public.get_user_role() = 'admin'::public.user_role))));


--
-- Name: customers Staff can update own org customers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can update own org customers" ON public.customers FOR UPDATE TO authenticated USING ((org_id = public.get_user_org_id())) WITH CHECK ((org_id = public.get_user_org_id()));


--
-- Name: attendance Users can check in own org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can check in own org" ON public.attendance FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.branches b
  WHERE ((b.id = attendance.branch_id) AND (b.org_id = public.get_user_org_id()))))));


--
-- Name: attendance Users can check out; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can check out" ON public.attendance FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: branches Users can read branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read branches" ON public.branches FOR SELECT TO authenticated USING (((org_id = public.get_user_org_id()) OR (is_active = true)));


--
-- Name: organizations Users can read organizations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read organizations" ON public.organizations FOR SELECT TO authenticated USING (((id = public.get_user_org_id()) OR (is_active = true)));


--
-- Name: attendance Users can read own attendance; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own attendance" ON public.attendance FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: user_branches Users can read own branch grants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own branch grants" ON public.user_branches FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: service_categories Users can read own org categories; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own org categories" ON public.service_categories FOR SELECT TO authenticated USING ((org_id = public.get_user_org_id()));


--
-- Name: membership_transactions Users can read own org membership transactions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own org membership transactions" ON public.membership_transactions FOR SELECT TO authenticated USING ((org_id = public.get_user_org_id()));


--
-- Name: memberships Users can read own org memberships; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own org memberships" ON public.memberships FOR SELECT TO authenticated USING ((org_id = public.get_user_org_id()));


--
-- Name: rooms Users can read own org rooms; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own org rooms" ON public.rooms FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.branches b
  WHERE ((b.id = rooms.branch_id) AND (b.org_id = public.get_user_org_id())))));


--
-- Name: services Users can read own org services; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own org services" ON public.services FOR SELECT TO authenticated USING ((org_id = public.get_user_org_id()));


--
-- Name: therapists Users can read own org therapists; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own org therapists" ON public.therapists FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.branches b
  WHERE ((b.id = therapists.branch_id) AND (b.org_id = public.get_user_org_id())))));


--
-- Name: staff_transfers Users can read own org transfers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own org transfers" ON public.staff_transfers FOR SELECT TO authenticated USING ((org_id = public.get_user_org_id()));


--
-- Name: users Users can read own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own profile" ON public.users FOR SELECT TO authenticated USING ((id = auth.uid()));


--
-- Name: services Users can read services; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read services" ON public.services FOR SELECT TO authenticated USING (((org_id = public.get_user_org_id()) OR (is_active = true)));


--
-- Name: notifications Users read own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users read own notifications" ON public.notifications FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: notifications Users update own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users update own notifications" ON public.notifications FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: bookings anon_insert_bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_insert_bookings ON public.bookings FOR INSERT TO anon WITH CHECK (true);


--
-- Name: customers anon_insert_customers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_insert_customers ON public.customers FOR INSERT TO anon WITH CHECK (true);


--
-- Name: bookings anon_select_bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_select_bookings ON public.bookings FOR SELECT TO anon USING (true);


--
-- Name: customers anon_select_customers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_select_customers ON public.customers FOR SELECT TO anon USING (true);


--
-- Name: attendance; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: backup_20260613_bookings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.backup_20260613_bookings ENABLE ROW LEVEL SECURITY;

--
-- Name: backup_20260613_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.backup_20260613_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: booking_therapists; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.booking_therapists ENABLE ROW LEVEL SECURITY;

--
-- Name: booking_therapists booking_therapists_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY booking_therapists_delete ON public.booking_therapists FOR DELETE TO authenticated USING (true);


--
-- Name: booking_therapists booking_therapists_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY booking_therapists_insert ON public.booking_therapists FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: booking_therapists booking_therapists_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY booking_therapists_select ON public.booking_therapists FOR SELECT TO authenticated USING (true);


--
-- Name: bookings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

--
-- Name: branches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_merge_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customer_merge_log ENABLE ROW LEVEL SECURITY;

--
-- Name: customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

--
-- Name: daily_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.daily_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: industries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.industries ENABLE ROW LEVEL SECURITY;

--
-- Name: membership_tiers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.membership_tiers ENABLE ROW LEVEL SECURITY;

--
-- Name: membership_transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.membership_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: memberships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

--
-- Name: payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

--
-- Name: payroll_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payroll_items ENABLE ROW LEVEL SECURITY;

--
-- Name: payroll_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: rooms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

--
-- Name: schema_migrations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: service_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: services; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

--
-- Name: staff_compensation; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.staff_compensation ENABLE ROW LEVEL SECURITY;

--
-- Name: staff_transfers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.staff_transfers ENABLE ROW LEVEL SECURITY;

--
-- Name: therapist_attendance; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.therapist_attendance ENABLE ROW LEVEL SECURITY;

--
-- Name: therapists; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.therapists ENABLE ROW LEVEL SECURITY;

--
-- Name: user_branches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_branches ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: messages; Type: ROW SECURITY; Schema: realtime; Owner: -
--

ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: objects Admin and Manager can delete service images; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Admin and Manager can delete service images" ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'service-images'::text) AND (EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND (users.role = ANY (ARRAY['admin'::public.user_role, 'manager'::public.user_role])))))));


--
-- Name: objects Admin and Manager can update service images; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Admin and Manager can update service images" ON storage.objects FOR UPDATE TO authenticated USING (((bucket_id = 'service-images'::text) AND (EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND (users.role = ANY (ARRAY['admin'::public.user_role, 'manager'::public.user_role])))))));


--
-- Name: objects Admin and Manager can upload service images; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Admin and Manager can upload service images" ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'service-images'::text) AND (EXISTS ( SELECT 1
   FROM public.users
  WHERE ((users.id = auth.uid()) AND (users.role = ANY (ARRAY['admin'::public.user_role, 'manager'::public.user_role])))))));


--
-- Name: objects Public can view service images; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Public can view service images" ON storage.objects FOR SELECT USING ((bucket_id = 'service-images'::text));


--
-- Name: buckets; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets_analytics; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.buckets_analytics ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets_vectors; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.buckets_vectors ENABLE ROW LEVEL SECURITY;

--
-- Name: migrations; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: objects; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

--
-- Name: s3_multipart_uploads; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.s3_multipart_uploads ENABLE ROW LEVEL SECURITY;

--
-- Name: s3_multipart_uploads_parts; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.s3_multipart_uploads_parts ENABLE ROW LEVEL SECURITY;

--
-- Name: vector_indexes; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.vector_indexes ENABLE ROW LEVEL SECURITY;

--
-- Name: supabase_realtime; Type: PUBLICATION; Schema: -; Owner: -
--

CREATE PUBLICATION supabase_realtime WITH (publish = 'insert, update, delete, truncate');


--
-- Name: supabase_realtime_messages_publication; Type: PUBLICATION; Schema: -; Owner: -
--

CREATE PUBLICATION supabase_realtime_messages_publication WITH (publish = 'insert, update, delete, truncate');


--
-- Name: supabase_realtime bookings; Type: PUBLICATION TABLE; Schema: public; Owner: -
--

ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.bookings;


--
-- Name: supabase_realtime notifications; Type: PUBLICATION TABLE; Schema: public; Owner: -
--

ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.notifications;


--
-- Name: supabase_realtime_messages_publication messages; Type: PUBLICATION TABLE; Schema: realtime; Owner: -
--

ALTER PUBLICATION supabase_realtime_messages_publication ADD TABLE ONLY realtime.messages;


--
-- Name: issue_graphql_placeholder; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER issue_graphql_placeholder ON sql_drop
         WHEN TAG IN ('DROP EXTENSION')
   EXECUTE FUNCTION extensions.set_graphql_placeholder();


--
-- Name: issue_pg_cron_access; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER issue_pg_cron_access ON ddl_command_end
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION extensions.grant_pg_cron_access();


--
-- Name: issue_pg_graphql_access; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER issue_pg_graphql_access ON ddl_command_end
         WHEN TAG IN ('CREATE FUNCTION')
   EXECUTE FUNCTION extensions.grant_pg_graphql_access();


--
-- Name: issue_pg_net_access; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER issue_pg_net_access ON ddl_command_end
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION extensions.grant_pg_net_access();


--
-- Name: pgrst_ddl_watch; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER pgrst_ddl_watch ON ddl_command_end
   EXECUTE FUNCTION extensions.pgrst_ddl_watch();


--
-- Name: pgrst_drop_watch; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER pgrst_drop_watch ON sql_drop
   EXECUTE FUNCTION extensions.pgrst_drop_watch();


--
-- PostgreSQL database dump complete
--

\unrestrict zS5LwiFkP1hiCMjOiVDE7bTfwxB5n9s6a8VyCUroQ33foyahNOC3nRYrbecUain

