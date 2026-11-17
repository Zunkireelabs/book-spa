// The one "money today" rule (ZNLY-232). SQL twin: _dashboard_money_in / _dashboard_refunds / _dashboard_net (migration 391).
//
//   moneyIn      = every real tender taken that Nepal day: booking payments + product sales + voucher sales + membership top-ups + package sales
//   refunds      = money handed back that day (booking refunds + product sales refunded today that were sold on an earlier day)
//   taken        = moneyIn - refunds
//   cashExpected = cash in - refunds
//   byMethod     = one row per real method name, so  sum(byMethod) - refunds = taken  and the rows on screen always add up.
//
// Wallet / voucher-balance / package tenders are NOT money in: their value was recognised when the credit was bought.
// The dashboard's Close card, the Daily Reconciliation and the Daily Operational Report all show these same figures.

export const WALLET_MODES = new Set(['Membership', 'ReferralWallet', 'VoucherWallet', 'ReferralVoucher']);

// One spelling per known mode ('cash' -> 'Cash'); an org's own method name is kept as typed. SQL twin: _dashboard_canon_mode.
const KNOWN = ['Cash', 'Card', 'MobileBanking', 'Cheque', 'Esewa', 'Khalti', 'Membership', 'SessionPackage', 'ReferralWallet', 'VoucherWallet', 'ReferralVoucher'];
const KNOWN_BY_LOWER = Object.fromEntries(KNOWN.map((m) => [m.toLowerCase(), m]));
export function canonicalMode(mode) {
  const t = String(mode ?? '').trim();
  return KNOWN_BY_LOWER[t.toLowerCase()] || t;
}

// True when a payment mode is real money in (not a wallet / voucher balance / session package redemption).
export function isTendered(mode) {
  const m = canonicalMode(mode);
  return !!m && m !== 'SessionPackage' && !WALLET_MODES.has(m);
}

const LABELS = { MobileBanking: 'Mobile banking', Esewa: 'eSewa', Khalti: 'Khalti', Cash: 'Cash', Card: 'Card', Cheque: 'Cheque' };
// The org's own method name when it has one (e.g. "Nabil Card"), a readable name for the built-in codes.
export function methodLabel(mode) {
  return LABELS[canonicalMode(mode)] || String(mode || 'Other');
}

// byMode: { 'Cash': 900, 'Khalti': 500, ... } (non-tendered modes are ignored), refunds: number.
export function foldDayMoney({ byMode = {}, refunds = 0 } = {}) {
  const merged = {};
  for (const [m, v] of Object.entries(byMode || {})) if (isTendered(m)) merged[canonicalMode(m)] = (merged[canonicalMode(m)] || 0) + Number(v);
  const rows = Object.entries(merged)
    .filter(([, v]) => v !== 0)
    .map(([m, v]) => ({ method: m, label: methodLabel(m), amount: v }))
    .sort((a, b) => (a.method === 'Cash' ? -1 : b.method === 'Cash' ? 1 : b.amount - a.amount));
  const moneyIn = rows.reduce((s, r) => s + r.amount, 0);
  const refunded = Number(refunds) || 0;
  const cashIn = rows.find((r) => r.method === 'Cash')?.amount || 0;
  return { byMethod: rows, moneyIn, refunds: refunded, taken: moneyIn - refunded, cashExpected: cashIn - refunded };
}

// Adds one tender into a { mode: amount } map (skipping non-tendered modes). Returns the same map.
export function addTender(byMode, mode, amount) {
  if (!isTendered(mode)) return byMode;
  const m = canonicalMode(mode);
  byMode[m] = (byMode[m] || 0) + Number(amount);
  return byMode;
}

// What a day's money panels show (ZNLY-234). An OPEN day: one set of figures. A CLOSED day: three that never mix, so the rows always add up:
//   at close  = what the day held when it was closed (rows taken at or before closed_at)  -> the cards and the first rows
//   after     = money collected after the close (it is NOT in the closed report)
//   now       = at close + after (live), so "Taken now" and "Cash in the drawer now"
// d: { isClosed, byMode, refunds (live), afterClose: {amount, cash}, atClose: {byMode, refunds, closedAt} | null }
export function dayMoneyView(d) {
  const live = foldDayMoney({ byMode: d?.byMode, refunds: d?.refunds });
  if (d?.isClosed && d?.atClose) {
    const at = foldDayMoney({ byMode: d.atClose.byMode, refunds: d.atClose.refunds });
    return { closed: true, headline: at, at, after: { amount: Number(d.afterClose?.amount || 0), cash: Number(d.afterClose?.cash || 0) }, now: live, closedAt: d.atClose.closedAt || null };
  }
  return { closed: false, headline: live, live };
}
