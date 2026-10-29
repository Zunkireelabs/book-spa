// The one "owed" rule for the dashboard (Business Unpaid column, brief, waiting row, Branch Needs action / Loose ends, Front desk Collect).
// Owed = Completed and payment_status <> 'paid' with balance = final_amount - sum(payments) > 0, ANY date. Always show the balance, never final_amount.
// The SQL twin is get_dashboard's branches[].unpaid (migration-334): same rule, same balance. Change both together.

export const npr = (n) => (n == null ? '—' : `NPR ${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`);

/** Sum paid so far: joined `payments(amount)` rows, else a precomputed `amount_paid`. */
export const paidOf = (b) => (Array.isArray(b?.payments) ? b.payments.reduce((s, p) => s + Number(p.amount || 0), 0) : Number(b?.amount_paid || 0));

/** What the customer still owes on a completed, not-fully-paid booking; 0 for anything else. */
export const balanceOf = (b) => (b?.status === 'Completed' && b?.payment_status !== 'paid' ? Math.max(Number(b.final_amount || 0) - paidOf(b), 0) : 0);

export const isOwed = (b) => balanceOf(b) > 0;

/** "NPR 1,800 of 2,000 paid" when part is paid, else null (for a sub line). */
export const paidNote = (b) => {
  const paid = paidOf(b);
  return paid > 0 ? `${npr(paid)} of ${Number(b.final_amount || 0).toLocaleString('en-IN')} paid` : null;
};
