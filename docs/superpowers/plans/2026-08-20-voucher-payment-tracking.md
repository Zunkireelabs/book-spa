# Voucher Payment Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record how a voucher sale was paid for (cash/card/etc) at issue time, so voucher revenue stops being invisible to daily cash reconciliation.

**Architecture:** New append-only `voucher_payments` ledger table (mirrors `membership_transactions`, not `payments` — `payments.booking_id` is `NOT NULL` and every report query is booking-first, so vouchers can't hang off it). `issue_voucher()` is extended to accept tenders and insert both the voucher and its payment rows in one transaction. `NewVoucherModal` gets a tender UI reusing `PaymentMethodSelector`. `getDailySummary()` merges voucher tenders into the existing `paymentBreakdown` cash/card/digital totals plus a distinct voucher-sales sub-total, and `DailyClosingPanel` renders it.

**Tech Stack:** React 18, Supabase (Postgres + RLS + RPC), plain JS `services/api.js`. No test runner configured in this repo — validation is `npm run build` plus manual SQL verification (psql against staging, per project convention) and manual browser verification (dev server on port 4028), not `pytest`/`jest`.

**Spec:** `docs/superpowers/specs/2026-08-20-voucher-payment-tracking-design.md`

## Global Constraints

- No backfill — only vouchers issued after this ships get a `voucher_payments` row.
- `voucher_payments` is append-only: no UPDATE/DELETE RLS policy, matching `payments`/`membership_transactions` immutability.
- Tenders must sum exactly to the voucher's `total_amount_issued` — no partial/deferred voucher payment.
- `payment_mode` is free text, same convention as `payments`/`membership_transactions` (`length(btrim(payment_mode)) > 0 AND length(payment_mode) <= 40`).
- Dropdowns must use `CustomSelect`/`PaymentMethodSelector` — never a native `<select>`.
- Use `git diff`/read the actual current file before editing — line numbers below were correct at plan-writing time but may drift.

---

### Task 1: Migration — `voucher_payments` table + RLS + `issue_voucher()` extension

**Files:**
- Create: `supabase/migration-100-voucher-payments.sql`

**Interfaces:**
- Produces: table `public.voucher_payments(id, voucher_id, org_id, branch_id, amount, payment_mode, recorded_by, notes, created_at)`; RPC `public.issue_voucher(p_branch_id uuid, p_voucher_type_id uuid, p_guest_name text, p_guest_info text, p_discount_percent numeric, p_actual_price numeric, p_issued_date date, p_expiry_date date, p_remarks text, p_customer_id uuid, p_tenders jsonb) RETURNS public.vouchers` — note the new required `p_tenders` param is appended at the end so any stale cached PostgREST schema still resolves the old 10-arg overload to a real (now-failing on tenders) function rather than silently matching a different one.

- [ ] **Step 1: Write the migration file**

Base it on the current `issue_voucher()` body (`supabase/migration-089-fix-voucher-code-counter-collision.sql:69-160`, reproduced below with tender handling added) and the `voucher_code_counters` prefix-keyed sequence introduced there — do not regress it to the older `voucher_type_id`-keyed version from migration-072/075.

```sql
-- ============================================================
-- Migration 100: Voucher payment tracking
-- ============================================================
--
-- vouchers has no link to money collected — discount_percent only affects
-- total_amount_issued (face value), not payment. Cash/card collected for a
-- voucher sale never entered any payments-shaped table, so daily
-- reconciliation (getDailySummary/DailyClosingPanel) undercounts cash on any
-- day a voucher was sold for cash, and there's no "voucher sales" number
-- anywhere in the app.
--
-- payments.booking_id is NOT NULL and every report query is booking-first
-- (fetch bookings, join payments by booking_id) — a voucher sale has no
-- booking, so it can't live in payments without touching a core table every
-- booking financial flow depends on. membership_transactions already solves
-- this exact shape (its own ledger, free-text payment_mode, no payments
-- link) — voucher_payments mirrors it.
--
-- No backfill: historical vouchers (including the imported paper-ledger
-- batch) stay untracked for payment. Only vouchers issued after this ships
-- get a voucher_payments row.
--
-- Safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.voucher_payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id   uuid NOT NULL REFERENCES public.vouchers(id),
  org_id       uuid NOT NULL,
  branch_id    uuid NOT NULL,
  amount       numeric(10,2) NOT NULL CHECK (amount > 0),
  payment_mode text NOT NULL,
  recorded_by  uuid NOT NULL,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT voucher_payments_payment_mode_check
    CHECK (length(btrim(payment_mode)) > 0 AND length(payment_mode) <= 40)
);

CREATE INDEX IF NOT EXISTS voucher_payments_voucher_id_idx ON public.voucher_payments(voucher_id);
CREATE INDEX IF NOT EXISTS voucher_payments_branch_created_idx ON public.voucher_payments(branch_id, created_at);

ALTER TABLE public.voucher_payments ENABLE ROW LEVEL SECURITY;

-- Read access matches vouchers itself: manager/admin/admin_viewer only —
-- staff get a create action (via issue_voucher), not a financial ledger view.
DROP POLICY IF EXISTS "Manager/admin can read own org voucher payments" ON public.voucher_payments;
CREATE POLICY "Manager/admin can read own org voucher payments"
  ON public.voucher_payments FOR SELECT
  TO authenticated
  USING (org_id = get_user_org_id() AND get_user_role() IN ('manager','admin','admin_viewer'));

-- NO direct INSERT/UPDATE/DELETE policy — writes go through issue_voucher()
-- (SECURITY DEFINER, same as vouchers itself). Append-only.

-- ---- issue_voucher(): accept tenders, write voucher_payments atomically ----

CREATE OR REPLACE FUNCTION public.issue_voucher(
  p_branch_id uuid,
  p_voucher_type_id uuid,
  p_guest_name text,
  p_guest_info text DEFAULT NULL,
  p_discount_percent numeric DEFAULT 0,
  p_actual_price numeric DEFAULT NULL,
  p_issued_date date DEFAULT NULL,
  p_expiry_date date DEFAULT NULL,
  p_remarks text DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL,
  p_tenders jsonb DEFAULT NULL
)
RETURNS public.vouchers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role         user_role := get_user_role();
  v_org          uuid      := get_user_org_id();
  v_branch_org   uuid;
  v_customer_org uuid;
  v_type         record;
  v_seq          int;
  v_code         text;
  v_actual_price numeric(10,2);
  v_issued       date := COALESCE(p_issued_date, (now() AT TIME ZONE 'Asia/Kathmandu')::date);
  v_expiry       date := COALESCE(p_expiry_date, v_issued + interval '90 days');
  v_row          public.vouchers;
  v_total        numeric(10,2);
  v_tender       jsonb;
  v_tender_sum   numeric(10,2) := 0;
  v_tender_amt   numeric(10,2);
  v_tender_mode  text;
BEGIN
  IF v_role NOT IN ('staff','manager','admin') THEN
    RAISE EXCEPTION 'issue_voucher: staff, manager, or admin role required';
  END IF;

  IF p_guest_name IS NULL OR length(btrim(p_guest_name)) = 0 THEN
    RAISE EXCEPTION 'issue_voucher: guest name is required';
  END IF;

  IF p_tenders IS NULL OR jsonb_typeof(p_tenders) != 'array' OR jsonb_array_length(p_tenders) = 0 THEN
    RAISE EXCEPTION 'issue_voucher: at least one payment tender is required';
  END IF;

  SELECT org_id INTO v_branch_org FROM public.branches WHERE id = p_branch_id;
  IF v_branch_org IS NULL OR v_branch_org IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'issue_voucher: branch is not in your organization';
  END IF;

  IF p_customer_id IS NOT NULL THEN
    SELECT org_id INTO v_customer_org FROM public.customers WHERE id = p_customer_id;
    IF v_customer_org IS NULL OR v_customer_org IS DISTINCT FROM v_org THEN
      RAISE EXCEPTION 'issue_voucher: customer is not in your organization';
    END IF;
  END IF;

  SELECT * INTO v_type FROM public.voucher_types
  WHERE id = p_voucher_type_id AND org_id = v_org;
  IF v_type IS NULL THEN
    RAISE EXCEPTION 'issue_voucher: voucher type not found in your organization';
  END IF;

  IF p_discount_percent IS NULL OR p_discount_percent < 0 OR p_discount_percent > 100 THEN
    RAISE EXCEPTION 'issue_voucher: discount_percent must be between 0 and 100';
  END IF;

  IF v_expiry < v_issued THEN
    RAISE EXCEPTION 'issue_voucher: expiry_date cannot be before issued_date';
  END IF;

  v_actual_price := COALESCE(p_actual_price, v_type.standard_price);
  v_total := round(v_actual_price - (v_actual_price * p_discount_percent / 100), 2);

  -- Validate tenders sum to the voucher's total before touching any table.
  FOR v_tender IN SELECT * FROM jsonb_array_elements(p_tenders)
  LOOP
    v_tender_amt := (v_tender->>'amount')::numeric;
    v_tender_mode := v_tender->>'payment_mode';
    IF v_tender_amt IS NULL OR v_tender_amt <= 0 THEN
      RAISE EXCEPTION 'issue_voucher: each tender amount must be greater than zero';
    END IF;
    IF v_tender_mode IS NULL OR length(btrim(v_tender_mode)) = 0 THEN
      RAISE EXCEPTION 'issue_voucher: each tender must have a payment_mode';
    END IF;
    v_tender_sum := v_tender_sum + v_tender_amt;
  END LOOP;

  IF v_tender_sum != v_total THEN
    RAISE EXCEPTION 'issue_voucher: tenders total % does not match voucher total %', v_tender_sum, v_total;
  END IF;

  -- Keyed by code_prefix (not voucher_type_id): sibling types that share a
  -- prefix (e.g. the three "Full Body Oil Massage" durations, all "NT 4326")
  -- draw from one shared sequence, matching what the code text depends on.
  INSERT INTO public.voucher_code_counters (org_id, branch_id, code_prefix, next_number)
  VALUES (v_org, p_branch_id, v_type.code_prefix, 2)
  ON CONFLICT (branch_id, code_prefix)
    DO UPDATE SET next_number = public.voucher_code_counters.next_number + 1
  RETURNING next_number - 1 INTO v_seq;

  v_code := v_type.code_prefix || '-' || lpad(v_seq::text, 4, '0');

  INSERT INTO public.vouchers (
    org_id, branch_id, voucher_type_id, voucher_code, issued_date, expiry_date,
    guest_name, guest_info, actual_price, discount_percent, total_amount_issued,
    remarks, issued_by, customer_id
  )
  VALUES (
    v_org, p_branch_id, p_voucher_type_id, v_code, v_issued, v_expiry,
    btrim(p_guest_name), p_guest_info, v_actual_price, p_discount_percent,
    v_total,
    p_remarks, auth.uid(), p_customer_id
  )
  RETURNING * INTO v_row;

  FOR v_tender IN SELECT * FROM jsonb_array_elements(p_tenders)
  LOOP
    INSERT INTO public.voucher_payments (voucher_id, org_id, branch_id, amount, payment_mode, recorded_by)
    VALUES (
      v_row.id, v_org, p_branch_id,
      (v_tender->>'amount')::numeric,
      v_tender->>'payment_mode',
      auth.uid()
    );
  END LOOP;

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_voucher(uuid, uuid, text, text, numeric, numeric, date, date, text, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_voucher(uuid, uuid, text, text, numeric, numeric, date, date, text, uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.issue_voucher(uuid, uuid, text, text, numeric, numeric, date, date, text, uuid, jsonb) TO authenticated;

-- ============================================================
-- MIGRATION 100 COMPLETE
-- ============================================================

INSERT INTO public.schema_migrations (version, name)
VALUES ('100', 'voucher-payments')
ON CONFLICT (version) DO NOTHING;
```

- [ ] **Step 2: Apply to staging and verify the happy path**

Run (per `scripts/migrate-apply.sh` / staging psql target from project memory):
```bash
psql "$STAGING_DB_URL" -f supabase/migration-100-voucher-payments.sql
```
Then verify with a manual RPC call against staging as an existing staff/manager user (adjust ids to real staging rows):
```sql
select * from issue_voucher(
  p_branch_id := '<real branch id>',
  p_voucher_type_id := '<real voucher type id>',
  p_guest_name := 'Plan Test Guest',
  p_discount_percent := 0,
  p_actual_price := 1000,
  p_tenders := '[{"amount": 600, "payment_mode": "Cash"}, {"amount": 400, "payment_mode": "Card"}]'::jsonb
);
```
Expected: one `vouchers` row returned with `total_amount_issued = 1000`, and:
```sql
select * from voucher_payments where voucher_id = '<returned id>';
```
Expected: two rows, amounts 600 (Cash) and 400 (Card), summing to 1000.

- [ ] **Step 3: Verify the rejection paths**

```sql
-- mismatched total — must raise
select issue_voucher(p_branch_id := '<id>', p_voucher_type_id := '<id>', p_guest_name := 'X',
  p_actual_price := 1000, p_tenders := '[{"amount": 500, "payment_mode": "Cash"}]'::jsonb);
-- missing tenders — must raise
select issue_voucher(p_branch_id := '<id>', p_voucher_type_id := '<id>', p_guest_name := 'X',
  p_actual_price := 1000, p_tenders := null);
```
Expected: both raise the exceptions added in Step 1 (`tenders total ... does not match`, `at least one payment tender is required`).

- [ ] **Step 4: Commit**

```bash
git add supabase/migration-100-voucher-payments.sql
git commit -m "feat(db): track voucher payment tenders in voucher_payments"
```

---

### Task 2: `services/api.js` — extend `issueVoucher()` to pass tenders

**Files:**
- Modify: `src/services/api.js:8096-8124` (`issueVoucher`)

**Interfaces:**
- Consumes: RPC `issue_voucher(..., p_tenders jsonb)` from Task 1.
- Produces: `issueVoucher({ branchId, voucherTypeId, guestName, guestInfo, discountPercent, actualPrice, issuedDate, expiryDate, remarks, customerId, tenders }) → { data: voucherRow, error }` where `tenders` is `[{ amount: number, paymentMode: string }]`.

- [ ] **Step 1: Edit `issueVoucher()`**

```javascript
export async function issueVoucher({
  branchId, voucherTypeId, guestName, guestInfo = null, discountPercent = 0,
  actualPrice = null, issuedDate = null, expiryDate = null, remarks = null,
  customerId = null, tenders = [],
}) {
  try {
    const { error: authError } = await getAuthenticatedUser();
    if (authError) return { data: null, error: authError };

    if (!Array.isArray(tenders) || tenders.length === 0) {
      return { data: null, error: { code: 'TENDERS_REQUIRED', message: 'At least one payment tender is required.' } };
    }

    const cleanedTenders = tenders
      .filter((t) => Number(t.amount) > 0 && t.paymentMode)
      .map((t) => ({ amount: Number(t.amount), payment_mode: t.paymentMode }));

    const { data, error } = await supabase.rpc('issue_voucher', {
      p_branch_id: branchId,
      p_voucher_type_id: voucherTypeId,
      p_guest_name: guestName,
      p_guest_info: guestInfo,
      p_discount_percent: discountPercent,
      p_actual_price: actualPrice,
      p_issued_date: issuedDate,
      p_expiry_date: expiryDate,
      p_remarks: remarks,
      p_customer_id: customerId,
      p_tenders: cleanedTenders,
    });
    if (error) throw error;
    capture('voucher_issued', { voucher_type_id: voucherTypeId, branch_id: branchId, linked_to_customer: !!customerId });
    return { data, error: null };
  } catch (error) {
    console.error('[API] issueVoucher error:', error.message);
    return { data: null, error };
  }
}
```

Note: the RPC is the source of truth for the sum-must-match-total check (Task 1, Step 1) — this client-side filter only strips empty/zero rows before sending, it does not re-validate the total.

- [ ] **Step 2: Verify with `npm run build`**

Run: `npm run build`
Expected: build succeeds with no errors (no runner to unit-test this function against; the RPC-level checks from Task 1 Step 2/3 are the correctness proof for this task, since the wrapper only forwards the payload — real verification happens end-to-end in Task 3).

- [ ] **Step 3: Commit**

```bash
git add src/services/api.js
git commit -m "feat(api): pass voucher payment tenders to issue_voucher"
```

---

### Task 3: `NewVoucherModal.jsx` — tender UI

**Files:**
- Modify: `src/pages/branch-manager-dashboard/components/Vouchers/NewVoucherModal.jsx`

**Interfaces:**
- Consumes: `issueVoucher({ ..., tenders })` from Task 2; `PaymentMethodSelector` (`src/components/ui/PaymentMethodSelector.jsx`, props `{ value, onChange, paymentMethods, placeholder, size }`); `useOrg()` (`src/contexts/OrgContext.jsx`) which exposes `paymentMethods` (already the org's configured list, via `getOrgPaymentMethods`).
- Produces: nothing consumed by later tasks — this is the UI leaf.

- [ ] **Step 1: Add tender state and helpers**

Near the existing `discountPercent`/`remarks` state (around line 39-48), add:

```javascript
const [tenders, setTenders] = useState([{ amount: '', paymentMode: 'Cash' }]);

const addTender = () => setTenders((prev) => [...prev, { amount: '', paymentMode: 'Cash' }]);
const removeTender = (i) => setTenders((prev) => prev.filter((_, idx) => idx !== i));
const updateTender = (i, patch) => setTenders((prev) => prev.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));

const tenderTotal = useMemo(
  () => tenders.reduce((s, t) => s + (Number(t.amount) > 0 ? Number(t.amount) : 0), 0),
  [tenders]
);
const tenderRemaining = useMemo(() => Math.round((totalAmount - tenderTotal) * 100) / 100, [totalAmount, tenderTotal]);
```

(`totalAmount` is the existing computed face-value `useMemo` at line 105.)

Import `useOrg` at the top:
```javascript
import { useOrg } from '../../../../contexts/OrgContext';
import PaymentMethodSelector from '../../../../components/ui/PaymentMethodSelector';
```
And inside the component:
```javascript
const { paymentMethods } = useOrg();
```

- [ ] **Step 2: Render the tender rows**

Add a section in the form (after the discount/remarks fields, before the submit button) — follow the file's existing Tailwind conventions (spacing, `font-body`, `text-text-secondary`, etc. — match whatever's already used a few lines up rather than inventing new classes):

```jsx
<div className="space-y-2">
  <div className="flex items-center justify-between">
    <label className="font-body font-body-medium text-sm text-text-primary">
      Payment{tenders.length > 1 ? 's' : ''} Collected
    </label>
    <button type="button" onClick={addTender} className="flex items-center gap-1 text-sm text-primary hover:underline">
      + Add method
    </button>
  </div>
  {tenders.map((t, i) => (
    <div key={i} className="flex items-center gap-2">
      <div className="w-36 flex-shrink-0">
        <PaymentMethodSelector
          paymentMethods={paymentMethods}
          value={t.paymentMode}
          onChange={(v) => updateTender(i, { paymentMode: v })}
          size="md"
        />
      </div>
      <div className="relative flex-1">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-secondary">NPR</span>
        <input
          type="number"
          min="0"
          step="0.01"
          value={t.amount}
          onChange={(e) => updateTender(i, { amount: e.target.value })}
          placeholder="0"
          className="w-full rounded-spa border border-border bg-surface pl-11 pr-3 py-2 font-data text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary spa-transition-fast"
        />
      </div>
      {tenders.length > 1 && (
        <button type="button" onClick={() => removeTender(i)} className="p-2 rounded-spa hover:bg-error/10 text-error spa-transition-fast" aria-label="Remove method">
          &times;
        </button>
      )}
    </div>
  ))}
  <p className={`text-xs font-caption ${tenderRemaining === 0 ? 'text-success' : 'text-warning'}`}>
    {tenderRemaining === 0 ? 'Fully collected.' : `Remaining to collect: ${formatNPR(tenderRemaining)}`}
  </p>
</div>
```

- [ ] **Step 3: Wire into submit + disable submit until fully collected**

Find the existing submit handler (search for `issueVoucher(` in the file). Add `tenderRemaining !== 0` to whatever guard already disables the submit button (same pattern the file uses for its other validation — read the current guard before editing), and pass tenders through:

```javascript
const { data, error: submitError } = await issueVoucher({
  branchId,
  voucherTypeId,
  guestName,
  guestInfo: /* existing guest info construction, unchanged */,
  discountPercent: discountNum,
  actualPrice: actualPriceNum,
  issuedDate,
  expiryDate,
  remarks,
  customerId: linkedCustomerId,
  tenders: tenders.filter((t) => Number(t.amount) > 0).map((t) => ({ amount: Number(t.amount), paymentMode: t.paymentMode })),
});
```

Also add a pre-submit guard: if `tenderRemaining !== 0`, set an error (`'Payment amount must equal the voucher total.'`) and return before calling `issueVoucher()` — don't rely solely on the RPC's rejection for the common case, so the user gets an immediate in-form message rather than a round-trip error.

- [ ] **Step 4: Manual verification in the browser**

Run: `npm start` (port 4028), log in as a manager/admin/staff on staging, open the manager dashboard → Vouchers → New Voucher.
Check:
- Default single Cash row, amount empty, "Remaining to collect" shows the full voucher total once a type/price is picked.
- Splitting into two tenders (e.g. partial Cash + partial Card) that sum to the total clears the warning and enables submit.
- Submitting with a mismatched total is blocked in-form (no round-trip).
- Successful submit shows the existing success screen with the issued voucher code.
- Payment mode dropdown renders via `PaymentMethodSelector` (not a native `<select>`).

- [ ] **Step 5: Commit**

```bash
git add src/pages/branch-manager-dashboard/components/Vouchers/NewVoucherModal.jsx
git commit -m "feat(ui): collect payment tenders when issuing a voucher"
```

---

### Task 4: `getDailySummary()` — fold voucher payments into reconciliation

**Files:**
- Modify: `src/services/api.js:2402-2489` (`getDailySummary`)

**Interfaces:**
- Consumes: `voucher_payments` table (Task 1), joined via `vouchers.issued_date`/`branch_id` — same pattern the function already uses for bookings→payments (fetch vouchers for date+branch, then their payments by `voucher_id`, not a direct date filter on `voucher_payments` itself).
- Produces: `getDailySummary()` return shape gains one new field: `voucherSalesTotal: number`. `paymentBreakdown.{cash,card,fonepay}` now include voucher tenders — this is a behavior change later tasks (Task 5) depend on.

- [ ] **Step 1: Add the voucher query and merge into `paymentBreakdown`**

Insert after the existing booking-payments block (after the closing `}` of the `if (settledBookingIds.length > 0) { ... }` block, before step "5. Check if day is already closed"):

```javascript
    // 4b. Voucher sales collected today — same cash-in-drawer money as booking
    // payments, so it folds into the same paymentBreakdown buckets (that's the
    // whole point: voucher cash was previously invisible to reconciliation).
    let voucherSalesTotal = 0;
    let vouchersQuery = supabase
      .from('vouchers')
      .select('id')
      .eq('issued_date', date);
    vouchersQuery = withBranch(vouchersQuery, branchId);
    const { data: vouchersToday, error: vouchersError } = await vouchersQuery;
    if (vouchersError) throw vouchersError;

    const voucherIds = (vouchersToday || []).map((v) => v.id);
    if (voucherIds.length > 0) {
      const { data: voucherPayments, error: voucherPaymentsError } = await supabase
        .from('voucher_payments')
        .select('amount, payment_mode')
        .in('voucher_id', voucherIds);
      if (voucherPaymentsError) throw voucherPaymentsError;

      for (const p of (voucherPayments || [])) {
        const amount = Number(p.amount);
        voucherSalesTotal += amount;
        netRevenue += amount;
        if (p.payment_mode === 'Cash') {
          paymentBreakdown.cash += amount;
        } else if (p.payment_mode.includes('Card')) {
          paymentBreakdown.card += amount;
        } else {
          paymentBreakdown.fonepay += amount;
        }
      }
    }
```

Then add `voucherSalesTotal` to the returned `data` object (in the existing `return { data: { ... } }` block):
```javascript
        paymentBreakdown,
        voucherSalesTotal,
        unpaidCount,
```

Note: `voucher_payments` SELECT RLS (Task 1) is manager/admin/admin_viewer-only, matching who can view `DailyClosingPanel` — no RLS gap here since this function is only called from manager-facing screens.

- [ ] **Step 2: Verify with `npm run build`**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 3: Manual verification against staging**

Using the voucher issued in Task 1 Step 2 (or a fresh one issued via the UI in Task 3 Step 4) with a known split (e.g. 600 Cash + 400 Card, `issued_date` = today), call `getDailySummary(branchId, today)` from the browser console or a temporary log in `DailyClosingPanel`, and confirm:
- `voucherSalesTotal` includes the 1000.
- `paymentBreakdown.cash` includes the 600, `paymentBreakdown.card` includes the 400 (on top of whatever booking payments already contributed that day).

- [ ] **Step 4: Commit**

```bash
git add src/services/api.js
git commit -m "feat(api): fold voucher payments into daily reconciliation"
```

---

### Task 5: `DailyClosingPanel.jsx` — show voucher sales sub-line

**Files:**
- Modify: `src/pages/branch-manager-dashboard/components/DailyClosingPanel.jsx` (Payment Breakdown card, around line 223-255)

**Interfaces:**
- Consumes: `summary.voucherSalesTotal` from Task 4.

- [ ] **Step 1: Add the sub-line**

Inside the "Payment Mode Breakdown" card, after the three existing Cash/Card/Fonepay rows and before the closing `</div>` of `space-y-3` (around line 253), add:

```jsx
{summary.voucherSalesTotal > 0 && (
  <div className="border-t border-border pt-2 flex items-center justify-between">
    <div className="flex items-center space-x-2">
      <Icon name="Ticket" size={14} className="text-text-secondary" />
      <span className="font-body font-body-normal text-sm text-text-secondary">of which: Voucher Sales</span>
    </div>
    <span className="font-body font-body-semibold text-sm text-text-primary">
      {formatNPR(summary.voucherSalesTotal)}
    </span>
  </div>
)}
```

(Confirm `Icon name="Ticket"` exists in the icon set used elsewhere in this codebase — if not, use `Icon name="Receipt"` or whatever the Vouchers panel already uses, e.g. check `VoucherOverviewPanel.jsx` for the icon name it uses for vouchers.)

- [ ] **Step 2: Manual verification in the browser**

With the dev server running (`npm start`) and a voucher issued today (from Task 3/4's verification), open Manager Dashboard → Daily Reconciliation for today's date.
Check:
- "of which: Voucher Sales" row appears under Payment Breakdown showing the correct total.
- Cash/Card totals above it visibly include the voucher's contribution (compare against what they'd be from bookings alone).
- On a date with no vouchers issued, the sub-line doesn't render at all (the `> 0` guard).

- [ ] **Step 3: Commit**

```bash
git add src/pages/branch-manager-dashboard/components/DailyClosingPanel.jsx
git commit -m "feat(ui): show voucher sales in daily reconciliation"
```

---

### Task 6: End-to-end smoke test + promotion note

**Files:** none (verification only)

- [ ] **Step 1: Full build check**

Run: `npm run build`
Expected: succeeds with no errors, as the final gate before this is considered done (per CLAUDE.md Quality Standards #1).

- [ ] **Step 2: Full manual flow on staging**

As staff: issue a voucher with a split cash+card payment. As manager: confirm it shows in Daily Reconciliation for that date, folded into the right payment-mode buckets, with the voucher-sales sub-line visible. Confirm an existing (pre-migration) voucher still displays fine in the voucher list/detail views (no payment history expected for it — that's correct per the no-backfill decision, not a bug).

- [ ] **Step 3: Note the promotion requirement**

Per `CLAUDE.md`'s DB promotion rules: `supabase/migration-100-voucher-payments.sql` is a proper migration file, so CI's `migrate` job will apply it to prod automatically on merge to `main` — no manual dashboard step needed for this change. Flag this explicitly when the PR is opened, so whoever merges `stage → main` knows migration-100 is included.

- [ ] **Step 4: Update session log per session-log skill conventions if this work spans a session boundary**

Not automated by this plan — leave for whoever executes it, since it depends on which session(s) actually did the work.
