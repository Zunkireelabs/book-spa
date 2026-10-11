-- Migration 262: drop the stale 6-arg enroll_member overload (additive to schema,
-- REVERSIBLE)
--
-- Production incident 2026-10-11 from a client report: staff could not issue a new
-- membership. Reproduced directly against prod: public.enroll_member exists as TWO
-- overloads --
--   enroll_member(uuid, uuid, numeric, text, text, uuid)               -- migration-156
--   enroll_member(uuid, uuid, numeric, text, text, uuid, date)         -- migration-234
-- migration-234 added the p_activation_date param via `CREATE OR REPLACE FUNCTION`
-- with a NEW 7-arg signature instead of first dropping migration-156's 6-arg one (the
-- way migration-156 itself correctly dropped migration-045's 5-arg predecessor before
-- creating its replacement). CREATE OR REPLACE only replaces a function with the exact
-- same argument list; a different arity creates an additional overload instead.
--
-- Any caller that invokes enroll_member without explicitly naming p_activation_date
-- (e.g. positional-argument callers, or any lingering stale client that predates
-- migration-234 and doesn't send that key) hits Postgres function-overload resolution
-- ambiguity:
--   ERROR: function enroll_member(uuid, uuid, numeric, text, unknown) is not unique
-- surfaced to staff as a raw, confusing enrollment failure.
--
-- Verified via direct psql reproduction against production (rolled back, no data
-- changed): a positional 4-arg + defaults call failed with "is not unique"; the
-- intended named-argument call (what the current frontend sends) resolves correctly to
-- the 7-arg version. The ambiguity is a latent landmine for any other/older caller
-- rather than the literal call path the current build uses -- but it is a real,
-- reproducible break with no legitimate reason to keep the old signature alive.
--
-- Idempotent: DROP FUNCTION IF EXISTS.
-- Reversible (manual): re-run migration-156's enroll_member CREATE OR REPLACE block
-- (6-arg version) -- not expected to ever be needed, since the 7-arg version is a
-- strict superset (p_activation_date defaults to NULL, i.e. identical behavior to the
-- 6-arg path).

BEGIN;

DROP FUNCTION IF EXISTS public.enroll_member(uuid, uuid, numeric, text, text, uuid);

INSERT INTO public.schema_migrations (version, name)
VALUES ('262', 'fix-enroll-member-overload-ambiguity')
ON CONFLICT (version) DO NOTHING;

COMMIT;
