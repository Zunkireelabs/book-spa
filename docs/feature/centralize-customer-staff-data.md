# Centralizing Customer & Staff Data (Per-Branch → Per-Organization)

> Implementation plan + runbook. **Phase 1 = Customers (do first). Phase 2 = Staff (gated, later).**
> Both phases are documented here; we execute Customers first and only start Staff once Customers
> is live in production and stable.

---

## 1. Context — why we're doing this

Today every customer and staff member is **siloed to a single branch**. The same person who
visits Nuad Thai's Lazimpat *and* Sanepa becomes **two unrelated customer records**, and a staffer
who works two branches needs **two staff rows**. We want both **centralized at the organization
level** so that:

- A customer's **booking history and the upcoming outstanding/credit ledger follow the person
  across all branches** — this is the real driver and it unblocks the `feature/outstanding` work.
- A staff member is **one identity that can work at many branches** (with per-branch ordering).
- The **existing duplicate rows are merged** so data is clean going forward, and duplicates can't
  re-form.

**Concrete behavior we want (the acceptance test):** when creating a booking at branch B, a
returning customer who has *only* ever been served at branch A should **appear in the customer
autocomplete** and **link to their single org-wide profile** — instead of silently creating a new
duplicate.

---

## 2. Concepts you must hold while reading this

These came up in discussion and decide how we protect the data:

1. **Code and data are separate.** Git/`main` versions the **frontend only**; deploys never run
   SQL. Reverting `main` rolls back the *app*, never the *database*. Schema/row changes are applied
   directly to each Supabase DB by running SQL.
2. **There are two separate databases.** Staging (`snzcckzfmpboeqkktmwy`, reachable via MCP) and
   Production (`pmbvogiphelmpjdalmtv`, dashboard SQL only). They share **no data**. Every DB change
   runs on **both**, production manually.
3. **Staging is a rehearsal, not a backup of production.** It proves the migration *logic*. Because
   prod data differs, the destructive merge is **re-dry-run and re-reviewed on prod** — staging's
   "merge these N rows" result never carries over.
4. **What's reversible vs not** (full table in §8). Additive steps (add column/table/index) are
   reversible. **Merging/deleting duplicate rows and dropping a uniqueness rule are NOT** — the only
   undo is a backup table or a database snapshot/PITR.
5. **A real rollback for the destructive steps = a production snapshot/PITR taken right before**,
   plus the `*_merge_log` backup tables the migrations write. (PITR is a dashboard/plan-level thing
   only the account owner can enable; the MCP cannot take snapshots.)

---

## 3. Current state (verified during exploration)

- `customers` and `therapists` have **no `org_id`**. Their RLS already derives org by *joining
  `branches`* (`migration-012`), so reads are *already* org-wide by permission — the real problems
  are **duplicate rows** + the `branch_id NOT NULL` coupling.
- **Customers have no uniqueness on phone/email today** — only the `id` UUID is unique; `phone` has a
  plain (non-unique) index. Duplicates are possible even within one branch.
- The only child FK to `customers` is `bookings.customer_id` (nullable) → **customer merge is low
  risk** (no unique-constraint collisions).
- Staff has **three constrained child FKs** (`booking_therapists`, `therapist_attendance`, and the
  new membership table) → **staff merge needs collision handling** and is structurally harder.
- **Staging duplicate volume** (prod differs): customers = 2 phone-groups / **3 redundant rows** +
  2 phoneless; therapists = 7 name-groups / **7 redundant rows**.
- RLS helpers `get_user_org_id()` / `get_user_role()` exist (`migration-011`) — reuse them; confirm
  exact names before referencing.

**Two facts that shape the design:**
- **Phone identifies a customer; a name does NOT identify a staffer.** Two real people can share a
  name; a "Manager" row and a "Therapist" row can collide. ⇒ **customer merge can be automatic (by
  phone); staff merge MUST be human-reviewed.**

---

## 4. Target data model

**Customers** — org-level identity, one record per `(org, normalized phone)`. `branch_id` is kept
as "origin branch" metadata (not dropped). History + credit span the org.

**Staff** — "one current branch + transfer" (chosen model): the `therapists` row gets `org_id`
(org-level identity) but **`branch_id` stays NOT NULL and represents the staffer's CURRENT branch**.
A staffer is at exactly one branch at a time. A **branch manager/admin transfers** a staffer to
another branch in the same org; the transfer updates `therapists.branch_id` and writes an audit row
to a new **`staff_transfers`** table. After a transfer, only the destination branch's manager/admin
can transfer the staffer onward. No simultaneous multi-branch, no membership junction, no row merge.

---

## 5. PHASE 1 — CUSTOMERS  *(do first; low risk; unblocks credit)*

Recommended order: additive DDL → dry-run report → **(snapshot)** → merge → dup-guard → RLS → app.
Each migration self-records into `schema_migrations`. New files **033–037**.

### 5.1 `migration-033-customers-org-id.sql` — additive (REVERSIBLE)
- `ALTER TABLE customers ADD COLUMN org_id uuid REFERENCES organizations(id);`
- Backfill `org_id` from `branches.org_id` via `branch_id`; **verify 0 NULLs**, then `SET NOT NULL`.
- Indexes: `idx_customers_org`, `idx_customers_org_active (org_id, is_active) WHERE is_active`.
- Keep `customers.branch_id NOT NULL` (origin branch) — avoids an irreversible constraint drop.

### 5.2 `migration-034-customers-merge-dryrun.sql` — REPORT ONLY (re-runnable, non-destructive)
- Group by `(org_id, regexp_replace(phone,'\D','','g'))` HAVING count > 1. Canonical = oldest
  (`created_at`, then `id`). Output: `org_id, nphone, dup_count, canonical_id, rows_to_merge`.
- Separately list **phoneless** customers (staging: 2). These are **never auto-merged** — surfaced
  for human awareness only.

### 5.3 **Snapshot step (run right before 5.4, prod only)** ⚠️
Before the merge, in the target DB's SQL editor:
```sql
CREATE TABLE customers_backup_<YYYYMMDD>       AS SELECT * FROM customers;
CREATE TABLE bookings_custid_backup_<YYYYMMDD> AS SELECT id, customer_id FROM bookings;
```
Plus note the PITR timestamp if PITR is enabled. This is the true "come back" button.

### 5.4 `migration-035-customers-merge.sql` — DESTRUCTIVE (transaction + backup) ⚠️
Inside a single `BEGIN…COMMIT`:
1. `CREATE TABLE IF NOT EXISTS customer_merge_log(merged_id, canonical_id, org_id, nphone,
   merged_row jsonb, merged_at)`; snapshot each row to be deleted as jsonb.
2. Repoint `bookings.customer_id = canonical` for every merged id (only child FK; **no collisions**).
3. Coalesce `email`/`notes` onto canonical where canonical is missing them.
4. `DELETE` the redundant rows.
5. Sanity asserts (else `ROLLBACK`): 0 orphan bookings; deleted count == redundant count.

### 5.5 `migration-036-customers-dup-guard.sql` — partial unique index (REVERSIBLE; AFTER merge)
```sql
CREATE UNIQUE INDEX customers_org_nphone_uniq ON customers
  (org_id, (NULLIF(regexp_replace(coalesce(phone,''),'\D','','g'),'')))
  WHERE NULLIF(regexp_replace(coalesce(phone,''),'\D','','g'),'') IS NOT NULL;
```
First-ever enforcement of "one customer per phone per org." Phoneless rows excluded.

### 5.6 `migration-037-customers-rls-org.sql` — RLS swap
- Replace branch-join customer policies (`migration-012` L302-363) with direct
  `org_id = get_user_org_id()` for SELECT/INSERT/UPDATE. Anon booking-flow INSERT untouched.
- **Behavior change (intended):** non-admins previously saw only *their branch's* customers; now all
  org staff see all org customers — required for cross-branch history/credit.

### 5.7 App refactor (Phase 1) — `src/services/api.js` + consumers
- **`createBooking()` find-or-create (~L2337-2391):** match `.eq('org_id', orgId)` (not `branch_id`)
  on the phone+email lookups; INSERT sets `org_id` (keep `branch_id` as origin). Keep JS phone
  normalize `replace(/\D/g,'')` so it matches the index. Prefer an **upsert on `(org_id, phone)`**
  for race-safety (mirrors `migration-025`).
- **Rescope to `org_id`** (drop the `branch_id` filter): `fetchCustomersLightweight` (~L3551, powers
  the **autocomplete**), `fetchCustomers` (~L3472), `fetchCustomerProfile` (~L3575 — also drop the
  secondary `customer.branch_id` filter so history spans branches), `getCustomerIntelligence`
  (~L3728), `getRiskIndicators`.
- **Consumers:** `CustomerAutocomplete` (used in `…/calendar/index.jsx:659,675`) and CRM
  `CustomersPanel.jsx` — pass `orgId` instead of `branchId`.
- **Net effect:** the New-Booking autocomplete now suggests customers from any branch, and saving
  links to the single org profile instead of duplicating.

---

## 6. PHASE 2 — STAFF (transfer model)  *(only after Phase 1 is live in prod and stable)*

**Chosen model: one current branch + transfer.** A staffer is at exactly one branch at a time
(`therapists.branch_id` = current branch). A branch manager/admin **transfers** a staffer to another
branch in the same org; only the destination branch's manager/admin can transfer them onward.

This is **additive-only** — no row merge, no junction table, no attendance-constraint change. New
files **038–039**.

### 6.1 `migration-038-staff-org-id-and-transfers.sql` — additive (REVERSIBLE)
- Add `therapists.org_id` (backfill from `branches.org_id` via `branch_id` → verify 0 NULLs →
  `SET NOT NULL`, index `idx_therapists_org`). **Keep `branch_id NOT NULL` = current branch.**
- New audit table **`staff_transfers`** `(id, therapist_id→therapists, org_id, from_branch_id→branches,
  to_branch_id→branches, transferred_by→users, transferred_at timestamptz default now(), note text)`;
  enable RLS; index `therapist_id`. Append-only history of every move (also the "undo" trail — a
  transfer is reversed by another transfer).
- No change to `therapist_attendance` uniqueness — stays `(therapist_id, date)`.

### 6.2 `migration-039-staff-rls-org.sql` — RLS swap
- Replace branch-join therapist policies (`migration-012` L165-232) with `org_id = get_user_org_id()`
  for SELECT/INSERT/UPDATE; keep `anon read where is_active`.
- `staff_transfers` policies: org-scoped read; INSERT restricted to manager/admin (write authz also
  enforced in the API — see 6.3).
- **No dedup/merge step.** Duplicate-staff cleanup (if ever wanted) is a separate, optional,
  human-reviewed exercise — not required by the transfer model.

### 6.3 App refactor (Phase 2) — `api.js` + `…/MasterData/TherapistManagementPanel.jsx` + attendance
- **New `transferTherapist(therapistId, toBranchId, note?)` in `api.js`:**
  1. Load the therapist; assert `to_branch_id` is in the **same `org_id`** and ≠ current branch.
  2. **Authz:** caller must be admin (org-wide) **or** manager/admin of the staffer's **current**
     branch. (This enforces "only the owning branch can transfer them out.")
  3. `UPDATE therapists SET branch_id = toBranchId, display_order = <next at destination>`.
  4. `INSERT staff_transfers(therapist_id, org_id, from_branch_id, to_branch_id, transferred_by, note)`.
  5. Return refreshed staff; caller runs `loadData()`.
- **Transfer UI** in `TherapistManagementPanel.jsx` (Staff → Therapists): add a **Transfer** action
  (button/column) per staff row → opens a branch picker (dropdown of the org's *other* branches; or
  type an existing branch name) → confirm → calls `transferTherapist`. Surface a small "Transferred
  from X on <date>" hint from `staff_transfers` if useful. (Can also be surfaced on the Attendance
  table's ACTION column if you want transfer reachable from there.)
- `fetchTherapists(branchId,{date})` (~L156) & `fetchTherapistsForManagement` (~L2740): **unchanged** —
  still filter by `therapists.branch_id` (current branch), order by `display_order`.
- `createTherapist`/`updateTherapist`/`toggleTherapistActive`/`deleteTherapist`/`updateTherapistOrder`:
  **largely unchanged** (still operate on the single `therapists` row / current branch).
- Attendance fns (~L4111-4427): **unchanged** — recorded against the staffer's current branch.
- **Enabled net-new:** "move staff to another branch" = the Transfer action (one UPDATE + one audit
  row), instead of recreating the person at the second branch.

### 6.4 Transfer leftover-booking reminder (1 day before) — `migration-040` + scheduled job
**Decision (was §10.5a):** transferring a staffer does **not** block the transfer or auto-reassign
their existing future bookings. The bookings **stay as-is at the branch where they were created**;
the system instead sends a **reminder one day before** each such booking so the branch can arrange
coverage or reassign in time.

- **Reuse the existing notification infra** (`migration-032`): the `notifications` table
  `(user_id, type, title, body, booking_id, read)`, the `NotificationBell` UI, and realtime delivery.
  Only the *scheduling* is net-new.
- **`migration-040-transfer-booking-reminders.sql`:** add a **system** enqueue path. The existing
  `enqueue_notification()` requires `auth.uid()` to be manager/admin, so a scheduled job can't call
  it — add a SECURITY DEFINER `enqueue_system_notification(...)` (no role check; callable only by the
  job / service role) **or** insert directly from a service-role Edge Function.
- **Daily scheduler** (set up in **both** Supabase projects): a `pg_cron` job (or a scheduled Edge
  Function) that runs once/day, finds **non-terminal bookings starting tomorrow (Nepal time) whose
  assigned staffer's current `branch_id` ≠ the booking's branch** (i.e. left-behind after a transfer),
  and enqueues a reminder.
- **Recipients (decided):** the **manager/admin of the booking's branch** *and* the **staff currently
  at that branch** (the people who can actually cover/reassign) — **not** the transferred staffer who
  left. The job enqueues one `notifications` row per recipient, all with the booking's `booking_id`
  set so the bell deep-links to it.
- Edge Functions / cron live in the dashboard (not in this repo) — deploy to staging **and**
  production separately, same as `pin-login`.

---

## 7. Deployment runbook (per `supabase/PROMOTION.md`)

For **each migration**, and for **each phase**:
1. **Staging first** — apply SQL via MCP; run the verification queries (§9).
2. **Frontend** — code change on `feature/*` → `stage`; test against staging.
3. **Promote to production = TWO actions:** (a) merge frontend `stage → main`; (b) **manually run the
   SQL** in the prod SQL editor. The git merge ships frontend only — **SQL never auto-runs.**
4. **Order within a phase:** apply additive DB change first → ship frontend → then run the
   reviewed/destructive SQL. App never points at columns that don't exist yet.
5. **Before every destructive step on prod:** take the §5.3 snapshot + confirm PITR window.
6. **Production re-dry-run:** re-run `034` / `039` on prod and review *prod's* rows before merging —
   never reuse staging's merge result.

Sequence: `033 → 034(dryrun)→review → [snapshot] → 035 → 036 → 037 → app P1 → verify → promote P1`,
then (later) `038 → 039 → app P2 (transfer UI) → verify → promote P2`. Phase 2 is additive-only — no
snapshot/merge step required.

Keep `customer_merge_log` + the `*_backup_<date>` tables permanently as the Phase 1 audit/undo trail;
`staff_transfers` is the permanent Phase 2 audit trail. Keep `supabase/schema.sql` baseline in sync
with new columns/tables/constraints. `npm run build` is the app gate.

---

## 8. Reversibility — what can and cannot be undone

| Change | Reversible? | How |
|---|---|---|
| Frontend code | ✅ easy | git revert / redeploy prior build |
| Add `org_id`, new table, new index | ✅ yes | reverse migration: drop column/table/index |
| `SET NOT NULL` on `org_id` | ✅ if no NULLs written | `DROP NOT NULL` |
| **Merge + delete duplicate customer rows (035)** | ⚠️ not automatically | `customer_merge_log` / `customers_backup_<date>` / PITR |
| Staff transfer (UPDATE `branch_id`) | ✅ yes | reverse transfer; full history in `staff_transfers` |
| RLS widening (org-wide visibility) | ✅ yes | restore prior policies |

> Phase 2 (staff transfer model) has **no irreversible step** — it is additive DDL plus an UPDATE
> that is itself undone by another transfer. The only irreversible work in this whole effort is the
> Phase 1 customer merge (035).

Belt-and-suspenders on the irreversible rows: transaction-wrapped + jsonb row snapshots + full
table backups + (recommended) prod PITR checkpoint before running.

---

## 9. Verification (staging via MCP `execute_sql`, then mirror on prod)

- **033 / 038:** `SELECT count(*) … WHERE org_id IS NULL` = 0 before `SET NOT NULL` (customers and
  therapists respectively).
- **034 dry-run:** counts match (3 customer redundant on staging); phoneless customers listed+excluded.
- **035:** `customer_merge_log` count == redundant count; **0 orphan** `bookings.customer_id`; total
  customers dropped by exactly the merged count.
- **036:** inserting a duplicate `(org_id, phone)` raises a unique violation; phoneless insert ok.
- **039 (staff RLS):** non-admin staff can read all org therapists; `staff_transfers` readable
  org-wide, insert restricted to manager/admin.
- **Transfer E2E:** as a manager of branch A, transfer a staffer to branch B → they disappear from
  A's staff/attendance list and appear in B's; a `staff_transfers` row is written with the correct
  from/to/by; the staffer's `display_order` is sane at B; a manager of A can **no longer** transfer
  them (only B's manager/admin can); transferring back restores them to A.
- **Reminder E2E (§6.4):** with a staffer transferred A→B who still has a booking at A tomorrow,
  running the daily job enqueues exactly one `notifications` row to the intended recipient(s) with
  the correct `booking_id`; the bell shows it and deep-links to the booking; a booking whose staffer
  was NOT transferred (current branch == booking branch) produces no reminder; re-running the job the
  same day does not double-send.
- **App E2E (customers):** booking a phone seen at another branch links to the canonical org customer
  (no new row) and the autocomplete shows them. Run `get_advisors` for new warnings.

---

## 10. Open product decisions to confirm before coding
1. **Scope/sequencing:** ✅ **Decided — Customers first**, Staff as a later gated phase (both phases
   documented above). Staff begins only once Customers is live in prod and stable.
2. **Staff model:** ✅ **Decided — single current branch + transfer** (not a membership junction). A
   staffer is at one branch at a time; manager/admin of the current branch transfers them to another
   branch in the org; only the destination branch's manager/admin can transfer them onward.
3. **PITR:** is it enabled on production? If not, the `customers_backup_<date>` SQL copies are the
   Phase 1 fallback. (Phase 2 has no destructive step, so no snapshot needed.)
4. **RLS widening:** confirm all org staff seeing all org customers is acceptable.
5. **Transfer mid-state edge cases:**
   - (a) Future bookings already assigned at the old branch — ✅ **Decided: keep as-is, do not block
     or auto-reassign; send a reminder one day before each (see §6.4).** Recipients ✅ **decided —
     the booking-branch manager/admin + the staff currently at that branch** (not the transferred
     staffer).
   - (b) Can an **admin** transfer anyone regardless of current branch? (assumed **yes**)
   - (c) Should the Transfer action live on the **Therapists** panel, the **Attendance** table's
     ACTION column, or both?
