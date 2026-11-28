// Pure helpers for the Checkout dialog (PaymentModal): the cash change helper
// and the success-state receipt (WhatsApp summary; the printed bill is utils/buildBill.js since ZNLY-410). UI-only — none
// of this is persisted, and none of it touches the payment write path.
import { toE164 } from './phone';

const round2 = (n) => Math.round(Number(n) * 100) / 100;

export const fmtNum = (n) => Number(n || 0).toLocaleString('en-IN');

/**
 * Change owed back for a cash tender. Only meaningful when the guest handed
 * over MORE than the cash amount being collected — otherwise null (the helper
 * row stays hidden).
 */
export function computeChange(received, cashAmount) {
  const r = Number(received);
  const c = Number(cashAmount);
  if (!(r > 0) || !(c >= 0) || !(r > c)) return null;
  return round2(r - c);
}

/**
 * Quick-cash buttons for the change helper: the next convenient note amounts
 * strictly above the cash amount (the next multiple of 500, 1,000, 5,000 and
 * 10,000), deduped, ascending, at most 3. Empty when there is no cash to collect.
 */
export function quickCashOptions(cashAmount) {
  const c = Number(cashAmount);
  if (!(c > 0)) return [];
  const next = [500, 1000, 5000, 10000].map((step) => (Math.floor(c / step) + 1) * step);
  return [...new Set(next)].filter((v) => v > c).sort((a, b) => a - b).slice(0, 3);
}

/** The success line under the amount. `leftover` is everything still to pay on the booking (this checkout's shortfall + services left unticked), never a waiting-for-confirmation one. */
export function receiptStatus(r) {
  // `waiting` = NPR of services of this booking still waiting for confirmation: never say "fully paid" while one is open.
  const waiting = r.waiting > 0 ? ` · NPR ${fmtNum(r.waiting)} waiting for confirmation` : '';
  if (r.leftover > 0) return { due: true, text: `Paid NPR ${fmtNum(r.total)} · NPR ${fmtNum(r.leftover)} still to pay${waiting}` };
  if (r.waiting > 0) return { due: true, text: `Paid NPR ${fmtNum(r.total)}${waiting}` };
  return { due: false, text: `${r.bookingNumber}${r.extraCount > 0 ? ` + ${r.extraCount} more` : ''} ${r.extraCount > 0 ? 'are' : 'is'} fully paid` };
}

/** Plain-text receipt summary — used as the WhatsApp message body. */
export function buildReceiptText(r) {
  const lines = [];
  lines.push(`${r.orgName || 'Receipt'}${r.branchName ? ` · ${r.branchName}` : ''}`);
  lines.push(`Payment received: NPR ${fmtNum(r.total)}`);
  if (r.bookingNumber) lines.push(`Booking ${r.bookingNumber}${r.dateLabel ? ` · ${r.dateLabel}` : ''}`);
  (r.lines || []).forEach((l) => lines.push(`${l.label}: NPR ${fmtNum(l.amount)}`));
  (r.tenders || []).forEach((t) => lines.push(`Paid by ${t.label}: NPR ${fmtNum(t.amount)}`));
  // Products bought on the same bill (V26): their own lines and the methods that paid them.
  if (r.products && r.products.lines?.length) {
    lines.push('Products:');
    r.products.lines.forEach((l) => lines.push(`${l.label} × ${l.qty}: NPR ${fmtNum(l.amount)}`));
    (r.products.tenders || []).forEach((t) => lines.push(`Paid by ${t.label}: NPR ${fmtNum(t.amount)}`));
  }
  if (r.leftover > 0) lines.push(`Still to pay: NPR ${fmtNum(r.leftover)}`);
  if (r.tipTotal > 0) lines.push(`Tip (separate): NPR ${fmtNum(r.tipTotal)}`);
  lines.push('Thank you!');
  return lines.join('\n');
}

/** wa.me link for the guest's phone, or null when there is no usable number. */
export function buildWhatsAppUrl(phone, text) {
  const e164 = toE164(phone);
  if (!e164) return null;
  return `https://wa.me/${e164.replace(/^\+/, '')}?text=${encodeURIComponent(text)}`;
}
