// Pure view-model for Business health: raw RPC numbers in, formatted tiles / bridge / CSV rows out (unit-tested; no React).
import { computeDelta } from 'utils/reportPeriod';
import { hasPreviousData } from 'lib/reportInsights';
import { wordBranchCap, wordBranches } from '../../../../utils/industryTerms';

export { hasPreviousData };

export const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 }));
export const pctText = (share) => (share == null ? null : `${Math.round(Number(share) * 100)}%`);

/** True when the period holds nothing at all: no bookings, no sales, no cash. The page then says so instead of showing zeros as facts. */
export const isEmptyPeriod = (data) => {
  const c = data?.current;
  return !c || (Number(c.made) === 0 && Number(c.sales) === 0 && Number(c.cash_in) === 0);
};

export function buildTiles(data) {
  const c = data.current;
  const hp = hasPreviousData(data); // no previous data: no "vs 0", no ▲/▼ anywhere
  const p = hp ? data.previous : {};
  const money = (key, label, extra = {}) => ({ key, label, value: num(c[key]), prevText: hp ? `vs ${num(p[key])}` : '', delta: hp ? computeDelta(c[key], p[key]) : null, ...extra });
  const busyNow = c.busy?.share;
  const busyPrev = hp ? p.busy?.share : null;
  const retNow = c.return_rate?.rate;
  const retPrev = hp ? p.return_rate?.rate : null;
  return [
    money('sales', 'Sales (earned)', { lead: true }),
    money('cash_in', 'Cash in'),
    money('bookings', 'Bookings'),
    { key: 'avg_ticket', label: 'Average ticket', value: num(c.avg_ticket), prevText: !hp || p.avg_ticket == null ? '' : `vs ${num(p.avg_ticket)}`, delta: computeDelta(c.avg_ticket, p.avg_ticket) },
    { key: 'busy', label: 'Busy', value: busyNow == null ? 'No hours set' : pctText(busyNow), prevText: !hp || busyPrev == null ? '' : `vs ${pctText(busyPrev)}`, delta: computeDelta(busyNow, busyPrev, { unit: 'pts' }) },
    { key: 'return_rate', label: 'Return rate', value: retNow == null ? '—' : pctText(retNow), prevText: !hp || retPrev == null ? '' : `vs ${pctText(retPrev)}`, delta: computeDelta(retNow, retPrev, { unit: 'pts' }) },
  ];
}

/**
 * Sales -> Cash in, in the order of the approved mockup. Each line is its own number from the server (`bridge`), and together they add up to
 * Cash in exactly. Lines that hold no money are left out, except Not paid yet and Refunds which always show. `sub` rows explain the line above.
 * Refunds paid out, the refunds already taken off Sales (refunded_delivered) and overpaid (payments above the price) are netted into one refund figure.
 */
export function buildBridge(c) {
  const b = c.bridge || {};
  const by = c.paid_from_prepaid_by || {};
  const sold = c.prepaid_sold_by || {};
  const used = [['Membership', by.membership], ['Package', by.package], ['Voucher wallet', by.voucher], ['Other credit', by.other]].filter(([, v]) => Number(v) > 0).map(([l, v]) => `${l} ${num(v)}`);
  const soldBits = [['Memberships', sold.membership], ['Vouchers', sold.voucher], ['Packages', sold.package]].filter(([, v]) => Number(v) > 0).map(([l, v]) => `${l} ${num(v)}`);
  const signed = (sign, v) => `${sign}${num(v)}`;
  const refundNet = Number(b.refunds || 0) - Number(b.refunded_delivered || 0) - Number(b.overpaid || 0);
  const has = (v) => Number(v) > 0;
  return [
    { label: 'Services delivered (Completed, final price)', value: num(c.service_sales) },
    { label: 'Products', value: num(c.product_sales) },
    { label: 'Sales (earned)', value: num(c.sales), total: true },
    { label: '− Not paid yet', value: signed('−', b.not_paid) },
    has(b.earlier) ? { label: '+ Paid now for earlier bookings', value: signed('+', b.earlier) } : null,
    has(b.advance) ? { label: '+ Advance payments for upcoming bookings', value: signed('+', b.advance) } : null,
    has(b.paid_before) ? { label: '− Paid before this period', value: signed('−', b.paid_before) } : null,
    has(b.paid_before) ? { sub: 'Taken in an earlier period for bookings delivered in this one' } : null,
    { label: '− Paid from prepaid balance', value: signed('−', c.paid_from_prepaid) },
    used.length ? { sub: used.join(' · ') } : null,
    { label: '+ Prepaid sold', value: signed('+', c.prepaid_sold) },
    soldBits.length ? { sub: soldBits.join(' · ') } : null,
    refundNet >= 0 ? { label: '− Refunds', value: refundNet === 0 ? '0' : signed('−', refundNet) } : { label: '+ Paid above the booking price', value: signed('+', -refundNet) },
    has(b.other) ? { label: 'Paid on cancelled bookings (refund or keep?)', value: signed('+', b.other) } : null,
    { label: 'Cash in', value: num(c.cash_in), total: true },
  ].filter(Boolean);
}

export const METHOD_LABELS = { qr: 'QR (Fonepay, eSewa, Khalti)', cash: 'Cash', card: 'Card', other: 'Other' };
export const METHOD_COLORS = { qr: '#2D5A27', cash: '#DAA520', card: '#2563EB', other: '#8A8A90' };

/** Cash-in methods with money, biggest first, each with its share of the real money received. */
export function methodSlices(byMethod) {
  const rows = ['qr', 'cash', 'card', 'other'].map((k) => ({ key: k, label: METHOD_LABELS[k], amount: Number(byMethod?.[k] || 0), color: METHOD_COLORS[k] })).filter((r) => r.amount > 0);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return rows.map((r) => ({ ...r, share: total > 0 ? r.amount / total : 0 })).sort((a, b) => b.amount - a.amount);
}

export function bookingFunnel(c) {
  const made = Number(c.made) || 0;
  const row = (label, n, color) => ({ label, n: Number(n) || 0, color, share: made > 0 ? (Number(n) || 0) / made : 0 });
  return { made, rows: [row('Completed', c.completed, '#2D5A27'), row('Still open', c.open, '#8A8A90'), row('Cancelled', c.cancelled, '#D97706'), row('No-show', c.no_show, '#DC2626')] };
}

/** CSV rows for what the page shows: the metrics table on Summary, the branch table on Branches. */
export function exportRows(data, tab, rangeLabel) {
  if (tab === 'branches') {
    const row = (name, cur, prev) => [name, cur.sales, computeDelta(cur.sales, prev.sales)?.text || '', cur.bookings, cur.avg_ticket ?? '', pctText(cur.busy?.share) ?? '', pctText(cur.return_rate?.rate) ?? '', cur.owed?.amount ?? ''];
    return [
      [`${wordBranchCap()}`, 'Sales', 'vs previous', 'Bookings', 'Average ticket', 'Busy', 'Return rate', 'Owed'],
      ...(data.branches || []).map((b) => row(b.name, b.current, b.previous)),
      row(`All ${wordBranches()}`, data.current, data.previous),
    ];
  }
  const c = data.current;
  const p = data.previous;
  const line = (label, key) => [label, c[key] ?? '', p[key] ?? ''];
  return [
    ['Business health', rangeLabel, 'Previous period'],
    line('Sales (earned)', 'sales'), line('Services', 'service_sales'), line('Products', 'product_sales'), line('Refunds', 'refunds'),
    line('Paid from prepaid', 'paid_from_prepaid'), line('Prepaid sold', 'prepaid_sold'), line('Cash in', 'cash_in'),
    line('Bookings', 'bookings'), line('Bookings made', 'made'), line('Completed', 'completed'), line('Still open', 'open'), line('Cancelled', 'cancelled'), line('No-show', 'no_show'),
    line('Average ticket', 'avg_ticket'),
    ['Busy', pctText(c.busy?.share) ?? '', pctText(p.busy?.share) ?? ''],
    ['Return rate', pctText(c.return_rate?.rate) ?? '', pctText(p.return_rate?.rate) ?? ''],
  ];
}

export const DEFINITIONS = [
  { term: 'Sales (earned)', text: 'Completed bookings dated in the period at their final price, minus refunds on them, plus payments kept on no-shows; plus product sales. Advance payments for upcoming bookings are not sales yet.' },
  { term: 'Cash in', text: 'money actually received in the period (real methods: cash, card, QR) for services, products and prepaid, minus refunds. The bridge explains the gap to Sales line by line.' },
  { term: 'Bookings', text: 'booking date in the period, not Cancelled.' },
  { term: 'Average ticket', text: 'services delivered ÷ Completed bookings (products not included).' },
  { term: 'Busy', text: 'booked hours ÷ working hours; working = the dashboard "working" rule (roster).' },
  { term: 'Return rate', text: 'customers seen this period who also visited in the 60 days before their visit.' },
];
