-- Migration 338: restore missing GRANT SELECT on public.users (additive, REVERSIBLE)
--
-- Root cause of staff/admin login appearing to silently fail after PIN verification
-- succeeds: the browser console showed
--   GET .../rest/v1/users?select=*,branches... -> 403 permission denied for table users
-- "permission denied for table X" is PostgREST's GRANT-layer error, not an RLS denial (RLS
-- denial returns zero rows, or 42501 on write) -- so this is a missing table-level privilege,
-- not a missing/misconfigured policy.
--
-- Confirmed on staging (read-only inspection, nothing applied there yet):
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--   WHERE table_schema='public' AND table_name='users';
-- `users` has INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER for both `anon` and
-- `authenticated`, but NOT SELECT for either. Compared against `branches` and
-- `organizations` -- both structurally similar, RLS-enabled tables that work correctly from
-- the client -- which both carry the full set INCLUDING SELECT for `authenticated` (and
-- `anon`, for their own public-read cases). `users` is missing exactly one privilege that
-- every comparable table has.
--
-- This is the same class of gap as migration-013/337: a hand-applied grant (or a REVOKE that
-- was never paired with a follow-up GRANT once RLS policies were written) that exists
-- correctly on some environments and not others, never captured as a tracked migration.
--
-- NOT an "RLS has no SELECT policy either" situation -- checked that explicitly before
-- proposing this, since fixing only the grant in that case would just convert the 403 into an
-- empty 200 and the same login redirect loop. `pg_policy` on `users` already has a correct,
-- narrow SELECT policy set for `authenticated`:
--   "Users can read own profile"       -- id = auth.uid()            <- what AuthContext's
--                                                                        fetchProfile(userId)
--                                                                        actually needs
--   "Staff can read branch users"      -- role=staff AND branch_id IN own branches
--   "Manager can read own org users"   -- role IN (manager,admin) AND org_id = own org
--   "Admin viewer can read org users"  -- role=admin_viewer AND org_id = own org
-- All four are scoped correctly (self, own branch, or own org -- never cross-org). No policy
-- targets `anon` at all, so `anon` gets no SELECT grant here either: there is no legitimate
-- anon read case for staff records, and granting it would be privilege with nothing to use it
-- correctly -- better to not create the surface at all than rely on "no matching policy"
-- being the only thing stopping it.
--
-- Idempotent: GRANT is naturally idempotent (re-running it changes nothing if already
-- granted).
-- Reversible (manual):
--   REVOKE SELECT ON public.users FROM authenticated;
-- (Not recommended -- this would restore the exact bug this migration fixes.)

GRANT SELECT ON public.users TO authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES ('338', 'users-select-grant')
ON CONFLICT (version) DO NOTHING;
