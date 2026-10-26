// Checkout with products (V26): the pure rules for who pays what. The database (checkout_booking_with_products, migration-293)
// enforces the same rules, so this module is for the screen: the amount due split, what the entered methods cover, and whether
// "Leave as due" is allowed. No React, no Supabase. Amounts are NPR numbers; everything is rounded to 2 decimals.
//
// The rules
//   * Treatment-only credits (service vouchers, referral vouchers, session packages, the referral wallet) can only pay the treatment.
//   * Plain money methods (cash, card, digital wallet, mobile banking, any other org method) fill the PRODUCTS FIRST, in the order they are
//     listed; the membership wallet only covers what they leave unpaid on the products; the treatment gets what is left.
//   * Products are always paid in full today; only the treatment can stay due.

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Credits that can only pay the treatment. */
export const TREATMENT_ONLY_MODES = ['VoucherWallet', 'ReferralVoucher', 'SessionPackage', 'ReferralWallet'];
export const isTreatmentOnly = (mode) => TREATMENT_ONLY_MODES.includes(mode);

const positive = (tenders) => (tenders || []).filter((t) => Number(t.amount) > 0);

/** Sum of the entered money (non-treatment-only) tenders. */
export const moneyEntered = (tenders) => round2(positive(tenders).filter((t) => !isTreatmentOnly(t.paymentMode)).reduce((s, t) => s + Number(t.amount), 0));
/** Sum of the entered treatment-only tenders (vouchers, packages, referral wallet). */
export const treatmentOnlyEntered = (tenders) => round2(positive(tenders).filter((t) => isTreatmentOnly(t.paymentMode)).reduce((s, t) => s + Number(t.amount), 0));

/**
 * Who pays the products. Treatment-only credits never do. PLAIN money methods (cash, card, digital wallet, mobile banking, any other
 * org method) fill the products first, in the order listed; the Membership wallet only covers what they leave unpaid; the treatment
 * keeps the rest (so by default the wallet pays the treatment). Returns
 *   product:   [{ paymentMode, amount }]   plain money first, then the wallet
 *   treatment: [tender, …]                 everything else, in the original order, reduced by what went to the products
 *   shortfall: products total no money method could cover (0 = covered).
 */
export function allocateProductsFirst(tenders, productsTotal) {
  let need = round2(productsTotal);
  const rows = positive(tenders).map((t) => ({ t, left: round2(t.amount) }));
  const product = [];
  [false, true].forEach((walletPass) => {
    rows.forEach((r) => {
      if (need <= 0 || r.left <= 0 || isTreatmentOnly(r.t.paymentMode)) return;
      if ((r.t.paymentMode === 'Membership') !== walletPass) return;
      const take = Math.min(r.left, need);
      product.push({ paymentMode: r.t.paymentMode, amount: take });
      r.left = round2(r.left - take);
      need = round2(need - take);
    });
  });
  const treatment = rows.filter((r) => r.left > 0).map((r) => ({ ...r.t, amount: r.left }));
  return { product, treatment, shortfall: need };
}

/** Each product line's share of the product payments, in line order (for the receipt): [[{ paymentMode, amount }], …]. */
export function splitAcrossLines(lineTotals, productPayments) {
  const queue = (productPayments || []).map((p) => ({ ...p }));
  return lineTotals.map((total) => {
    let left = round2(total);
    const out = [];
    for (const p of queue) {
      if (left <= 0) break;
      if (p.amount <= 0) continue;
      const take = Math.min(p.amount, left);
      out.push({ paymentMode: p.paymentMode, amount: take });
      p.amount = round2(p.amount - take);
      left = round2(left - take);
    }
    return out;
  });
}

/** Quantity cap for a line: never more than the stock left (stock null/undefined = not counted = no cap); at least 1. */
export const capQty = (qty, stock) => {
  const q = Math.max(1, Math.floor(Number(qty) || 1));
  return stock == null ? q : Math.max(1, Math.min(q, Math.floor(stock)));
};
/** Can the + button add one more? */
export const canAddOne = (qty, stock) => stock == null || Number(qty) < Number(stock);

export const lineTotal = (price, qty) => round2(Number(price) * Number(qty));
export const productsTotalOf = (lines) => round2((lines || []).reduce((s, l) => s + lineTotal(l.price, l.qty), 0));

/**
 * The state of the payment against the bill:
 *   grandTotal  = treatment due (+ other bookings) + products
 *   leftover    = what is not covered yet (only ever the treatment may stay due)
 *   minMoney    = the least money that must be entered (the products total)
 *   belowProducts / canLeaveDue / dueOnTreatment
 */
export function dueState({ treatmentDue, productsTotal, tenders }) {
  const products = round2(productsTotal);
  const grandTotal = round2(treatmentDue + products);
  const entered = round2(positive(tenders).reduce((s, t) => s + Number(t.amount), 0));
  const money = moneyEntered(tenders);
  const leftover = round2(Math.max(grandTotal - entered, 0));
  const belowProducts = products > 0 && money + 0.001 < products;
  return {
    grandTotal, entered, money, leftover, minMoney: products, belowProducts,
    shortBy: belowProducts ? round2(products - money) : 0,
    // Leaving a gap is fine only when the products are fully covered by money (the gap is then all treatment).
    canLeaveDue: leftover > 0 && !belowProducts,
    dueOnTreatment: leftover > 0 && !belowProducts,
  };
}

/** Voucher / package money entered above what the treatment needs would have nowhere to go. */
export const treatmentOnlyOverflow = (tenders, treatmentDue) => round2(Math.max(treatmentOnlyEntered(tenders) - round2(treatmentDue), 0));

/** The amount the Collect button shows: "Collect 3,840" or, with a gap on the treatment, "Collect 2,300 · 1,540 due". */
export function collectLabel({ entered, leftover }) {
  const f = (n) => Number(n).toLocaleString('en-IN');
  return leftover > 0 ? `Collect ${f(entered)} · ${f(leftover)} due` : `Collect NPR ${f(entered)}`;
}

/** Stock a line can still use: its stock minus what other lines of the same size already take (lines are one per size, so just the stock). */
export const stockLeft = (stock, qty) => (stock == null ? null : Math.max(0, Number(stock) - Number(qty || 0)));

/**
 * The server says stock changed ("<name>: only 1 left at <branch>", HINT "STOCK:<variantId>:<left>"). Returns { variantId, left, message }
 * or null when the error is something else.
 */
export function parseStockError(error) {
  if (!error) return null;
  const hint = String(error.hint || '');
  const m = hint.match(/^STOCK:([0-9a-f-]{36}):(\d+)$/i);
  if (!m) return null;
  return { variantId: m[1], left: Number(m[2]), message: String(error.message || '').replace(/^\s*[a-z][a-z0-9_]*:\s+/, '') };
}
