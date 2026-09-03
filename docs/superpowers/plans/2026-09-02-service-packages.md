# Plan: Session-Based Service Packages ("Annual Packages")

## Context

Nuad Thai Spa's Lazimpat branch client shared an Excel sheet, `Annual Package Details lazimpat.xlsx`
— 28 customers who each pre-paid for a fixed number of sessions of one specific service (e.g. "8
sessions of 90 min Oil Massage"), redeemed one session per visit until it hits 0 or the 1-year
expiry passes. Columns: Name, Contact Number, Service, Issued Date, Expiry Date, Paid Amount,
Session Left.

Neither `memberships` (pure NPR wallet balance) nor `vouchers` (NPR-denominated, partial-redemption
ledger) model an integer session count — both are money-based. This plan adds a small parallel
schema, structurally mirroring the proven voucher pattern (catalog → issued instance → append-only
ledger → computed-balance view → two `SECURITY DEFINER` RPCs) but session-native from the start,
rather than bolting a unit discriminator onto the money-critical voucher tables.

## Global Constraints

- Reference implementation to mirror throughout: `supabase/migration-072-vouchers.sql` (schema/RLS/RPCs),
  `src/services/api.js` recordPayment tender loop (~L366-590) and voucher lookup (~L1189-1229),
  `src/components/ui/PaymentModal.jsx` PAYMENT_TREE + `VoucherWalletCard.jsx`,
  `src/pages/branch-manager-dashboard/components/Vouchers/*` panels.
- Staff CAN redeem a session unsupervised at checkout (matches migration-075's staff-can-issue-vouchers
  precedent) — this is the one deliberate divergence from `claim_voucher`'s manager/admin-only gate.
- Issuance (`issue_package`) stays manager/admin only, mirroring `issue_voucher`.
- No package code / counter table for now. Reserve a nullable `package_code` column on `packages`
  but do not build a counter table or code-generation logic.
- `package_redemptions` is append-only, no amount column — each row = "1 session used"; `count(*)`
  is the unit. Do not reuse `voucher_claims`.
- Use `booking.bookingId` (UUID) for API calls per CLAUDE.md, never `booking.id`.
- Dropdowns must use `CustomSelect`, never a native `<select>`.
- Z-index must use semantic tailwind tokens, never raw values.
- `npm run build` must pass with zero errors after every task.
- New migration file must self-record into `public.schema_migrations` per
  `scripts/check-migrations.sh` (see `supabase/PROMOTION.md`).
- Seed/import SQL is NOT an auto-applied migration — it is a manual dashboard/MCP handoff step per
  CLAUDE.md, and must be portable (resolve org/branch/service/customer by name/phone, never hardcoded
  UUIDs) and idempotent (`ON CONFLICT DO NOTHING` / deterministic UUIDs).

## Task 1: Database schema — migration-141-service-packages.sql

Create `supabase/migration-141-service-packages.sql`, mirroring `supabase/migration-072-vouchers.sql`'s
structure and self-recording pattern (check how migration-072 or a recent migration records itself
into `public.schema_migrations` and copy that exact pattern).

Tables:

- **`package_types`** — org-scoped catalog. Columns: `id uuid primary key default gen_random_uuid()`,
  `org_id uuid references organizations(id)`, `service_id uuid references services(id)`, `name text`,
  `default_sessions int`, `standard_price numeric(10,2)`, `validity_days int default 365`,
  `is_active boolean default true`, `display_order int`, `created_at timestamptz default now()`.
  Binds a package type to exactly one service (unlike vouchers, which redeem against any service via
  free-text `service_claimed`).
- **`packages`** — one row per sold package. Columns: `id uuid primary key default gen_random_uuid()`,
  `org_id uuid references organizations(id)`, `branch_id uuid references branches(id)`,
  `package_type_id uuid references package_types(id)`, `service_id uuid references services(id)`
  (denormalized, avoids a join on redemption checks), `customer_id uuid references customers(id) null`,
  `guest_name text`, `guest_info text` (phone), `issued_date date not null`, `expiry_date date not null
  check (expiry_date >= issued_date)`, `paid_amount numeric(10,2) not null check (paid_amount >= 0)`,
  `sessions_total int not null check (sessions_total > 0)`, `package_code text null` (reserved, unused),
  `remarks text`, `issued_by uuid references auth.users(id)`, `created_at timestamptz default now()`.
- **`package_redemptions`** — append-only ledger. Columns: `id uuid primary key default gen_random_uuid()`,
  `package_id uuid not null references packages(id)`, `org_id uuid references organizations(id)`,
  `redeemed_date date not null default current_date`, `branch_id uuid references branches(id)`,
  `booking_id uuid references bookings(id) null`, `guest_name_used_by text`, `notes text`,
  `performed_by uuid references auth.users(id)`, `created_at timestamptz default now()`. No amount
  column — each row means "1 session used".
- **`package_balances`** (view) — `sessions_used = count(package_redemptions for that package)`,
  `sessions_remaining = sessions_total - sessions_used`, `status` computed as
  `unused` / `partially_used` / `fully_redeemed` / `expired` (expired when `expiry_date < current_date
  AND sessions_remaining > 0`).

RLS:

- Org-scoped read on all three tables for staff/manager/admin (staff included — wider than vouchers'
  manager/admin-only read, since redemption is a staff action).
- No direct `INSERT`/`UPDATE`/`DELETE` policies on `packages` or `package_redemptions` — all writes go
  through the two RPCs below. `package_types` may allow manager/admin write policies directly (mirror
  whatever migration-072 does for its catalog table, if it has direct write policies vs an RPC —
  check and match that pattern exactly).

RPCs (both `SECURITY DEFINER`, mirror `issue_voucher`/`claim_voucher`'s validation style exactly —
role checks via `auth.jwt()` or the same helper migration-072 uses, branch/org scoping validation,
raised exceptions on violation):

- **`issue_package(p_org_id, p_branch_id, p_package_type_id, p_customer_id, p_guest_name, p_guest_info,
  p_issued_date, p_expiry_date, p_paid_amount, p_sessions_total, p_remarks)`** — mirrors `issue_voucher`
  (migration-072 ~L205-286): validates branch/org scoping, role is manager/admin, inserts the `packages`
  row, returns the new package id/row.
- **`redeem_package_session(p_package_id, p_booking_id, p_branch_claimed_id, p_guest_name_used_by,
  p_notes)`** — mirrors `claim_voucher`'s `SELECT ... FOR UPDATE` row lock + overdraft check (migration-072
  ~L297-373), but the overdraft check becomes `sessions_used >= sessions_total OR expiry_date <
  current_date` (raise a clear exception distinguishing "no sessions left" from "expired") instead of a
  numeric balance comparison. Role check includes `staff` in addition to manager/admin (the deliberate
  divergence from `claim_voucher`). Inserts one `package_redemptions` row and returns it.

Verification: `npm run build` unaffected (no frontend changes yet — just confirm the SQL file parses
cleanly, e.g. no obvious syntax errors on read-through; there is no local DB to run this migration
against, so this task is code-review-verified, not execution-verified). Confirm the file matches every
column/table/RPC named above exactly, and confirm it self-records into `schema_migrations` in the same
form as the two or three most recent `supabase/migration-1*.sql` files (check
`ls supabase/migration-1*.sql | tail -5` and read one for the current self-record convention before
writing).

## Task 2: API layer — src/services/api.js

Depends on Task 1 (needs exact RPC names/params).

1. Add `getActivePackagesForCustomer(customerId, phone, serviceId)` mirroring the existing wallet/voucher
   lookup at `api.js` ~L1189-1229 — queries `packages` joined to `package_balances`, filtered to the given
   `service_id`, `status != 'fully_redeemed'`, `status != 'expired'`, and matching either `customer_id` or
   `guest_info` (phone). Returns the enriched rows (include `sessions_remaining`, `expiry_date`, etc. — UI
   needs these to render `PackageWalletCard`).
2. In the `recordPayment` tender-processing loop (~L366-590), add a `SessionPackage` tender branch
   alongside the existing `Membership`/`ReferralWallet`/`ReferralVoucher`/`VoucherWallet` branches (see
   `record_voucher_wallet_payment` call at ~L551-560 for the pattern to copy). A `SessionPackage` tender
   (`{ paymentMode: 'SessionPackage', packageId }`) has no NPR amount — it represents "1 session, full
   service value" — and calls `redeem_package_session(p_package_id, p_booking_id, p_branch_claimed_id, ...)`
   inside the same loop, passing the booking's `bookingId` (UUID, not `booking.id`) so the redemption is
   linked to the booking.

Verification: `npm run build` passes. Read through the full modified tender loop once to confirm the new
branch doesn't disturb tender ordering/totals for the existing tender types (this file computes payment
totals across all tenders in the loop — a new branch must not add to any NPR sum, since a session
redemption carries no monetary amount).

## Task 3: Customer-side redemption UI

Depends on Task 2 (needs `getActivePackagesForCustomer` + the `SessionPackage` tender contract).

1. New `src/components/ui/PackageWalletCard.jsx`, modeled directly on the existing
   `VoucherWalletCard.jsx` in the same directory — same visual/structural pattern, shows package name,
   sessions remaining / total, expiry date; a "Redeem 1 Session" action.
2. In `src/components/ui/PaymentModal.jsx`: add a `SessionPackage` leaf to `PAYMENT_TREE` in the same
   slot/pattern as the existing `VoucherWallet` leaf, gated on whether the current booking's `service_id`
   matches an active package for that customer (call `getActivePackagesForCustomer` with the booking's
   customer id/phone and `service_id`). Render `PackageWalletCard` when at least one active package
   exists for the booking's service; otherwise the leaf does not appear (same show/hide behavior as the
   voucher leaf).

Verification: `npm run build` passes. Manual verification of this task happens later (staging), per the
plan-level Verification section below — do not attempt to run the dev server against a live DB inside
this task.

## Task 4: Manager UI — issue/browse packages

Independent of Task 3, depends on Task 1 + Task 2 (RPC + `getActivePackagesForCustomer`/a new
`issuePackage` wrapper you add to `api.js` in this task if one doesn't already exist as a thin RPC-call
wrapper — check how `api.js` wraps `issue_voucher` and add an equivalent `issuePackage(...)` wrapper
function here if Task 2 didn't already add one; Task 2's brief only calls for
`getActivePackagesForCustomer` and the redemption tender branch, not an issuance wrapper).

Create `src/pages/branch-manager-dashboard/components/Packages/`, copying the structure of the sibling
`.../Vouchers/` directory as a template (read all four Vouchers files first, then adapt):

- `PackageOverviewPanel.jsx` ← `VoucherOverviewPanel.jsx` (summary stats: active packages, sessions
  redeemed this period, etc.)
- `PackageListPanel.jsx` ← `VoucherListPanel.jsx` (table/list of issued packages, filter/search)
- `NewPackageModal.jsx` ← `NewVoucherModal.jsx` (issue-new-package form: customer lookup, package type
  select via `CustomSelect`, sessions/paid amount/dates)
- `PackageDetailModal.jsx` ← `VoucherDetailModal.jsx` (single package detail + redemption history from
  `package_redemptions`)

Wire these into wherever `Vouchers` panels are currently mounted in the manager dashboard (find the
parent component that renders `VoucherOverviewPanel`/`VoucherListPanel` and add the `Packages`
equivalents alongside them — same tab/section pattern, don't invent a new navigation paradigm).

Verification: `npm run build` passes. All dropdowns in the new modal use `CustomSelect`, no native
`<select>`. Any new z-index usage uses semantic tokens.

## Task 5: Data import — seed-prod-nuad-packages-import.sql

Depends on Task 1 (schema must exist to know exact column names). Independent of Tasks 2-4.

The source file `Annual Package Details lazimpat.xlsx` (28 rows) is at the repo root (already present
as an untracked file — do not delete or move it, just read it).

1. Before drafting SQL: grep the live `services` table definition/seed data in `supabase/` for exact
   name strings used by this org (sheet data is inconsistently cased — e.g. is it "90 min Oil Massage"
   or "90 Min Oil Massage"?). Name matching must be exact against whatever the DB actually has.
2. Create `supabase/seed-prod-nuad-packages-import.sql` following
   `supabase/seed-prod-nuad-vouchers-import.sql`'s pattern exactly: `BEGIN;...COMMIT;`, portable (resolve
   `org_id` via `organizations.slug = 'nuad-thai-spa'`, `branch_id` via `branches.name = 'Lazimpat'`,
   `service_id` by exact name match — never hardcode UUIDs), deterministic UUIDs for idempotent re-runs,
   `ON CONFLICT DO NOTHING` on `package_types`.
3. Insert missing `package_types` rows — one per distinct service in the sheet (expect: Sauna, 90 min Oil
   Massage, 60 min Oil Massage, 120 min Oil Massage, adjust to whatever the sheet actually contains).
4. Insert the 28 `packages` rows via `CROSS JOIN (VALUES (...), ...)`, resolving `branch_id` as above,
   best-effort `customer_id` match by phone against the `customers` table (leave `customer_id` NULL and
   rely on `guest_name`/`guest_info` free text when there's no confident phone match — same fallback
   posture as the voucher import). `sessions_total` = the sheet's "Session Left" column read literally —
   no historical redemption ledger exists for sessions already used, so `package_redemptions` starts
   empty for all 28 rows (mirrors how the original voucher import seeded vouchers without back-filling
   `voucher_claims` history).
5. Two data realities to handle explicitly, not silently:
   - Several rows' expiry dates have already passed (issued 2021-2024, 1-year validity). Import them
     as-is — the `package_balances` view will correctly show `expired` status. Do not extend expiry
     dates to make them look current.
   - Two rows share one contact field for two names ("Amit/Bhim Rokka", "Rajesh Kavra/Milind Kavra").
     Same ambiguity pattern as prior membership/voucher reconciliation work in this repo — resolve with
     best-effort match, and flag both rows explicitly in the report (see next step) for client
     confirmation. Do not guess which name is correct.
6. Write `docs/session-logs/2026-09-02.md` documenting: row count imported, the two ambiguous-contact
   rows flagged for client confirmation, any rows with already-expired status, and any sheet rows that
   couldn't be resolved to a `package_types` service at all (if any — list them, do not silently drop
   them from the SQL without saying so). Follow the convention in `docs/session-logs/2026-08-19.md` (the
   prior voucher import's log) for structure/tone.

Verification: SQL file is syntactically valid (`BEGIN`/`COMMIT` balanced, no stray hardcoded UUIDs —
grep the file for anything that looks like a literal UUID outside of the deterministic-UUID generation
expressions). This script is NOT run against any live database by this task — it is prepared for the
manual handoff described in the plan-level Verification section.

## Verification (whole plan, after all tasks)

1. `npm run build` passes after all frontend changes (checked per-task above; re-confirm once more at
   the final whole-branch review).
2. Migration and seed script are handed off per CLAUDE.md's promotion process — they are not applied to
   any live database as part of this plan's execution. State this explicitly in the final report so the
   human partner knows staging/prod application is a manual next step (push the branch → PR → stage →
   CI applies `migration-141-*.sql` automatically; the seed script stays a manual dashboard/MCP step
   after that per `supabase/PROMOTION.md`).
3. Everything else described in the original spec's "Verification" section (issuing a test package on
   staging, redeeming a session end-to-end, over-redeem/expiry rejection checks, RLS role checks) requires
   a live staging DB and is **out of scope for this plan's automated execution** — flag it clearly as a
   manual follow-up step for the human partner once the branch is on staging.
