-- Migration 231: codify the per-role `statement_timeout` values that
-- production has been running since the 2026-09-26 incident, so they survive
-- a role reset and stop being invisible, hand-typed state.
--
-- Idempotent: ALTER ROLE ... SET is last-write-wins, safe to re-run.
-- Reversible (manual):
--   ALTER ROLE authenticator  SET statement_timeout = '8s';
--   ALTER ROLE authenticated  SET statement_timeout = '8s';
--   ALTER ROLE anon           SET statement_timeout = '3s';
--
-- Applied: stage <pending> / prod <pending — but see "no-op on prod" below>.
--
--
-- Why this migration exists
--
-- During the 2026-09-26 lockout a human raised `statement_timeout` on
-- production directly, via the dashboard, to stop requests being killed
-- mid-flight while the database was CPU-saturated. It worked and it stayed.
-- But `ALTER ROLE ... SET` is per-role state that lives only in
-- `pg_roles.rolconfig` — it is not in this repo, not in the ledger, and not
-- reproducible. Anything that resets or recreates those roles (a Supabase
-- platform operation, a project restore, a support action) silently reverts
-- them to the 8s/3s defaults, and the first symptom would be customer-facing
-- 57014 `canceling statement due to statement timeout` errors with no commit
-- to point at. This is the same failure class as the 2026-06-13 incident
-- (migrations 038-041 applied to main but never to prod): DB state that no
-- file describes cannot be verified, promoted, or rolled back.
--
--
-- Measured state before this migration (2026-09-28, read-only psql)
--
--   role            stage    prod
--   authenticator   8s       30s
--   authenticated   8s       30s
--   anon            3s       3s
--   service_role    (none)   (none)
--
-- So this migration is a **no-op on production** — it writes back the values
-- prod already holds — and a **real change on staging**, which it raises from
-- 8s to 30s. That direction is deliberate: staging should reproduce
-- production's timeout behavior, not a stricter one. A load test that passes
-- on staging under an 8s ceiling tells us nothing about a prod running 30s.
--
--
-- Why 30s, and why it is a ceiling to lower rather than a target
--
-- 30s is not an engineering choice. It is the number that stopped the
-- bleeding on a saturated t4g.nano, kept because it is proven rather than
-- because it is right. A 30-second ceiling means a single pathological query
-- can hold a PostgREST pool connection for half a minute; at MICRO's
-- connection count that is a meaningful share of the pool. The correct fix is
-- the one migration 228's header already names: reduce the RLS plan
-- complexity (671-node plans, 325+ nested InitPlans) so queries finish well
-- inside 8s again, then lower this back. Ordering matters — lowering the
-- timeout before the plan cost is addressed is how 226 turned a tuning change
-- into an incident.
--
-- Do NOT lower `authenticator` or `authenticated` below 30s until that work
-- lands and business-hours measurement confirms it. See
-- `docs/superpowers/specs/2026-09-27-perf-audit.md`.
--
--
-- Why `anon` stays at 3s
--
-- `anon` is the public customer booking flow (`/:orgSlug/book`) and is the
-- only role reachable without authentication. 3s is intentionally tight: it
-- bounds what an unauthenticated caller can make this database spend, and
-- every query on that path is meant to be a narrow indexed read. Both
-- databases already agree on 3s, so this line is pure documentation — it is
-- written explicitly so that a future reader sees 3s was chosen, not
-- inherited by accident, and so a role reset restores 3s rather than the
-- platform default.
--
--
-- Why `service_role` is left alone
--
-- `service_role` bypasses RLS and is used only server-side (Edge Functions).
-- It has no role-level timeout today and this migration does not add one:
-- giving it a ceiling here would silently cap long-running maintenance and
-- backfill work that legitimately runs longer than any request-path query,
-- and those callers should set their own timeout deliberately rather than
-- inherit a request-shaped one.
--
--
-- What this does NOT do
--
-- This does not change any already-open session. `ALTER ROLE ... SET` applies
-- at session start, so existing PostgREST pool connections keep whatever
-- value they started with until they cycle through ordinary pool churn. That
-- is fine and intended here, because the values this writes are what prod
-- sessions already have. Do NOT add a `pg_terminate_backend` recycle to force
-- it — that is the migration-227 pattern that forced a simultaneous cold
-- re-plan across the whole pool and turned a tuning change into an outage.

BEGIN;

ALTER ROLE authenticator SET statement_timeout = '30s';
ALTER ROLE authenticated SET statement_timeout = '30s';
ALTER ROLE anon          SET statement_timeout = '3s';

INSERT INTO public.schema_migrations (version, name)
VALUES ('231', 'codify-role-statement-timeouts')
ON CONFLICT (version) DO NOTHING;

COMMIT;
