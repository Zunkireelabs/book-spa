import { balanceOf, isOwed, paidOf } from './dashboardMoney';


/**
 * Split the dashboard's candidate bookings into what needs the manager: completed-but-unpaid (any date, see dashboardMoney), and today's
 * unconfirmed and unassigned ones. `rows` are bookings with `payments(amount)` joined; unpaid rows get `amount_due` (final minus paid).
 */
export function buildNeeds(rows, date) {
  const all = rows || [];
  const unpaid = all.filter(isOwed).map((b) => ({ ...b, amount_paid: paidOf(b), amount_due: balanceOf(b) })); // lib/dashboardMoney: any date
  const unconfirmed = all.filter((b) => b.status === 'Pending' && b.date === date);
  const unassigned = all.filter((b) => b.date === date && ['Pending', 'Confirmed'].includes(b.status) && !(b.booking_therapists || []).length);
  return { unpaid, unconfirmed, unassigned };
}

const NEPAL_OFFSET = '+05:45';
const atNepal = (date, time) => new Date(`${date}T${String(time || '00:00').slice(0, 8)}${NEPAL_OFFSET}`).getTime();

/**
 * Business view's Needs action: only what a branch manager can't close alone (a pending discount waits for an admin), every owed
 * booking (dashboardMoney, any date, since its end) and a Pending booking waiting more than `afterMin` (default 2h) since it was created. Grouped by branch, longest wait first. `rows` need branch_id/branch_name, status, payment_status, discount_status, created_at,
 * date, end_time/start_time, customer_name, booking_number, final_amount.
 */
export function businessNeeds(rows, nowMs, afterMin = 120) {
  const byBranch = new Map();
  for (const b of rows || []) {
    let kind = null;
    let since = null;
    if (b.discount_status === 'pending') { kind = 'discount'; since = b.created_at ? Date.parse(b.created_at) : null; }
    else if (b.status === 'Pending') { kind = 'unconfirmed'; since = b.created_at ? Date.parse(b.created_at) : null; }
    else if (isOwed(b)) { kind = 'unpaid'; since = atNepal(b.date, b.end_time || b.start_time); }
    if (!kind) continue;
    const waitMin = since == null || Number.isNaN(since) ? 0 : Math.max(0, Math.round((nowMs - since) / 60000));
    if (kind === 'unconfirmed' && waitMin <= afterMin) continue; // discounts and money owed are never held back
    if (!byBranch.has(b.branch_id)) byBranch.set(b.branch_id, { branch_id: b.branch_id, branch_name: b.branch_name || '', items: [] });
    byBranch.get(b.branch_id).items.push({ ...b, kind, wait_min: waitMin, since, ...(kind === 'unpaid' ? { balance: balanceOf(b) } : {}) });
  }
  const groups = [...byBranch.values()];
  groups.forEach((g) => g.items.sort((a, b) => b.wait_min - a.wait_min));
  return groups.sort((a, b) => b.items.length - a.items.length || a.branch_name.localeCompare(b.branch_name));
}

/**
 * Front desk "Next up": today's bookings that still need a step, in time order, each with the one action the desk takes:
 * assign (nobody on it) > collect (completed, unpaid) > confirm (Pending) > check in (Confirmed). In-progress ones stay listed as 'with'
 * (with the client now, no button); settled ones are not queued. Time order, like the front desk reads the day.
 */
export function buildQueue(rows, date) {
  const out = [];
  for (const b of rows || []) {
    if (b.date !== date && !(b.date < date && isOwed(b))) continue; // older days only for money still owed
    const unassigned = !(b.booking_therapists || []).length;
    let action = null;
    if (['Pending', 'Confirmed'].includes(b.status) && unassigned) action = 'assign';
    else if (isOwed(b)) action = 'collect';
    else if (b.status === 'Pending') action = 'confirm';
    else if (b.status === 'Confirmed') action = 'checkin';
    else if (b.status === 'In-Progress') action = 'with';
    if (action) out.push({ ...b, action });
  }
  return out.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.start_time).localeCompare(String(b.start_time)));
}

/**
 * The "Waiting at branches" rows of the Business view: from businessNeeds groups, one summary row per kind per branch
 * ("2 completed bookings unpaid · NPR 3,000 balance · oldest Mon 12 Oct") instead of one row per booking. Discounts are not summarised
 * (they are the admin's own rows). `since` is the oldest item's start (epoch ms, null when unknown).
 */
export function summarizeWaiting(groups) {
  const out = [];
  for (const g of groups || []) {
    for (const kind of ['unpaid', 'unconfirmed']) {
      const items = g.items.filter((i) => i.kind === kind);
      if (!items.length) continue;
      const times = items.map((i) => i.since).filter((n) => Number.isFinite(n));
      out.push({
        branch_id: g.branch_id, branch_name: g.branch_name, kind, count: items.length,
        amount: kind === 'unpaid' ? items.reduce((n, i) => n + i.balance, 0) : null,
        oldest_date: items.map((i) => i.date).sort()[0] || null,
        since: times.length ? Math.min(...times) : null, items,
      });
    }
  }
  return out;
}

/** The discount items across all groups (the admin's own rows), longest wait first. */
export function adminDiscounts(groups) {
  return (groups || []).flatMap((g) => g.items.filter((i) => i.kind === 'discount').map((i) => ({ ...i, branch_id: g.branch_id, branch_name: g.branch_name })))
    .sort((a, b) => b.wait_min - a.wait_min);
}
