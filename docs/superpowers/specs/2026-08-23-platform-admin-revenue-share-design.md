# Platform Admin & Cross-Tenant Revenue Share — Design Spec

**Date:** 2026-08-23
**Status:** Approved, pending implementation plan

## Problem

Zenly has revenue-share deals with some clients (e.g. n% of every sale from Nuad Thai Spa). There is
currently no way to see sales across tenants in one place, no way to configure a commission rate per
org, and no credential that can see more than one org — every login is strictly 1 user : 1 org
(`users.org_id NOT NULL`, `public.get_user_org_id()`, RLS scoped per-org). Nothing has been collected
yet; the first requirement is visibility — a single super-admin credential that shows, per client, how
much has been sold and what the commission would be, retroactive to whenever the deal's rate takes
effect.

## Constraint that shaped this design

Every table in this codebase is `org_id`-scoped and every RLS policy assumes a single-org user via
`get_user_org_id()`. There is no existing platform-level role. Two ways to get cross-org access:
loosen RLS broadly across every sensitive table (bookings, payments, staff, settings), or keep RLS
untouched and choke-point cross-org reads through `SECURITY DEFINER` functions. This design uses the
latter for anything money-related (rollup, commission math) — smaller blast radius, single audit
point, no regression risk to existing tenant RLS. It adds a narrow, read-only RLS exception on exactly
three tables (`bookings`, `payments`, `services`) to support drilling into a specific booking, since
writing a bespoke RPC for every future drill-in view isn't worth the rigidity.

## Identity: `platform_admins`

```sql
CREATE TABLE public.platform_admins (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid());
$$;
```

No `org_id` column anywhere on this table or its user row — that absence is what makes a credential
"platform-wide" rather than tenant-scoped. RLS on `platform_admins` itself: no policies at all (nobody
reads/writes it except via `SECURITY DEFINER` functions) — deny-by-default.

The "one super admin credential" is one `auth.users` row + one `platform_admins` row. Adding a second
later is one more row; no schema change.

## Login

New route `/platform/login`, plain email+password (no PIN, no org slug — there is no org). New
`PlatformAuthContext`, entirely separate from `AuthContext` → `OrgContext` → `BranchContext` — a
platform-admin session never enters the org-scoped provider tree, and an org-scoped session never sees
`/platform/*`.

After Supabase auth succeeds, the frontend calls `is_platform_admin()` (RPC) before treating the
session as valid for `/platform/*`; a non-platform-admin who somehow has valid Supabase credentials
still gets rejected. This is defense in depth on top of RLS, not a replacement for it.

On success, lands on `/platform/dashboard`.

## Commission schema

```sql
CREATE TABLE public.org_commission_rates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(id),
  rate_percent   numeric(5,2) NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
  effective_from date NOT NULL,
  effective_to   date,                    -- NULL = currently active
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL REFERENCES auth.users(id),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE TABLE public.org_commission_collections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id),
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  amount_collected numeric(10,2) NOT NULL,
  collected_at    date NOT NULL,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL REFERENCES auth.users(id),
  CHECK (period_end >= period_start)
);
```

- `org_commission_rates` rows are immutable history, same posture as `payments`: no UPDATE/DELETE
  policy. Renegotiating a rate = an RPC that closes the current open row (`effective_to = new rate's
  effective_from - 1`) and inserts a new one in the same transaction — never edits a past row.
- A new rate's `effective_from` must be after the previously-open row's `effective_from` (enforced in
  the RPC, not just the CHECK) — prevents overlapping/ambiguous periods, which would double- or
  under-count commission.
- `org_commission_collections` is an append-only manual ledger: "we invoiced/were paid X for period
  [start, end]". No UPDATE/DELETE policy either — a correction is a new row (possibly negative
  `amount_collected` as an adjustment), not an edit.
- RLS on both tables: **no policy grants `org_id`-scoped users (including that org's own admin)
  access** — clients must not see the cut being taken from them. All reads/writes go through
  `SECURITY DEFINER` RPCs gated on `is_platform_admin()`.

## Revenue rollup (RPC, `SECURITY DEFINER`)

```
platform_get_revenue_rollup(p_from date, p_to date)
  → per org: { org_id, org_name,
               revenue_by_category: [{category, gross}],
               revenue_by_branch:   [{branch_id, branch_name, gross}],
               gross_total,
               active_rate_percent,          -- null if none configured
               commission_for_range,         -- null if no rate active for any part of range
               commission_owed_to_date,      -- sum over full rate history, effective_from → today
               collected_to_date,            -- sum(org_commission_collections.amount_collected)
               net_owed }                    -- commission_owed_to_date - collected_to_date
```

- Raises an exception if `is_platform_admin()` is false — checked first, before touching any tenant
  table.
- Reuses the existing cash-basis definition (`payment_status = 'paid'`, per CLAUDE.md's reconciliation
  rule) — same semantics as `getRevenueForPeriod()` / `computeRevenueForRange()` in `services/api.js`,
  just aggregated across every org in one query instead of one org at a time.
- Commission math handles rate changes mid-range correctly: for each rate-history row that overlaps
  `[p_from, p_to]`, compute `revenue(overlap) * rate_percent`, then sum. `commission_owed_to_date` runs
  the same logic over `[effective_from of first rate row, today]`, independent of the dashboard's
  selected range.
- If an org has no commission rate row at all, `active_rate_percent`/`commission_for_range`/
  `commission_owed_to_date` are `null` (not `0`) — the UI must render "not configured", never a bare
  $0, so it's never misread as "deal exists, currently zero."
- One RPC call powers the whole dashboard table — no N+1 looping per org from the frontend.

## Drill-in (narrow RLS exception)

Add `OR public.is_platform_admin()` to the existing SELECT policies on exactly:

- `bookings`
- `payments`
- `services`

Nothing else. No write policy on any table gets this exception; no other table (`users`, `branches`,
settings tables, staff PII) gets it either. A platform admin can open an org's booking/payment list for
a date range and see the same line items an org admin would see in their own reports, but cannot edit
a booking, see staff records, or touch settings for any tenant.

## UI / pages

- `/platform/login` — plain login form.
- `/platform/dashboard` — one row per org: gross revenue (selected range), category/branch breakdown
  toggle, active rate %, commission for range, commission owed to date, collected to date, net owed.
  Global date-range picker at top (defaults to current month).
- `/platform/dashboard/:orgId` — drill-in:
  - Rate history list + "new rate" action (invokes the close-old/open-new RPC).
  - Collection log + "record collection" action (insert into `org_commission_collections`).
  - Read-only booking/payment table for the selected range (via the drill-in RLS exception) — same
    data shape as an org's own reports, no edit affordances.
- Own minimal nav (Dashboard, org drill-ins, logout) — does not reuse `StaffSidebar`, since no
  org-scoped nav item applies to a platform admin.

## Error handling & edge cases

- No commission rate configured → rollup shows revenue, commission fields `null` → "not configured" in
  UI (see above).
- Overlapping rate periods → rejected at the RPC layer (new `effective_from` must be after the
  currently-open row's `effective_from`), not just relying on the CHECK constraint, so the error
  message can be specific.
- Collections exceeding computed owed (overpayment, correction) → allowed; `net_owed` can go negative;
  dashboard displays it as-is, no hard block.
- Non-platform-admin hitting `/platform/login` with valid Supabase credentials → rejected client-side
  after auth (via `is_platform_admin()` check) in addition to being unable to read anything server-side
  (no RLS grants for a non-platform-admin on the new tables or the RPCs).

## Testing

No test runner in this repo (per CLAUDE.md) — validation is `npm run build` plus a manual staging
walkthrough:

1. Seed a `platform_admins` row for a test user; confirm `/platform/login` works for it and rejects an
   ordinary staging staff/admin login.
2. Create two overlapping `org_commission_rates` periods for a test org via direct SQL — confirm the
   RPC path (not raw insert) rejects it; confirm two *non*-overlapping periods compute correctly against
   a hand-calculated number.
3. Record a collection larger than owed-to-date; confirm `net_owed` goes negative and renders without
   erroring.
4. As an org-scoped admin (not platform admin), confirm `org_commission_rates` /
   `org_commission_collections` are unreadable, and confirm another org's `bookings`/`payments` are
   still unreadable (the drill-in RLS exception must not leak between ordinary org sessions — it only
   fires for `is_platform_admin()`).
5. Spot-check `platform_get_revenue_rollup()` totals against the existing per-org `getRevenueForPeriod()`
   output for one known org/date-range, to confirm the aggregation didn't drift from the cash-basis
   definition already in use.
