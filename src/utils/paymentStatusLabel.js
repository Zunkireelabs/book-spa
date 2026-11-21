/**
 * One label for a booking's payment state (ZNLY-227). A paid-then-cancelled booking has
 * payment_status 'refunded' plus payment_refunds rows: show "Refunded NPR x", never "Unpaid".
 * `partialText` lets a tight spot say "Partial" where the card says "Partially paid".
 * tone: 'success' | 'warning' | 'neutral'
 */
export function paymentStatusLabel(booking, { partialText = 'Partially paid' } = {}) {
  const status = booking?.paymentStatus;
  const refunded = Number(booking?.refundTotal || 0);
  if (status === 'refunded' || (refunded > 0 && status !== 'paid' && status !== 'partial')) {
    return { label: refunded > 0 ? `Refunded NPR ${refunded.toLocaleString('en-IN')}` : 'Refunded', tone: 'neutral' };
  }
  if (status === 'paid') return { label: 'Paid', tone: 'success' };
  if (status === 'partial') return { label: partialText, tone: 'warning' };
  return { label: 'Unpaid', tone: 'warning' };
}
