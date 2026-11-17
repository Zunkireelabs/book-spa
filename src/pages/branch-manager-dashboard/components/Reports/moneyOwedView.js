// Pure view-model for Money owed: raw RPC numbers in, tiles / age bars / CSV rows out (unit-tested; no React).
import { num } from './businessHealthView';
import { wordBranch, wordBranchCap } from '../../../../utils/industryTerms';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; // fixed names: some ICU builds print "Sept"
const day = (iso) => { const [, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; };
export const dayLabel = day;

/** Whole days from an ISO date (YYYY-MM-DD) to today in Nepal (matches the owed rows' age_days). Never negative. */
export const daysSinceNepal = (iso, now = new Date()) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu' }).format(now);
  const utc = (d) => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd); };
  return Math.max(0, Math.round((utc(today) - utc(iso)) / 86400000));
};

/** The total 30 days ago "has data" when it holds any balance. Otherwise nothing is compared (same rule as Business health). */
export const hasPreviousOwed = (data) => Number(data?.prev?.count) > 0 || Number(data?.prev?.amount) > 0;

/** Owed going UP is bad: red. Amount difference, as in the mockup ("▲ 2,100"). */
export function owedDelta(now, prev) {
  if (now == null || prev == null) return null;
  const diff = Number(now) - Number(prev);
  const dir = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  return { dir, value: Math.abs(diff), unit: 'abs', tone: dir === 'flat' ? 'flat' : dir === 'up' ? 'bad' : 'good', text: dir === 'flat' ? 'No change' : `${dir === 'up' ? '▲' : '▼'} ${num(Math.abs(diff))}` };
}

export const isEmptyOwed = (data) => !data?.totals || Number(data.totals.count) === 0;

export function buildOwedTiles(data) {
  const t = data.totals;
  const hp = hasPreviousOwed(data);
  const over30 = Number(data.buckets?.d31_60?.count || 0) + Number(data.buckets?.d61?.count || 0);
  const over30Amount = Number(data.buckets?.d31_60?.amount || 0) + Number(data.buckets?.d61?.amount || 0);
  const kinds = [`${t.unpaid_count} unpaid`, `${t.partial_count} part paid`, ...(Number(t.package_count) > 0 ? [`${t.package_count} package${t.package_count > 1 ? 's' : ''}`] : [])];
  return [
    { key: 'owed', label: 'Owed now', value: num(t.amount), lead: true, delta: hp ? owedDelta(t.amount, data.prev.amount) : null, prevText: hp ? `vs ${num(data.prev.amount)} on ${day(data.prev.as_of)}` : '' },
    { key: 'count', label: 'Bookings', value: num(t.count), prevText: kinds.join(' · ') },
    { key: 'customers', label: 'Customers', value: num(t.customers), prevText: `largest: ${num(t.largest_customer)}` },
    { key: 'oldest', label: 'Oldest', value: t.oldest_days == null ? '—' : `${t.oldest_days} days`, prevText: t.oldest_date ? `${day(t.oldest_date)} · ${t.oldest_count} booking${t.oldest_count > 1 ? 's' : ''}` : '' },
    { key: 'over30', label: 'Over 30 days', value: num(over30), prevText: `NPR ${num(over30Amount)}` },
  ];
}

const BUCKETS = [['d0_7', '0–7 days', '#2D5A27'], ['d8_30', '8–30 days', '#D97706'], ['d31_60', '31–60 days', '#DC2626'], ['d61', 'Over 60 days', '#DC2626']];
export function ageBars(data) {
  const total = Number(data.totals?.amount) || 0;
  return BUCKETS.map(([k, label, color]) => {
    const b = data.buckets?.[k] || { count: 0, amount: 0 };
    return { key: k, label, color, count: Number(b.count), amount: Number(b.amount), share: total > 0 ? Number(b.amount) / total : 0 };
  });
}

export const statusLabel = (kind) => ({ unpaid: 'Unpaid', partial: 'Part paid', package: 'Package' }[kind] || kind);

// By branch shows for any account with more than one branch in scope, not only when the owed rows happen to sit in more than one.
export const TABS = (data, branchCount = 1) => [
  { id: 'booking', label: 'By booking' },
  { id: 'customer', label: 'By customer' },
  ...(branchCount > 1 ? [{ id: 'branch', label: `By ${wordBranch()}` }] : []),
  { id: 'staff', label: 'By staff' },
  { id: 'responsible', label: 'By responsible person' },
  { id: 'settled', label: 'Settled' },
];

export const UNASSIGNED = 'Unassigned';
export const responsibleOf = (row) => row.responsible || UNASSIGNED;

/** CSV rows for the tab that is showing. */
export function owedExportRows(data, tab, staffLabel = 'Staff') {
  if (tab === 'customer') return [['Customer', 'Phone', 'Bookings', 'Last visit', 'Oldest (days)', 'Balance'], ...data.by_customer.map((c) => [c.name, c.phone || '', c.count, c.last_date, c.oldest_days, c.amount])];
  if (tab === 'branch') return [[`${wordBranchCap()}`, 'Bookings', 'Oldest (days)', 'Balance'], ...data.by_branch.map((b) => [b.name, b.count, b.oldest_days, b.amount])];
  if (tab === 'staff') return [[staffLabel, 'Bookings', 'Balance'], ...data.by_staff.map((s) => [s.name, s.count, s.amount])];
  if (tab === 'responsible') return [['Responsible person', 'Bookings', 'Oldest (days)', 'Balance'], ...data.by_responsible.map((r) => [r.name || UNASSIGNED, r.count, r.oldest_days, r.amount])];
  return [
    ['Customer', 'Phone', 'Reference', `${wordBranchCap()}`, 'Date', 'Age (days)', 'Service', staffLabel, 'Responsible', 'Total', 'Paid', 'Balance', 'Status'],
    ...data.rows.map((r) => [r.customer_name, r.customer_phone || '', r.ref || '', r.branch_name, r.date, r.age_days, r.service, r.staff || '', responsibleOf(r), r.total, r.paid, r.balance, statusLabel(r.kind)]),
  ];
}
