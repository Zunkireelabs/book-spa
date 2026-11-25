// What stops an admin deleting a booking, built from what the panel has already loaded (the server refuses the same set:
// admin_delete_booking, migration 336 — payments, refunds, tips, referral, package use). Pure, so the card and its button are testable.
// Cancelling is the way out: the DB trigger handle_booking_cancellation_refund refunds EVERY payment in full when the booking goes to
// Cancelled while its payment_status is paid/partial. So the "Cancel and refund" button only exists where that trigger really fires
// (paid/partial, no refund yet — an earlier partial refund would be refunded a second time).
const npr = (n) => `NPR ${Number(n || 0).toLocaleString('en-IN')}`;
const day = (ts) => (ts ? new Date(ts).toLocaleDateString('en-GB', { timeZone: 'Asia/Kathmandu', day: 'numeric', month: 'short' }) : '');

export function deleteBlockers({ payments = [], refunds = [], tips = [], hasReferral = false, packageUses = 0, status, paymentStatus } = {}) {
  const paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const refunded = refunds.reduce((s, r) => s + Number(r.amount || 0), 0);
  const tipTotal = tips.reduce((s, t) => s + Number(t.amount || 0), 0);
  const lines = [];
  if (payments.length) lines.push(`${npr(paid)} was paid (${payments.map((p) => [p.paymentMode, day(p.createdAt)].filter(Boolean).join(', ')).join('; ')})`);
  if (refunds.length) lines.push(`${npr(refunded)} was refunded`);
  if (tips.length) lines.push(`a tip of ${npr(tipTotal)} was recorded`);
  if (hasReferral) lines.push('it carries a referral reward');
  if (packageUses > 0) lines.push('a package session was used on it');
  if (!lines.length) return null;

  const cancelled = String(status || '').toLowerCase() === 'cancelled';
  const refundFires = paid > 0 && refunds.length === 0 && ['paid', 'partial'].includes(paymentStatus);
  const canCancel = !cancelled && (paid === 0 || refundFires);
  let advice;
  if (cancelled) advice = 'It is already cancelled and stays in history.';
  else if (canCancel && refundFires) advice = `Cancel it instead. The ${npr(paid)} is recorded as a refund; the booking stays in history.`;
  else if (canCancel) advice = 'Cancel it instead; the booking stays in history.';
  else advice = "It can't be cancelled with an automatic refund from here. Ask support.";
  return { title: `Can't delete: ${lines.join('; ')}`, advice, canCancel, refund: canCancel && refundFires ? paid : 0 };
}
