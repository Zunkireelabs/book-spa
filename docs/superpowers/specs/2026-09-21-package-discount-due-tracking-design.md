# Package discount + due-balance tracking — design

## Context

Session packages (`packages` table, migration-141) currently record only `paid_amount` —
there's no concept of the package's actual price, any discount applied, or how much (if
anything) is still owed. A prior fix this session locked the "Sessions" and "Paid amount"
fields in `NewPackageModal.jsx` to the selected package type's fixed defaults, assuming
full payment was mandatory. The real business rule, clarified by the user: **the package
price is fixed** (from its type), but **staff can give a discount**, and if the customer
doesn't pay the full (discounted) amount, the remainder is a **due balance attributed to a
named responsible person** — the same `due_holder_name` concept bookings already use
(`migration-042`, `migration-177`/`178`).

Scope, confirmed with the user:
- Discount: staff picks **Percentage** or **Fixed (NPR)** per issuance (a toggle, not both
  applied together) — mirrors `BookingActionModal.jsx`'s existing `discountType` toggle
  exactly (line ~1730).
- Due collection: **out of scope for this round.** Capture `due_holder_name` and the due
  amount at issuance time and surface it in the "Packages Issued" list — no "collect this
  due later" flow/RPC yet (unlike bookings' `recordPayment`). That's a possible future
  round if the business needs it.
- Only `manager`/`admin` roles can reach package issuance at all (`branch-manager-dashboard
  /index.jsx` line 659 gates the whole Packages view to those two roles) — so no
  role-based discount-percent ceiling is needed (bookings' `DISCOUNT_LIMITS`/staff-request
  flow doesn't apply here; manager/admin already direct-apply up to 100% on bookings too).

## Schema

New migration file `supabase/migration-<next>-package-discount-due.sql` (find the next
number via `scripts/migrate-status.sh` or by listing `supabase/migration-*.sql` — do not
guess). Idempotent (`ADD COLUMN IF NOT EXISTS`), matching this repo's migration
conventions.

```sql
ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS base_amount      numeric(10,2),
  ADD COLUMN IF NOT EXISTS discount_type    text CHECK (discount_type IN ('percentage','fixed')),
  ADD COLUMN IF NOT EXISTS discount_value   numeric(10,2),
  ADD COLUMN IF NOT EXISTS discount_amount  numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_amount     numeric(10,2),
  ADD COLUMN IF NOT EXISTS due_holder_name  text;
```

- `base_amount` — the package type's `standard_price` at issuance time (locked, not
  user-editable — the type's price is fixed per the confirmed business rule).
- `discount_type`/`discount_value` — the raw staff input (e.g. `'percentage'`/`10`, or
  `'fixed'`/`2000`).
- `discount_amount` — the computed NPR discount actually applied (always present, defaults
  to `0`), mirrors `bookings.discount_amount`.
- `final_amount` — `base_amount - discount_amount`; the true total owed for this package.
- `due_holder_name` — same convention/column name as `bookings.due_holder_name`.
- `paid_amount` (existing column) keeps its current meaning: amount actually collected.
- **Due is never stored** — always computed as `final_amount - paid_amount`, same
  "derive, don't trust a stored due column" approach `bookings`/`amountDue` already uses.
- All new columns are nullable/defaulted so pre-existing package rows (issued before this
  migration, including ones with no type price at all) aren't broken — for those, due
  tracking simply doesn't apply (treat `final_amount IS NULL` as "not tracked", not "fully
  paid" or "fully due").

## `issue_package` RPC (migration-141, extend via new migration)

Postgres doesn't let `CREATE OR REPLACE FUNCTION` change a function's parameter list in
place — adding params creates a new overload, leaving the old signature as dead code.
Explicitly drop the old signature first:

```sql
DROP FUNCTION IF EXISTS public.issue_package(uuid, uuid, uuid, uuid, text, text, date, date, numeric, int, text);
```

Then recreate with three new trailing params (defaults preserve any caller not yet
updated, though `api.js`'s `issuePackage()` always calls with named args so this is
belt-and-suspenders):

```sql
CREATE OR REPLACE FUNCTION public.issue_package(
  p_org_id          uuid,
  p_branch_id       uuid,
  p_package_type_id uuid,
  p_customer_id     uuid    DEFAULT NULL,
  p_guest_name      text    DEFAULT NULL,
  p_guest_info      text    DEFAULT NULL,
  p_issued_date     date    DEFAULT NULL,
  p_expiry_date     date    DEFAULT NULL,
  p_paid_amount     numeric DEFAULT NULL,
  p_sessions_total  int     DEFAULT NULL,
  p_remarks         text    DEFAULT NULL,
  p_discount_type   text    DEFAULT NULL,
  p_discount_value  numeric DEFAULT NULL,
  p_due_holder_name text    DEFAULT NULL
)
RETURNS public.packages
...
```

New logic inside the existing function body (after `v_type` is loaded, before the
`INSERT`):

1. `v_base_amount := v_type.standard_price` — may be `NULL` for the one legacy package
   type discovered this session with no fixed price (`Annual Package - Sauna` seed row);
   in that case, skip discount/due validation entirely (`v_final_amount` stays `NULL`,
   `v_discount_amount` stays `0`) — matches the graceful fallback already built into the UI
   for that type.
2. If `p_discount_type IS NOT NULL` and `v_base_amount IS NOT NULL`:
   - Validate `p_discount_type IN ('percentage','fixed')`, else raise.
   - `'percentage'`: clamp `p_discount_value` to `[0, 100]`, `v_discount_amount :=
     round(v_base_amount * p_discount_value / 100, 2)`.
   - `'fixed'`: clamp `p_discount_value` to `[0, v_base_amount]`,
     `v_discount_amount := p_discount_value`.
3. `v_final_amount := v_base_amount - v_discount_amount` (only when `v_base_amount IS NOT
   NULL`).
4. Reject overpayment: `IF v_final_amount IS NOT NULL AND p_paid_amount > v_final_amount
   THEN RAISE EXCEPTION 'issue_package: paid_amount cannot exceed the discounted total';`
5. Require a due holder whenever there's a due balance — **mirrors migration-177's exact
   `v_due_holder IS NULL` guard pattern** (`supabase/migration-177-record-group-payment-
   standard.sql` line ~211):
   ```sql
   IF v_final_amount IS NOT NULL AND p_paid_amount < v_final_amount
      AND btrim(COALESCE(p_due_holder_name, '')) = '' THEN
     RAISE EXCEPTION 'issue_package: a responsible person name is required when paid_amount is less than the total due';
   END IF;
   ```
6. `INSERT` gains `base_amount, discount_type, discount_value, discount_amount,
   final_amount, due_holder_name` columns/values.
7. Update the trailing `REVOKE`/`GRANT EXECUTE` statements to the new full signature.

## API layer (`src/services/api.js`)

- `issuePackage({ ...existing params..., discountType, discountValue, dueHolderName })` —
  add the three new params, pass through to the RPC call's named-args object. No new
  client-side validation beyond what already exists (`paidAmountNum < 0` etc.) — the RPC is
  the source of truth for the overpayment/due-holder-required checks (defense in depth: UI
  should also soft-validate before submit so staff gets an inline error rather than a raw
  RPC exception — see UI section).
- `fetchPackages()` (backs "Packages Issued" list) — add `base_amount, discount_type,
  discount_value, discount_amount, final_amount, due_holder_name` to its `select(...)`, and
  in the row transform compute:
  ```js
  dueAmount: row.final_amount != null ? Math.max(0, round2(row.final_amount - row.paid_amount)) : 0
  ```
  (reuse whatever rounding helper the file already has, e.g. the `round2` pattern used
  elsewhere in `api.js`/`PaymentModal.jsx`).

## UI

### `NewPackageModal.jsx` (revises this session's earlier lock-everything change)

- **Sessions** field: stays locked/disabled to the type's `default_sessions` (unchanged —
  discount only affects money, not session count; falls back to editable only for a type
  missing a default, same as already built).
- **Paid amount**: **un-lock** — this field must go back to freely editable. The earlier
  "lock Paid amount too" change this session was based on an incomplete understanding of
  the business rule and should be reverted for this field specifically.
- Add a **Price** line: read-only, shows `formatNPR(selectedType.standard_price)` (or a
  "no fixed price for this type" note when null, matching the existing fallback pattern).
- Add a **Discount** control, shown only when `selectedType?.standard_price != null`:
  toggle between Percentage / Fixed (NPR) (mirror `BookingActionModal.jsx`'s exact toggle
  markup/pattern, ~line 1730) + a numeric input for the value.
- Add a computed, read-only **Total due** line: `formatNPR(finalAmount)` where
  `finalAmount = baseAmount - computedDiscountAmount`.
- **Responsible person** text input: rendered only when `paidAmountNum < finalAmount`
  (i.e. there's a due balance), with client-side validation in `handleSubmit` mirroring the
  RPC's own guard — empty name + due balance → inline error, not a raw RPC exception.
- Existing "Paid amount" summary box (line ~491-494 pre-this-round) can stay, or fold into
  the new Total due / Due summary — use judgment on the cleanest layout, but don't leave
  two redundant "amount" summaries that could show conflicting numbers.

### `PackageListPanel.jsx` ("Packages Issued" table)

- Add a **Due** column next to the existing "Paid" column: `—` when `final_amount` is
  `null` (untracked/legacy row) or `dueAmount === 0`; otherwise the due NPR amount plus the
  responsible person's name, e.g. `NPR 13,280 (Ram Bahadur)`.

## Out of scope (explicitly, per user's answer)

- No "collect this due later" UI/RPC (no package equivalent of `recordPayment` yet).
- No role-based discount ceiling (mirrors bookings' manager/admin unlimited direct-apply,
  since only those two roles can reach this flow at all).
- No backfill of `base_amount`/`final_amount` for packages issued before this migration —
  they stay `NULL` (untracked), not retroactively computed.
