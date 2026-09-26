# RLS Plan Complexity

## The problem

Every *new* PostgREST connection to production pays a large cold-planning cost the first time
it runs a query against an RLS-protected table. Measured on production on 2026-09-26, same
query, same session:

| call | time |
|---|---|
| 1st (cold plan) | 4200ms |
| 2nd (warm) | 150ms |
| 3rd (warm) | 168ms |

A warm `count(*)` on `bookings` as `authenticated`: 88ms planning + 279ms execution.

This is triggered by **anything that recycles PostgREST's connection pool**: a schema
migration, a PostgREST restart, a Supabase-side service restart, or ordinary pool churn under
load. Migration 227 (2026-09-26) terminated idle `authenticator` connections so PostgREST would
reopen them under a new 5s `idle_in_transaction_session_timeout` — it worked exactly as
intended, but every reopened connection then re-planned cold, and the staff dashboard (which
fans out ~10 parallel queries per page load) showed empty skeleton loaders for minutes while the
pool recycled. Today this was self-inflicted and one-time. Next time — an unannounced Supabase
maintenance restart, a PostgREST OOM, ordinary load-driven pool churn — it may not be.

## Why the plan is so large

Policy census, measured on production 2026-09-26:

| table | policies |
|---|---|
| bookings | 10 |
| therapists | 9 |
| rooms | 9 |
| services | 8 |
| payments | 5 |
| users | 4 |
| branches | 4 |
| organizations | 3 |
| customer_accounts | 2 |

The staff dashboard's calendar query joins `bookings` + `services` + `therapists` + `rooms` +
`payments` = **41 policies** in play. Postgres ORs together all permissive policies on a table,
and — this is the multiplier — several of those policies contain subqueries against **other
RLS-protected tables**, e.g.:

```sql
EXISTS (
  SELECT 1 FROM branches b
  WHERE b.id = bookings.branch_id
    AND b.org_id = (SELECT get_user_org_id())
)
```

Referencing `branches` inside a `bookings` policy expands `branches`' own 4 policies inline,
which in turn reference `organizations` and `customer_accounts`, which have their own policies,
and so on recursively. That recursion is what produces a calendar query plan with ~671 nodes,
325+ nested InitPlans/SubPlans, and plan aliases reaching `customer_accounts_34` — one table's
policy set expanded 30+ times inside a single query.

## Two candidate remedies (neither implemented yet)

1. **Replace nested protected-table subqueries with `SECURITY DEFINER` helpers.** This is the
   structural fix and likely the bigger win. A helper such as
   `user_can_access_branch(branch_id uuid)` marked `STABLE SECURITY DEFINER` performs the
   branch/org check **without** triggering `branches`' own RLS, so the calling policy collapses
   to `(SELECT user_can_access_branch(branch_id))` — one InitPlan, no recursive expansion of
   `branches`/`organizations`/`customer_accounts` underneath it. This is the same pattern already
   used successfully by `get_user_role()` / `get_user_org_id()` / `get_user_branch_ids()`.

   Security note: a `SECURITY DEFINER` function bypasses RLS on every table its body touches, so
   the body itself must be written to be safe standing alone (no trusting caller-supplied
   identifiers into dynamic SQL, no re-exposing rows the caller shouldn't see), and its
   `search_path` must be pinned (e.g. `SET search_path = public, pg_temp`) to prevent search-path
   hijacking of a definer-rights function.

2. **Consolidate overlapping permissive policies.** `bookings` has 4 SELECT policies for
   `authenticated` plus one with `roles = {public}` (which therefore also applies to
   authenticated users) — several overlap heavily, e.g. "Staff can read branch bookings" vs
   "Staff can read own org bookings". Fewer, broader policies mean a smaller OR-tree per table.
   Lower risk than (1) but a smaller win, since it doesn't address the cross-table recursion.
   Any consolidation changes access semantics and needs careful review — run it through
   `scripts/check-rls-initplan.sh` plus a principal-by-principal access comparison before and
   after, not just a plan-size check.

## Why this was not fixed today

It was explicitly called out as out of scope in
`docs/superpowers/specs/2026-09-26-prod-transient-db-resilience-design.md`; that design's final
review flagged it as "a latent planning-time risk worth its own investigation." It stopped being
latent on 2026-09-26, when migration 227's connection-recycling exposed it in production.

## How to verify any future fix

Measure cold vs. warm plan cost in one psql session:

```sql
SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"<a real user uuid>","role":"authenticated"}',true);
EXPLAIN (ANALYZE, SUMMARY) SELECT count(*) FROM bookings WHERE date >= current_date - 7;
```

The first run in a **fresh** connection gives the cold number; running the same statement again
in the *same* session gives the warm number. Today's baseline: **4200ms cold / ~150ms warm**
overall, and **88ms planning / 279ms execution** warm for the `count(*)` query above. Any real
fix must move the cold number materially, not just the warm one — the warm number was never the
problem.

**Safety requirement for any policy rewrite:** validate with a principal-by-principal access
comparison before and after. The 2026-09-25 sweep used 336 comparisons across 56 tables × 6
principals and found 0 mismatches — that's the bar. A plan-complexity optimization that silently
changes who can see what is a materially worse outcome than the slow queries it was meant to fix.
