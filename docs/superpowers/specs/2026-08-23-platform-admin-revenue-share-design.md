# Platform Admin & Cross-Tenant Revenue Share — Design Spec

**Date:** 2026-08-23
**Status:** Revised after gap review (drawer-basis sales, session isolation, VAT basis) — pending re-approval before implementation plan

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

New route `/platform/login`, plain email+password (no PIN, no org slug — there is no org).

**Session isolation is mandatory, not cosmetic.** There is one Supabase project (one URL + anon key),
and `AuthContext`'s `supabase.auth.onAuthStateChange` listener is mounted at the app root for *every*
route (`App.jsx` → `AuthProvider`). If a platform admin signs in on the shared default client, that
listener fires, tries to fetch a `public.users` profile row for the admin's uid (which does not exist —
a platform admin has no org row), sets `profile = null`, and `ProtectedRoute` bounces to `/login` — a
guaranteed login-loop. The codebase already solves exactly this for the customer portal:
`src/lib/supabase.js` runs a **second isolated client** `supabaseCustomer` with its own
`storageKey: 'zenly-customer-auth'`. Platform admin gets a **third** client:

```js
// src/lib/supabase.js
export const supabasePlatform = createClient(URL, ANON_KEY, {
  auth: { storageKey: 'zenly-platform-auth', persistSession: true, autoRefreshToken: true },
});
```

`PlatformAuthContext` uses **only** `supabasePlatform` — its session lives under a separate storage key,
so signing in as a platform admin never triggers the staff `AuthContext` listener, and vice versa. The
two contexts cannot see each other's sessions. `/platform/*` routes are guarded by a dedicated
`ProtectedPlatformRoute` (checks `PlatformAuthContext`, not the org `ProtectedRoute`), and the staff
`/login` / OrgFinder routes must not match `/platform/login`.

After `supabasePlatform` auth succeeds, the frontend calls `is_platform_admin()` (RPC, via the platform
client) before treating the session as valid; a non-platform-admin who somehow has valid Supabase
credentials still gets rejected. Defense in depth on top of RLS, not a replacement for it.

On success, lands on `/platform/dashboard`.

## Commission schema

```sql
CREATE TYPE public.commission_basis AS ENUM ('vat_inclusive', 'vat_exclusive');

CREATE TABLE public.org_commission_rates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(id),
  rate_percent   numeric(5,2) NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
  commission_basis public.commission_basis NOT NULL,
  vat_rate_percent numeric(5,2) NOT NULL DEFAULT 13.00 CHECK (vat_rate_percent >= 0),
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

- `commission_basis` is per rate-period, not a global org setting — Nuad Thai's deal is "commission on
  VAT-inclusive sales" while another client might be "VAT-exclusive," and a renegotiation could change
  the basis alongside the rate. All recorded amounts (booking `final_amount`, voucher `actual_price`,
  membership deposit `amount`) are what the customer actually paid, VAT already baked in — there is no
  separate VAT column anywhere in the schema. `vat_rate_percent` (default 13%, Nepal's standard rate) is
  only used when `commission_basis = 'vat_exclusive'`, to back VAT out of the **entire sales base**
  (defined in "Commission base" below) before applying `rate_percent`: `base / (1 + vat_rate_percent/100)`.
  When `commission_basis = 'vat_inclusive'`, `rate_percent` applies to the sales base directly and
  `vat_rate_percent` is unused.
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

## Commission base — "total sales, counted once" (drawer basis)

"Sales" for commission is **every rupee of real customer money the org took in, counted exactly once**.
Because voucher and membership wallets decouple *when cash arrives* (top-up) from *when a service is
delivered* (a wallet-funded booking), a naive `SUM(bookings.final_amount)` both misses the top-up cash
and double-counts the wallet redemption. The base is therefore the sum of three non-overlapping
components, each bucketed by its own Nepal-local calendar date (no timezone conversion — these are all
`date` columns or `::date` casts):

1. **Non-wallet booking payments** — real cash/card/eSewa/Khalti/etc. collected against services.
   Computed at the **`payments` grain, not booking grain**, because a booking can be split-tendered
   (e.g. part `VoucherWallet`, part `Cash`) and only the non-wallet part is new money:
   `SUM(payments.amount)` for payments whose `payment_mode NOT IN
   ('Membership','ReferralWallet','VoucherWallet','ReferralVoucher')`, joined to a booking whose
   `payment_status = 'paid'` (excludes refunded — refunds flip status, giving the "current truth,
   refunds excluded" basis you chose) and whose `date` falls in the range. Attributed to the booking's
   single `service.category` and its `branch_id`.
2. **Voucher sales** — `SUM(vouchers.actual_price)` (the money paid to buy the voucher, already net of
   any issue discount) for vouchers whose `issued_date` is in range, excluding cancelled/voided
   vouchers. Has `branch_id`. Bucketed under a synthetic category `"Voucher sales"`.
   *Interim source:* `voucher_payments` (from the 2026-08-20 voucher-payment spec) does **not exist
   yet** — `vouchers.actual_price`/`issued_date` is the correct money+date source today. If/when
   `voucher_payments` ships, switch this component to `SUM(voucher_payments.amount)` for exact tender
   fidelity; the rollup total is unaffected in the common single-tender case.
3. **Membership deposits** — `SUM(membership_transactions.amount)` where `kind = 'deposit'` (positive
   cash top-ups only; `deduction`/`birthday_perk`/`adjustment` are excluded — perks are 0 and non-cash,
   adjustments are ambiguous corrections), bucketed by `created_at::date`. Bucketed under synthetic
   category `"Membership deposits"`. **No `branch_id` on this table** → membership income is org-level
   only and appears under a `"— (org-level)"` bucket in the branch breakdown, never attributed to a
   branch.

The wallet redemption bookings that fund a voucher/membership visit are excluded by the
`payment_mode NOT IN (...wallet modes...)` filter in component 1, so their rupees are counted once —
at top-up, in component 2 or 3. `ReferralWallet`/`ReferralVoucher` are internal credits, not customer
cash, and are correctly excluded entirely.

`sales_base(org, from, to)` = component 1 + component 2 + component 3, over `[from, to]`.

## Revenue rollup (RPC, `SECURITY DEFINER`)

```
platform_get_revenue_rollup(p_from date, p_to date)
  → per org: { org_id, org_name,
               revenue_by_category: [{category, gross}],   -- incl. "Voucher sales", "Membership deposits"
               revenue_by_branch:   [{branch_id, branch_name, gross}],  -- incl. "— (org-level)" for memberships
               gross_total,                  -- = sales_base for the selected range
               active_rate_percent,          -- null if none configured
               active_commission_basis,      -- 'vat_inclusive' | 'vat_exclusive' | null
               commission_for_range,         -- null if no rate active for any part of range
               commission_owed_to_date,      -- sum over full rate history, effective_from → today
               collected_to_date,            -- sum(org_commission_collections.amount_collected)
               net_owed }                    -- commission_owed_to_date - collected_to_date
```

- Raises an exception if `is_platform_admin()` is false — checked first, before touching any tenant
  table. Being `SECURITY DEFINER`, it reads `bookings`/`payments`/`vouchers`/`membership_transactions`/
  `services`/`branches`/`organizations` across all orgs internally, so the rollup needs **no** RLS
  change (only the separate drill-in feature does).
- `gross_total` = `sales_base` (the three-component drawer basis above), aggregated across every org in
  one query — no N+1 looping per org from the frontend. This intentionally differs from
  `getRevenueForPeriod()` (which is booking-only and uses frozen `daily_reports` snapshots for closed
  days): the commission basis is current-truth and includes voucher/membership top-ups, per the product
  decisions for this feature.
- Commission math handles rate changes mid-range correctly: for each rate-history row that overlaps
  `[p_from, p_to]`, take that overlap's `sales_base`, apply the VAT back-out if the row's
  `commission_basis = 'vat_exclusive'` (`sales_base / (1 + vat_rate_percent/100)`), multiply by
  `rate_percent`, then sum across overlapping rows. `commission_owed_to_date` runs the same logic over
  `[effective_from of first rate row, today]`, independent of the dashboard's selected range.
- If an org has no commission rate row at all, `active_rate_percent`/`active_commission_basis`/
  `commission_for_range`/`commission_owed_to_date` are `null` (not `0`) — the UI must render "not
  configured", never a bare $0, so it's never misread as "deal exists, currently zero."

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
- `/platform/dashboard` — one row per org: total sales (selected range, drawer basis), category/branch
  breakdown toggle, active rate %, commission for range, commission owed to date, collected to date,
  net owed. Global date-range picker at top (defaults to current month).
- `/platform/dashboard/:orgId` — drill-in:
  - Rate history list (rate %, VAT-inclusive/exclusive basis, VAT rate used if exclusive, effective
    dates) + "new rate" action (invokes the close-old/open-new RPC; form includes the basis choice).
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
- **Split-tender bookings** (part wallet, part cash) → only the non-wallet payment rows count, at the
  `payments` grain — the wallet portion was already counted at top-up. Handled by component 1's
  `payment_mode` filter, not a booking-level flag.
- **Membership income has no branch** → surfaced under a `"— (org-level)"` branch bucket, never dropped
  silently, so `revenue_by_branch` still sums to `gross_total`.
- **Refunded membership deposit** → a deposit later refunded is typically recorded as a negative
  `adjustment`, which component 3 excludes, so the original `deposit` is **not** netted back out. Known
  v1 limitation — membership deposit refunds are rare; revisit if they become material. (Booking refunds
  and voucher cancellations *are* handled, via `payment_status` and voucher status respectively.)
- **Voucher `actual_price` is recorded at issue**, before the interim `voucher_payments` ledger exists —
  so voucher income is "value of vouchers sold in the period," which is the intended commission basis.
  This component does not depend on the 2026-08-20 voucher-payment work shipping first.

## Testing

No test runner in this repo (per CLAUDE.md) — validation is `npm run build` plus a manual staging
walkthrough:

1. Seed a `platform_admins` row for a test user; confirm `/platform/login` works for it and rejects an
   ordinary staging staff/admin login.
2. Create two overlapping `org_commission_rates` periods for a test org via direct SQL — confirm the
   RPC path (not raw insert) rejects it; confirm two *non*-overlapping periods compute correctly against
   a hand-calculated number, for both a `vat_inclusive` rate row and a `vat_exclusive` one (verify the
   VAT-exclusive figure is lower than the inclusive one by the expected backed-out VAT amount).
3. Record a collection larger than owed-to-date; confirm `net_owed` goes negative and renders without
   erroring.
4. As an org-scoped admin (not platform admin), confirm `org_commission_rates` /
   `org_commission_collections` are unreadable, and confirm another org's `bookings`/`payments` are
   still unreadable (the drill-in RLS exception must not leak between ordinary org sessions — it only
   fires for `is_platform_admin()`).
5. **Session isolation:** log in as a platform admin at `/platform/login`, then in another tab confirm
   the staff `/:orgSlug/login` still works independently and neither session's `onAuthStateChange`
   disturbs the other (no login-loop, no cross-eviction). Log out of one; confirm the other survives.
6. **Drawer-basis correctness** — build a fixture org with all three income types in one period and
   verify `gross_total` counts each rupee once:
   - a normal Cash booking (counts, component 1),
   - a **split-tender** booking `VoucherWallet` + `Cash` (only the Cash payment row counts),
   - a booking fully paid by `Membership` / `VoucherWallet` / `ReferralWallet` (counts **0** in
     component 1 — the money was/was-not real cash at top-up),
   - a voucher issued for cash in-period (`actual_price` counts, component 2) and later a booking that
     redeems it via `VoucherWallet` (must **not** double-count),
   - a `membership_transactions` `deposit`, plus a `birthday_perk` (amount 0) and an `adjustment` that
     must **not** count (component 3).
   Hand-total the expected `gross_total` and match it; confirm `revenue_by_category` includes
   `"Voucher sales"`/`"Membership deposits"` and `revenue_by_branch` sums to `gross_total` with
   membership income under `"— (org-level)"`.
7. Refund a paid booking after the fact; confirm it drops out of `gross_total` (current-truth basis).
