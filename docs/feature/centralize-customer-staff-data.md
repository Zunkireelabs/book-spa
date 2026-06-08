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

**Staff** — "one identity, many branches": the `therapists` row becomes the org-level identity
(`org_id`), and a new **`staff_branch_memberships`** table lists which branches each identity works
at, carrying **per-branch `display_order`** (and room for per-branch scheduling later). Bookings and
the multi-therapist junction keep referencing a single staff id.

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

## 6. PHASE 2 — STAFF  *(only after Phase 1 is live in prod and stable)*

Structurally harder (new junction, 3 constrained child FKs) and **semantically riskier** (names
aren't identifiers). New files **038–041**.

### 6.1 `migration-038-staff-org-id-and-membership.sql` — additive (REVERSIBLE)
- Add `therapists.org_id` (backfill → verify → `SET NOT NULL`, index). Keep `branch_id NOT NULL`.
- New table **`staff_branch_memberships`** `(id, therapist_id→therapists ON DELETE CASCADE,
  branch_id→branches, org_id, display_order int, is_active, created_at, UNIQUE(therapist_id,
  branch_id))`; enable RLS; index branch_id + therapist_id.
- Backfill one membership per existing therapist at its current branch, carrying over `display_order`
  + `is_active`. Membership becomes source of truth for per-branch order (keep legacy
  `therapists.display_order` during transition).

### 6.2 `migration-039-staff-merge-dryrun.sql` — REPORT ONLY, **HUMAN REVIEW REQUIRED** ⚠️
- Group by `(org_id, lower(trim(name)))` HAVING count > 1. Emit `dup_count`, **divergence flags**
  `array_agg(distinct position)` + `array_agg(distinct gender)`, branches, proposed canonical.
- A human vets candidates and populates `staff_merge_approved(merged_id, canonical_id)`.
  **Default: merge nothing unless explicitly approved.** Differing position/gender ⇒ almost certainly
  different people ⇒ do NOT merge.

### 6.3 `migration-040-staff-merge.sql` — DESTRUCTIVE (transaction + backup + collisions) ⚠️
Reads ONLY the approved list; `therapist_merge_log` snapshots deleted rows **incl. colliding child
rows**. Repoint order matters (unique constraints + ON DELETE CASCADE):
1. `bookings.therapist_id` → canonical (unconstrained, direct).
2. `booking_therapists` `UNIQUE(booking_id,therapist_id)`: delete merged-side rows that collide with
   an existing canonical row on the same booking, then repoint survivors.
3. `therapist_attendance`: delete colliding merged-side rows (same date+branch), then repoint.
4. `staff_branch_memberships` `UNIQUE(therapist_id,branch_id)`: delete colliding, then repoint.
5. **Delete merged `therapists` rows LAST** (so the `booking_therapists` CASCADE can't wipe rows we
   just repointed).
- Snapshot step (§5.3 equivalent) for `therapists` + the 3 child tables runs first.

### 6.4 `migration-041-attendance-unique-and-staff-rls.sql` — constraints + RLS (partly IRREVERSIBLE) ⚠️
- Attendance uniqueness `(therapist_id, date)` → **`(therapist_id, branch_id, date)`** (a staffer can
  work multiple branches on a day). Confirm exact old constraint name per DB; run AFTER merge.
  Dropping the old constraint loosens uniqueness = irreversible.
- Staff RLS: replace branch-join therapist policies (`migration-012` L165-232) with
  `org_id = get_user_org_id()`; keep `anon read where is_active`. Add `staff_branch_memberships`
  policies (org read, anon read active, manager/admin write).
- **Future-dup guard:** no global `(org,name)` unique (names aren't identifiers). Rely on
  `staff_branch_memberships UNIQUE(therapist_id,branch_id)` + the existing per-branch name dup-check.

### 6.5 App refactor (Phase 2) — `api.js` + `…/MasterData/TherapistManagementPanel.jsx`
- `fetchTherapists(branchId,{date})` (~L156) & `fetchTherapistsForManagement` (~L2740): join
  `staff_branch_memberships` → `therapists` by `branch_id`; order by membership `display_order`.
- `createTherapist` (~L2762): "find-or-create org identity, then upsert membership"; `display_order`
  computed over the **branch's** memberships.
- `updateTherapist` (~L2822): edits identity fields on `therapists`; branch authz becomes "manager's
  branch has a membership for this therapist."
- `toggleTherapistActive` (~L2886) & `deleteTherapist` (~L2946): split into **per-branch**
  (membership) vs **identity-wide** ops — product decision to confirm.
- `updateTherapistOrder` (~L3006) + @dnd-kit panel: write reorder to membership `display_order`.
- Attendance fns (~L4111-4427): group by `(therapist_id, branch_id)`; compatible with new unique.
- **Enabled net-new:** "assign existing staff to my branch" = insert a membership row.

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
then (later) `038 → 039(dryrun)→HUMAN review → [snapshot] → 040 → 041 → app P2 → verify → promote P2`.

Keep `customer_merge_log` / `therapist_merge_log` + the `*_backup_<date>` tables permanently as the
audit/undo trail. Keep `supabase/schema.sql` baseline in sync with new columns/tables/constraints.
`npm run build` is the app gate.

---

## 8. Reversibility — what can and cannot be undone

| Change | Reversible? | How |
|---|---|---|
| Frontend code | ✅ easy | git revert / redeploy prior build |
| Add `org_id`, new table, new index | ✅ yes | reverse migration: drop column/table/index |
| `SET NOT NULL` on `org_id` | ✅ if no NULLs written | `DROP NOT NULL` |
| **Merge + delete duplicate customer rows (035)** | ⚠️ not automatically | `customer_merge_log` / `customers_backup_<date>` / PITR |
| **Merge + delete duplicate staff rows (040)** | ⚠️ not automatically | `therapist_merge_log` / backups / PITR |
| **Drop attendance unique → add per-branch (041)** | ⚠️ hard | can't restore old key if new data already violates it |
| RLS widening (org-wide visibility) | ✅ yes | restore prior policies |

Belt-and-suspenders on the irreversible rows: transaction-wrapped + jsonb row snapshots + full
table backups + (recommended) prod PITR checkpoint before running.

---

## 9. Verification (staging via MCP `execute_sql`, then mirror on prod)

- **033 / 038:** `SELECT count(*) … WHERE org_id IS NULL` = 0 before `SET NOT NULL`; after 038,
  membership count == therapist count.
- **034 / 039 dry-runs:** counts match (3 customer / 7 therapist redundant on staging); phoneless
  customers listed+excluded; staff position/gender divergence human-reviewed.
- **035 / 040:** `*_merge_log` count == redundant/approved count; **0 orphan** child rows
  (`bookings.customer_id`, `booking_therapists`, `therapist_attendance` all resolve); totals dropped
  by exactly the merged count.
- **036:** inserting a duplicate `(org_id, phone)` raises a unique violation; phoneless insert ok.
- **041:** new attendance unique exists / old gone; same staff+date at a *different* branch succeeds,
  same branch+date fails.
- **App E2E:** booking a phone seen at another branch links to the canonical org customer (no new
  row) and the autocomplete shows them; a staffer added to two branches appears in both branches'
  lists with independent order; attendance markable per branch. Run `get_advisors` for new warnings.

---

## 10. Open product decisions to confirm before coding
1. **Scope/sequencing:** ✅ **Decided — Customers first**, Staff as a later gated phase (both phases
   documented above). Staff begins only once Customers is live in prod and stable.
2. **PITR:** is it enabled on production? If not, the `*_backup_<date>` SQL copies are the fallback.
3. **Staff toggle/delete semantics (Phase 2):** per-branch (membership) vs identity-wide.
4. **RLS widening:** confirm all org staff seeing all org customers is acceptable.
