const sumPaid = (b) => (b.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);

/**
 * Split the dashboard's candidate bookings into what needs the manager: completed-but-unpaid (any of the window), and today's
 * unconfirmed and unassigned ones. `rows` are bookings with `payments(amount)` joined; unpaid rows get `amount_due` (final minus paid).
 */
export function buildNeeds(rows, date) {
  const all = rows || [];
  const unpaid = all
    .filter((b) => b.status === 'Completed' && b.payment_status !== 'paid')
    .map((b) => ({ ...b, amount_paid: sumPaid(b), amount_due: Math.max(Number(b.final_amount || 0) - sumPaid(b), 0) }));
  const unconfirmed = all.filter((b) => b.status === 'Pending' && b.date === date);
  const unassigned = all.filter((b) => b.date === date && ['Pending', 'Confirmed'].includes(b.status) && !(b.booking_therapists || []).length);
  return { unpaid, unconfirmed, unassigned };
}
