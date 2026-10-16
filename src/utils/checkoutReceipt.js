// Pure helpers for the Checkout dialog (PaymentModal): the cash change helper
// and the success-state receipt (print view + WhatsApp summary). UI-only — none
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

/** Plain-text receipt summary — used as the WhatsApp message body. */
export function buildReceiptText(r) {
  const lines = [];
  lines.push(`${r.orgName || 'Receipt'}${r.branchName ? ` · ${r.branchName}` : ''}`);
  lines.push(`Payment received: NPR ${fmtNum(r.total)}`);
  if (r.bookingNumber) lines.push(`Booking ${r.bookingNumber}${r.dateLabel ? ` · ${r.dateLabel}` : ''}`);
  (r.lines || []).forEach((l) => lines.push(`${l.label}: NPR ${fmtNum(l.amount)}`));
  (r.tenders || []).forEach((t) => lines.push(`Paid by ${t.label}: NPR ${fmtNum(t.amount)}`));
  if (r.leftover > 0) lines.push(`Still due: NPR ${fmtNum(r.leftover)}`);
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

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Self-contained printable receipt document (opened in a new window and printed). */
export function buildReceiptHtml(r) {
  const row = (a, b, cls = '') => `<tr class="${cls}"><td>${esc(a)}</td><td class="n">${esc(b)}</td></tr>`;
  const rows = [
    ...(r.lines || []).map((l) => row(l.label, fmtNum(l.amount), l.sub ? 'sub' : '')),
  ].join('');
  const tenders = (r.tenders || []).map((t) => row(t.detail ? `${t.label} · ${t.detail}` : t.label, fmtNum(t.amount))).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${esc(r.bookingNumber)}</title>
<style>
body{font:13px/1.5 Inter,-apple-system,system-ui,sans-serif;color:#0E0D0C;max-width:360px;margin:24px auto;padding:0 16px}
h1{font-size:16px;margin:0}.muted{color:#6b6b70;font-size:12px}
table{width:100%;border-collapse:collapse;margin:10px 0}td{padding:5px 0;border-bottom:1px solid #eee}
td.n{text-align:right;font-variant-numeric:tabular-nums}tr.sub td{color:#6b6b70}
.tot td{font-weight:600;border-top:1px solid #0E0D0C;border-bottom:0;font-size:14px}
h2{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#6b6b70;margin:16px 0 0}
.foot{margin-top:18px;text-align:center;color:#6b6b70;font-size:12px}
@media print{body{margin:0}}
</style></head><body>
<h1>${esc(r.orgName || 'Receipt')}</h1>
<div class="muted">${esc(r.branchName || '')}${r.branchName ? ' · ' : ''}${esc(r.dateLabel || '')}</div>
<div class="muted">${esc(r.guestName || '')}${r.bookingNumber ? ` · ${esc(r.bookingNumber)}` : ''}</div>
<h2>Services</h2><table>${rows}</table>
<h2>Payment</h2><table>${tenders}
${r.leftover > 0 ? row('Still due', fmtNum(r.leftover)) : ''}
<tr class="tot"><td>Total paid (NPR)</td><td class="n">${fmtNum(r.total)}</td></tr></table>
${r.tipTotal > 0 ? `<div class="muted">Tip NPR ${fmtNum(r.tipTotal)} was given to staff and recorded separately.</div>` : ''}
<div class="foot">Thank you!</div>
</body></html>`;
}
