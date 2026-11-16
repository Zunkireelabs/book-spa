// Tax math for invoices (migration-328/329). Three admin-configurable modes —
// see migration-329 for why they're named by behaviour instead of the user's
// ambiguous "included/excluded/extra". `amount` is bookings.final_amount:
// what the customer's booking says they owe BEFORE this calculation, in every
// mode. vat is always computed first; the other figure is derived from it by
// addition/subtraction so the printed lines always sum to the printed total —
// rounding vat and taxable independently can be off by a paisa.
//
// This is a pure mirror of issue_invoice()'s own SQL (migration-328) so the
// UI can show a live preview before issuing — the DB function remains the
// actual source of truth for what gets frozen onto an invoice.
//
// Done in integer paisa with BigInt, not float rupees: Postgres round(numeric,2)
// is exact decimal, half-away-from-zero. Math.round(x*100)/100 on floats drifts
// off that at some rate/amount combinations (e.g. 20% inclusive on 200.13 —
// SQL gives 33.36, float math gives 33.35). At 13% this client's invoices
// never land on a divergent case, but the rate/mode are admin-configurable, so
// another tenant could hit it. This keeps the live preview byte-identical to
// what issue_invoice() actually freezes.

function halfUpDiv(numerator, denominator) {
  const q = numerator / denominator;
  const r = numerator % denominator;
  return r * 2n >= denominator ? q + 1n : q;
}

function toPaisa(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw new Error(`computeInvoiceTax: amount must be a finite number, got ${JSON.stringify(amount)}`);
  }
  return BigInt(Math.round(amount * 100));
}

function toRupee(paisa) {
  return Number(paisa) / 100;
}

export function computeInvoiceTax({ amount, taxMode, vatRate = 13 }) {
  const totalPaisa = toPaisa(amount);
  const rate = Number(vatRate);
  if (typeof rate !== 'number' || !Number.isFinite(rate)) {
    throw new Error(`computeInvoiceTax: vatRate must be a finite number, got ${JSON.stringify(vatRate)}`);
  }
  // rate carried as hundredths so it stays exact (numeric(5,2) in the DB) —
  // e.g. 13 -> 1300, 12.5 -> 1250.
  const rateHundredths = BigInt(Math.round(rate * 100));

  if (taxMode === 'inclusive') {
    const vatPaisa = halfUpDiv(totalPaisa * rateHundredths, 10000n + rateHundredths);
    const taxablePaisa = totalPaisa - vatPaisa;
    return { taxable: toRupee(taxablePaisa), vat: toRupee(vatPaisa), total: toRupee(totalPaisa) };
  }
  if (taxMode === 'addon') {
    const vatPaisa = halfUpDiv(totalPaisa * rateHundredths, 10000n);
    const grandTotalPaisa = totalPaisa + vatPaisa;
    return { taxable: toRupee(totalPaisa), vat: toRupee(vatPaisa), total: toRupee(grandTotalPaisa) };
  }
  if (taxMode === 'none') {
    return { taxable: toRupee(totalPaisa), vat: 0, total: toRupee(totalPaisa) };
  }
  throw new Error(`computeInvoiceTax: unknown taxMode "${taxMode}"`);
}

// Ex-VAT revenue recognition (reports/analytics only — NEVER cash
// reconciliation, receivables, invoice totals, or wallet balances, which all
// stay gross; see the api.js call sites for which bucket each metric is in).
//
// `amount` is bookings.final_amount (or base_amount — same basis, pre-discount
// vs post-discount, both VAT-inclusive-or-not the same way). The ex-VAT
// figure is always computeInvoiceTax's `taxable`:
//   - inclusive: amount contains VAT -> taxable extracts it.
//   - addon: amount IS ALREADY the pre-VAT base (nothing adds VAT at quote
//     time yet) -> taxable just equals amount, no double-extraction.
//   - none: no VAT exists -> taxable equals amount.
//
// Deliberately fails OPEN, not closed, when taxMode is unset: this is the
// opposite of issue_invoice()'s posture. An invoice that can't prove its tax
// basis must not print — printing the wrong number on a legal document is
// worse than not printing. A dashboard that refuses to render because
// billing was never configured is a worse outcome than one showing exactly
// the gross numbers it has always shown. Most orgs today have no tax mode
// set, so this keeps every existing report working unchanged until an org
// deliberately configures billing.
export function toExVatRevenue(amount, { taxMode, vatRate = 13 } = {}) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw new Error(`toExVatRevenue: amount must be a finite number, got ${JSON.stringify(amount)}`);
  }
  if (!taxMode) return amount; // fail open — gross, same as today.
  return computeInvoiceTax({ amount, taxMode, vatRate }).taxable;
}
