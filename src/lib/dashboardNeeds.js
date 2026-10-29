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

const NEPAL_OFFSET = '+05:45';
const atNepal = (date, time) => new Date(`${date}T${String(time || '00:00').slice(0, 8)}${NEPAL_OFFSET}`).getTime();

/**
 * Business view's Needs action: only what a branch manager can't close alone (a pending discount waits for an admin) plus anything
 * that has been waiting more than `afterMin` (default 2h): a Pending booking since it was created, a Completed-unpaid one since its
 * end. Grouped by branch, longest wait first. `rows` need branch_id/branch_name, status, payment_status, discount_status, created_at,
 * date, end_time/start_time, customer_name, booking_number, final_amount.
 */
export function businessNeeds(rows, nowMs, afterMin = 120) {
  const byBranch = new Map();
  for (const b of rows || []) {
    let kind = null;
    let since = null;
    if (b.discount_status === 'pending') { kind = 'discount'; since = b.created_at ? Date.parse(b.created_at) : null; }
    else if (b.status === 'Pending') { kind = 'unconfirmed'; since = b.created_at ? Date.parse(b.created_at) : null; }
    else if (b.status === 'Completed' && b.payment_status !== 'paid') { kind = 'unpaid'; since = atNepal(b.date, b.end_time || b.start_time); }
    if (!kind) continue;
    const waitMin = since == null || Number.isNaN(since) ? 0 : Math.max(0, Math.round((nowMs - since) / 60000));
    if (kind !== 'discount' && waitMin <= afterMin) continue;
    if (!byBranch.has(b.branch_id)) byBranch.set(b.branch_id, { branch_id: b.branch_id, branch_name: b.branch_name || '', items: [] });
    byBranch.get(b.branch_id).items.push({ ...b, kind, wait_min: waitMin });
  }
  const groups = [...byBranch.values()];
  groups.forEach((g) => g.items.sort((a, b) => b.wait_min - a.wait_min));
  return groups.sort((a, b) => b.items.length - a.items.length || a.branch_name.localeCompare(b.branch_name));
}

/**
 * Front desk "Next up": today's bookings that still need a step, in time order, each with the one action the desk takes:
 * assign (nobody on it) > collect (completed, unpaid) > confirm (Pending) > check in (Confirmed). In-progress and settled ones are not queued.
 */
export function buildQueue(rows, date) {
  const out = [];
  for (const b of rows || []) {
    if (b.date !== date) continue;
    const unassigned = !(b.booking_therapists || []).length;
    let action = null;
    if (['Pending', 'Confirmed'].includes(b.status) && unassigned) action = 'assign';
    else if (b.status === 'Completed' && b.payment_status !== 'paid') action = 'collect';
    else if (b.status === 'Pending') action = 'confirm';
    else if (b.status === 'Confirmed') action = 'checkin';
    if (action) out.push({ ...b, action });
  }
  const order = (b) => (b.action === 'collect' ? 0 : 1); // money first, then by time
  return out.sort((a, b) => order(a) - order(b) || String(a.start_time).localeCompare(String(b.start_time)));
}
