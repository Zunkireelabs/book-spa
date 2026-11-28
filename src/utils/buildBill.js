// ZNLY-410: ONE bill. Pure data in, bill data out; BillView / printBill draw it. A bill is built live from a visit (or one booking) and its
// payments: nothing about it is stored except its number (fix_bill_number). Money is P1: every figure is derived from the booking rows,
// payments and refunds, so it always matches the database.
import { nepalDateOf } from './nepalTime';
import { formatPhoneGrouped } from './phone';
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const hm = (t) => String(t || '').slice(0, 5);
const hh12 = (t) => { const [h, m] = hm(t).split(':').map(Number); return { n: `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ':00'}`, ap: h >= 12 ? 'pm' : 'am' }; };
/** "3:00 – 4:00pm" (customer-facing: always 12 h, never the staff setting). */
export function timeRange(start, end) {
  if (!start) return '';
  const a = hh12(start); const b = end ? hh12(end) : null;
  if (!b) return `${a.n}${a.ap}`;
  return a.ap === b.ap ? `${a.n} – ${b.n}${b.ap}` : `${a.n}${a.ap} – ${b.n}${b.ap}`;
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-11-19' -> '19 Nov 2026'. Pure string work, no device timezone. */
export const billDate = (d, withYear = true) => { const [y, m, day] = String(d || '').slice(0, 10).split('-').map(Number); return y ? `${day} ${MON[m - 1]}${withYear ? ` ${y}` : ''}` : ''; };

const MODE = { 'qr payment': 'QR payment', qr: 'QR payment', esewa: 'eSewa', fonepay: 'Fonepay' };
/** Payment method in plain words: "QR PAYMENT" -> "QR payment", "MobileBanking" -> "Mobile banking". */
export const modeLabel = (m) => {
  const words = String(m || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\s]+/g, ' ').trim().toLowerCase();
  return MODE[String(m || '').trim().toLowerCase()] || MODE[words] || (words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Payment');
};

const isCancelled = (s) => /^(cancelled|no.?show)$/i.test(String(s || ''));
const moneyIn = (row) => (row.payments || []).length > 0 || (row.refunds || []).length > 0;

/** A bill exists once money was taken (or given back) or a service was completed. A visit cancelled / no-show with no money has none. */
export function billExists(rows) {
  return (rows || []).some((r) => moneyIn(r) || /^completed$/i.test(String(r.status || '')));
}

/** Splits a customer's booking rows into bill units: one visit when the org has "Several services in one booking" ON and the row has a visit_id, else one booking. */
export function groupBillUnits(rows, multi) {
  const m = new Map();
  (rows || []).forEach((r) => {
    const key = multi && r.visitId ? `v:${r.visitId}` : `b:${r.id}`;
    if (!m.has(key)) m.set(key, []);
    m.get(key).push(r);
  });
  return [...m.values()].map((g) => g.sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)) || String(a.bookingNumber).localeCompare(String(b.bookingNumber))));
}

/**
 * @param src { org:{name,logoUrl,footer}, branch:{name,address,phone}, customer:{name,phone,pan},
 *   rows:[{ id, bookingNumber, date, startTime, endTime, status, service, staff, base, discount, final, payments:[{amount,mode,at}], refunds:[{amount,at}], tip }],
 *   products:[{ name, qty, amount, payments:[{amount,mode,at}] }], billNumber, invoice?:{ number, taxMode, vatRate, vatAmount, taxableAmount, subtotal, discountAmount, totalAmount, issuedAt, copyLabel } }
 */
export function buildBill(src) {
  const rows = src.rows || [];
  const active = rows.filter((r) => !isCancelled(r.status));
  const lines = rows.map((r) => {
    const cancelled = isCancelled(r.status);
    return { service: r.service, staff: r.staff || '', time: timeRange(r.startTime, r.endTime), price: cancelled ? 0 : r2(Number(r.base) > 0 ? r.base : r2(r.final) + r2(r.discount)), cancelled };
  });
  const products = (src.products || []).map((p) => ({ service: p.name, qty: p.qty, price: r2(p.amount), staff: '', time: '', cancelled: false }));
  const serviceFinal = r2(active.reduce((s, r) => s + Number(r.final || 0), 0));
  const productTotal = r2(products.reduce((s, p) => s + p.price, 0));
  const discount = r2(active.reduce((s, r) => s + Number(r.discount || 0), 0));
  const subtotal = r2(lines.filter((l) => !l.cancelled).reduce((s, l) => s + l.price, 0) + productTotal);
  const total = r2(serviceFinal + productTotal);
  // A % only when every discounted line shares it; otherwise the amount alone (mixed discounts must not read as one number).
  const pcts = new Set(active.filter((r) => Number(r.discount) > 0).map((r) => Math.round((Number(r.discount) / (Number(r.base) || (Number(r.final) + Number(r.discount)))) * 1000) / 10));
  const discountPct = pcts.size === 1 && active.filter((r) => Number(r.discount) > 0).length === active.length ? [...pcts][0] : null;

  const paidList = [
    ...rows.flatMap((r) => (r.payments || []).map((p) => ({ label: modeLabel(p.mode), amount: r2(p.amount), at: p.at }))),
    ...(src.products || []).flatMap((p) => (p.payments || []).map((x) => ({ label: modeLabel(x.mode), amount: r2(x.amount), at: x.at }))),
  ].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const paid = r2(paidList.reduce((s, p) => s + p.amount, 0));
  const refunded = r2(rows.reduce((s, r) => s + (r.refunds || []).reduce((n, x) => n + Number(x.amount || 0), 0), 0));
  const stillToPay = r2(Math.max(total - (paid - refunded), 0));
  const tip = r2(rows.reduce((s, r) => s + Number(r.tip || 0), 0));

  const inv = src.invoice || null;
  const first = rows[0] || {};
  // the visit's first booking number: the same rule fix_bill_number() applies when the bill is first printed
  const anchorNumber = src.billNumber || rows.map((r) => r.bookingNumber).filter(Boolean).sort()[0] || '';
  const dates = [...new Set(rows.map((r) => r.date))];
  const status = stillToPay > 0 ? { kind: 'due', amount: stillToPay } : refunded > 0 ? { kind: 'refunded', amount: refunded } : { kind: 'paid', amount: 0 };
  return {
    title: inv ? 'Tax invoice' : 'Receipt',
    number: inv ? inv.number : anchorNumber,
    bookingNumber: anchorNumber,
    copyLabel: inv?.copyLabel || '',
    dateLabel: inv?.issuedAt ? billDate(nepalDateOf(inv.issuedAt)) : billDate(first.date),
    dateRange: dates.length > 1 ? dates.map((d) => billDate(d, false)).join(', ') : billDate(first.date),
    visitTimes: timeRange(rows.map((r) => r.startTime).filter(Boolean).sort()[0], rows.map((r) => r.endTime).filter(Boolean).sort().slice(-1)[0]),
    org: src.org || {}, branch: src.branch || {}, customer: src.customer || {},
    lines: [...lines, ...products],
    serviceCount: active.length,
    subtotal: inv ? r2(inv.subtotal) : subtotal,
    discount: inv ? (r2(inv.discountAmount) > 0 ? { amount: r2(inv.discountAmount), pct: null } : null) : discount > 0 ? { amount: discount, pct: discountPct } : null,
    tax: inv && inv.taxMode !== 'none' ? { taxable: r2(inv.taxableAmount), vat: r2(inv.vatAmount), rate: inv.vatRate, mode: inv.taxMode } : null,
    total: inv ? r2(inv.totalAmount) : total,
    paid: paidList, paidTotal: paid, refunded, stillToPay, tip, status,
    footer: src.org?.footer || '',
  };
}

/** Turns fetchBillUnit()'s data + the org's own settings into buildBill's input. A frozen tax invoice (when one exists) supplies the seller, tax figures and footer. */
export function billSource(unit, orgInfo, copyLabel = '') {
  const first = unit.rows[0] || {};
  const i = unit.invoice;
  return {
    rows: unit.rows, products: unit.products, billNumber: unit.billNumber,
    branch: { ...unit.branch, phone: formatPhoneGrouped(unit.branch?.phone) },
    org: i ? { name: orgInfo.name, logoUrl: orgInfo.logoUrl, legalName: i.seller_name, pan: i.seller_pan, phone: formatPhoneGrouped(i.seller_phone), footer: i.footer_text } : { name: orgInfo.name, logoUrl: orgInfo.logoUrl, footer: orgInfo.footer },
    customer: i ? { name: i.buyer_name, phone: formatPhoneGrouped(i.buyer_phone), pan: i.buyer_pan } : unit.customer ? { name: unit.customer.name, phone: unit.customer.phone } : { name: first.customerName, phone: formatPhoneGrouped(first.customerPhone) }, // unit.customer: the public page (phone already masked)
    invoice: i ? { number: i.invoice_number, taxMode: i.tax_mode, vatRate: i.vat_rate, vatAmount: i.vat_amount, taxableAmount: i.taxable_amount, subtotal: i.subtotal, discountAmount: i.discount_amount, totalAmount: i.total_amount, issuedAt: i.issued_at, copyLabel } : null,
  };
}
