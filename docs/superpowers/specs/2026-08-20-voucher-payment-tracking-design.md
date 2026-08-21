# Voucher Payment Tracking — Design Spec

**Date:** 2026-08-20
**Status:** Approved, pending implementation plan

## Problem

Vouchers are issued via a manual staff/manager flow (`issue_voucher()` RPC, migration-075) but the
`vouchers` table has no link to money collected. `discount_percent` only affects the face-value math
(`total_amount_issued`), not payment. Cash/card collected for a voucher sale never enters the
`payments` table, so:

- Daily reconciliation (`DailyClosingPanel` / `getDailySummary()`) undercounts cash in the drawer on
  any day a voucher was sold for cash.
- There is no way to see "voucher sales" as a number anywhere in the app — only a raw voucher list.

## Constraint that shaped this design

`payments.booking_id` is `NOT NULL`, and every reconciliation/report query in `services/api.js` is
booking-first (fetch bookings for a date/branch, then join `payments` by `booking_id`). A voucher
sale has no booking to hang off of, so writing directly into `payments` doesn't fit the schema or the
query pattern without touching a core table every booking financial flow depends on (RLS, the
migration-099 refund trigger, existing report joins).

The codebase already has a precedent for exactly this shape: `membership_transactions` — its own
ledger table, free-text `payment_mode`, nullable `booking_id`, not participating in the `payments`
table at all. This design mirrors that pattern for vouchers.

## Schema

New table, `voucher_payments` (append-only, mirrors `payments`/`membership_transactions` conventions):

```sql
CREATE TABLE public.voucher_payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id   uuid NOT NULL REFERENCES public.vouchers(id),
  org_id       uuid NOT NULL,
  branch_id    uuid NOT NULL,
  amount       numeric(10,2) NOT NULL CHECK (amount > 0),
  payment_mode text NOT NULL CHECK (length(btrim(payment_mode)) > 0 AND length(payment_mode) <= 40),
  recorded_by  uuid NOT NULL,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
```

- RLS: staff/manager/admin can INSERT/SELECT scoped to their own `org_id`/`branch_id` — same shape as
  the `payments` RLS policies. No UPDATE/DELETE policy (immutable, same as `payments`).
- No refund/reversal path in this change — voucher cancel/refund stays an open gap (already tracked
  as such; out of scope here).

## RPC change

Extend `issue_voucher()` (migration-075) in place — single call site (`NewVoucherModal.jsx`), so no
back-compat shim needed:

- New param: `p_tenders jsonb` — array of `{amount, payment_mode}` objects.
- Validation: `sum(p_tenders[].amount)` must equal `total_amount_issued` (computed as today:
  `actual_price - actual_price * discount_percent / 100`). Reject with an exception otherwise —
  mirrors the remaining-balance check in `recordPayment()`.
- In the same transaction as the existing voucher insert: insert one `voucher_payments` row per
  tender, `voucher_id` = the newly minted voucher's id, `recorded_by = auth.uid()`.
- Everything else about `issue_voucher()` (role check, sequential code minting, org/branch scoping)
  is unchanged.

## UI change

`NewVoucherModal.jsx`: add a tender section reusing the existing multi-row tender pattern from
`CollectPaymentPanel` — payment-mode dropdown + amount per row, "add tender," a running
remaining-to-collect indicator that must reach zero before submit is enabled. On submit, `tenders[]`
is passed through the `issueVoucher()` wrapper in `services/api.js` to the RPC.

## Reporting change

`getDailySummary()` (`services/api.js:2402`) currently:
1. Fetches bookings for branch+date.
2. Sums `payments` for those bookings into `paymentBreakdown = { cash, card, fonepay }`.

Add a second query: `voucher_payments` for the branch+date (via `voucher_id → vouchers.issued_date`
or a denormalized date if needed — implementation plan to confirm the exact join), classified into
the same three buckets using the same mode-classification rule used elsewhere
(`CARD_MODES`/`WALLET_MODES`/`DIGITAL_MODES` sets at `api.js:2500-2502`), and **merged into**
`paymentBreakdown` so drawer reconciliation reflects real cash in hand. Also surface a distinct
"voucher sales" sub-total (not just folded silently into booking revenue) so the number is visible in
`DailyClosingPanel`.

## Rollout

- One migration: `voucher_payments` table + RLS + `CREATE OR REPLACE` on `issue_voucher()`.
- **No backfill.** Existing/historical vouchers (including the imported paper-ledger batch,
  `supabase/seed-prod-nuad-vouchers-import.sql`) stay untracked for payment. Only vouchers issued
  after this ships get a `voucher_payments` row. Historical voucher-sales totals in reporting will be
  incomplete for dates before ship — acceptable per product decision.

## Out of scope

- Voucher cancel/refund and any resulting `voucher_payments` reversal.
- Backfilling payment records for existing vouchers.
- A dedicated Voucher Sales report panel (deferred — this ships as a line in `DailyClosingPanel`
  only).
- Online/customer-initiated voucher purchase (vouchers remain a front-desk-only, staff-issued flow).
