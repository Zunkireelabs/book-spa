import { balanceOf, isOwed, paidOf } from './dashboardMoney';

const NEPAL_OFFSET = '+05:45';
const atNepal = (date, time) => new Date(`${date}T${String(time || '00:00').slice(0, 8)}${NEPAL_OFFSET}`).getTime();
const OPEN = ['Pending', 'Confirmed', 'In-Progress'];

// The one "needs someone" rule. Each booking falls in exactly one kind, checked in this order. The SQL twin is
// _dashboard_need_kind() in migration-368 (get_dashboard branches[].needs): same order, same tests. Change both together.
export const NEED_KINDS = ['discount', 'owed', 'not_closed', 'unconfirmed', 'unassigned'];
export const UNCONFIRMED_AFTER_MIN = 120;

/**
 * Kind of need a booking is in, or null. `b` needs status, date, start_time, end_time, created_at, discount_status, payment_status,
 * final_amount, payments(amount) and booking_therapists; `today` is the Nepal day (YYYY-MM-DD), `nowMs` epoch ms.
 *  1 discount: discount_status pending
 *  2 owed: completed with a balance (dashboardMoney isOwed), any date
 *  3 not_closed: Pending, Confirmed or In-Progress and date + end_time (Nepal) has passed, any date
 *  4 unconfirmed: Pending, not yet ended, created over 2h ago
 *  5 unassigned: today, not yet started, Pending or Confirmed, nobody assigned
 */
export function classifyNeed(b, nowMs, today) {
  if (b.discount_status === 'pending') return 'discount';
  if (isOwed(b)) return 'owed';
  if (OPEN.includes(b.status) && b.end_time && atNepal(b.date, b.end_time) <= nowMs) return 'not_closed';
  if (b.status === 'Pending' && b.created_at && nowMs - Date.parse(b.created_at) > UNCONFIRMED_AFTER_MIN * 60000) return 'unconfirmed';
  if (b.date === today && ['Pending', 'Confirmed'].includes(b.status) && b.start_time && atNepal(b.date, b.start_time) > nowMs && !(b.booking_therapists || []).length) return 'unassigned';
  return null;
}

/**
 * Every booking that needs someone, tagged with its kind. `rows` are bookings with `payments(amount)` and `booking_therapists` joined
 * (plus branch_id / branch_name for the Business view). Owed rows get amount_paid / amount_due; each row gets `wait_min` and `since`
 * (epoch ms: when it started waiting, null when unknown). Bookings after `today` are not part of the rule.
 */
export function needsOf(rows, nowMs, today) {
  const out = [];
  for (const b of rows || []) {
    if (b.date > today) continue;
    const kind = classifyNeed(b, nowMs, today);
    if (!kind) continue;
    const since = kind === 'discount' || kind === 'unconfirmed' ? (b.created_at ? Date.parse(b.created_at) : null)
      : kind === 'unassigned' ? atNepal(b.date, b.start_time) : atNepal(b.date, b.end_time || b.start_time);
    const waitMin = since == null || Number.isNaN(since) ? 0 : Math.max(0, Math.round((nowMs - since) / 60000));
    out.push({ ...b, kind, since, wait_min: waitMin, ...(kind === 'owed' ? { amount_paid: paidOf(b), amount_due: balanceOf(b) } : {}) });
  }
  return out;
}

/** Items of the given kinds. */
export const ofKind = (items, ...kinds) => (items || []).filter((i) => kinds.includes(i.kind));

/** Business view: needs grouped by branch, most first (then by name); each group has its items, per-kind `counts` and `total`. */
export function groupNeeds(items) {
  const byBranch = new Map();
  for (const i of items || []) {
    if (!byBranch.has(i.branch_id)) byBranch.set(i.branch_id, { branch_id: i.branch_id, branch_name: i.branch_name || '', items: [] });
    byBranch.get(i.branch_id).items.push(i);
  }
  const groups = [...byBranch.values()];
  groups.forEach((g) => {
    g.items.sort((a, b) => b.wait_min - a.wait_min);
    g.counts = Object.fromEntries(NEED_KINDS.map((k) => [k, g.items.filter((i) => i.kind === k).length]));
    g.total = g.items.length;
  });
  return groups.sort((a, b) => b.total - a.total || a.branch_name.localeCompare(b.branch_name));
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
 * The "Waiting at branches" rows of the Business view: from groupNeeds groups, one summary row per kind per branch
 * ("2 completed bookings unpaid · NPR 3,000 balance · oldest Mon 12 Oct", "108 bookings never closed · oldest Mon 12 Oct") instead of
 * one row per booking. Discounts are not summarised (they are the admin's own rows). `since` is the oldest item's wait start
 * (epoch ms, null when unknown).
 */
export function summarizeWaiting(groups) {
  const out = [];
  for (const g of groups || []) {
    for (const kind of ['owed', 'not_closed', 'unconfirmed', 'unassigned']) {
      const items = g.items.filter((i) => i.kind === kind);
      if (!items.length) continue;
      const times = items.map((i) => i.since).filter((n) => Number.isFinite(n));
      out.push({
        branch_id: g.branch_id, branch_name: g.branch_name, kind, count: items.length,
        amount: kind === 'owed' ? items.reduce((n, i) => n + i.amount_due, 0) : null,
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
