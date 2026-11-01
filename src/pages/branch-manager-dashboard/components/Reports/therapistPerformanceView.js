// Pure view-model for Therapist performance: raw RPC numbers (get_report_therapist_performance, migration-339) in, scored rows / tiles / CSV out
// (unit-tested; no React). The Score keeps the old panel's weights; only its two inputs changed: sales = service sales (delivered, the Business
// health rule) and busy = the dashboard working rule.
import { computeDelta } from 'utils/reportPeriod';
import { num, pctText } from './businessHealthView';

export { num, pctText };

// Score = sales vs the top earner 40% + completion 25% + attendance 20% + busy 15%.
export const WEIGHTS = { sales: 40, completion: 25, attendance: 20, busy: 15 };

// Low tiers are amber, never red: this report is for coaching.
export const TIERS = [
  { min: 85, id: 'top', label: 'Top performer', cls: 'bg-primary/10 text-primary' },
  { min: 70, id: 'strong', label: 'Strong', cls: 'bg-blue-500/10 text-blue-600' },
  { min: 55, id: 'average', label: 'Average', cls: 'bg-black/[0.05] text-text-secondary' },
  { min: 0, id: 'support', label: 'Needs support', cls: 'bg-warning/10 text-warning' },
];
export const tierOf = (score) => TIERS.find((t) => score >= t.min) || TIERS[TIERS.length - 1];

export const BUSY_LOW = 0.4; // below this the busy cell (and the ✦ rule) turns amber

const ratio = (a, b) => (Number(b) > 0 ? Number(a) / Number(b) : null);
const r1 = (n) => Math.round(n * 10) / 10;

/**
 * The four parts of the score, in points, plus the total (0-100, rounded). `maxSales` = the top earner of the cohort being ranked.
 * A part with no data is left out (null), never filled in: no attendance rows -> no attendance part, no working hours -> no busy part.
 * The remaining parts are rescaled to 100: total = points earned / points available x 100 (all four present = the plain sum).
 */
export function scoreParts(row, maxSales) {
  const completion = Math.min(1, ratio(row.completed, row.due) ?? 0); // due = bookings whose end time has passed, not Cancelled / No Show (completed early can exceed it)
  const attendance = ratio(row.att_present, row.att_days); // null = no attendance marked
  const busy = row.busy == null ? null : Math.min(1, Math.max(0, Number(row.busy) || 0)); // null = no working hours set
  const sales = Number(maxSales) > 0 ? Math.min(1, Number(row.service_sales) / Number(maxSales)) : 0;
  const parts = {
    sales: WEIGHTS.sales * sales, completion: WEIGHTS.completion * completion,
    attendance: attendance == null ? null : WEIGHTS.attendance * attendance, busy: busy == null ? null : WEIGHTS.busy * busy,
  };
  const keys = Object.keys(parts).filter((k) => parts[k] != null);
  const earned = keys.reduce((n, k) => n + parts[k], 0);
  const available = keys.reduce((n, k) => n + WEIGHTS[k], 0);
  const total = Math.round((earned / available) * 100);
  return { parts, score: Math.max(0, Math.min(100, total)) };
}

/** "sales 40 + completion 24.3 + attendance n/a + busy 12.3" (the mockup's line under the score). */
export const scoreFormula = (parts) => {
  const show = (k) => (parts[k] == null ? 'n/a' : r1(parts[k]));
  const left = Object.keys(parts).filter((k) => parts[k] == null);
  return `sales ${show('sales')} + completion ${show('completion')} + attendance ${show('attendance')} + busy ${show('busy')}${left.length ? ' (rescaled to 100)' : ''}`;
};

/**
 * Rows of one cohort (everyone, or one branch), scored against that cohort's top earner. `block` = { therapists }, `prevBlock` the same for the
 * previous period (used for the sales change). Ranked by score, then service sales, then name.
 */
export function buildRows(block, prevBlock = null) {
  const list = block?.therapists || [];
  const prev = new Map((prevBlock?.therapists || []).map((t) => [t.therapist_id, t]));
  const maxSales = Math.max(0, ...list.map((t) => Number(t.service_sales)));
  const rows = list.map((t) => {
    const { parts, score } = scoreParts(t, maxSales);
    const p = prev.get(t.therapist_id);
    return {
      ...t,
      id: t.therapist_id,
      attendance: ratio(t.att_present, t.att_days),
      noShowRate: ratio(t.no_show, t.bookings),
      parts, score, tier: tierOf(score),
      prevSales: p ? Number(p.service_sales) : null,
      salesDelta: p && Number(p.service_sales) > 0 ? computeDelta(t.service_sales, p.service_sales) : null,
    };
  });
  rows.sort((a, b) => b.score - a.score || Number(b.service_sales) - Number(a.service_sales) || String(a.name).localeCompare(String(b.name)));
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

// Every column sorts. Missing values (no hours, under 5 customers, nothing booked) always go last.
const GET = {
  name: (r) => String(r.name || '').toLowerCase(),
  score: (r) => r.score,
  attendance: (r) => r.attendance,
  sales: (r) => Number(r.service_sales),
  completed: (r) => Number(r.completed),
  avg_ticket: (r) => (r.avg_ticket == null ? null : Number(r.avg_ticket)),
  busy: (r) => (r.busy == null ? null : Number(r.busy)),
  rebook: (r) => (r.rebook_rate == null ? null : Number(r.rebook_rate)),
  no_show: (r) => r.noShowRate,
};
export const SORT_KEYS = Object.keys(GET);
export const DEFAULT_SORT = { key: 'score', dir: 'desc' };

export function sortRows(rows, { key, dir } = DEFAULT_SORT) {
  const get = GET[key] || GET.score;
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = get(a); const y = get(b);
    if (x == null && y == null) return a.rank - b.rank;
    if (x == null) return 1;
    if (y == null) return -1;
    if (x < y) return -1 * sign;
    if (x > y) return 1 * sign;
    return a.rank - b.rank;
  });
}

export const searchRows = (rows, q) => {
  const s = String(q || '').trim().toLowerCase();
  return s ? rows.filter((r) => String(r.name || '').toLowerCase().includes(s)) : rows;
};

/** The previous period "has data" when it holds any therapist row (or team bookings). Without it nothing is compared. */
export const hasPrevious = (data) => {
  const t = data?.previous?.team; // same idea as Business health: rostered therapists alone are not data to compare with
  return !!t && (Number(t.bookings) > 0 || Number(t.service_sales) > 0);
};

/** True when the period holds no therapist row at all. The page then says so instead of showing zeros as facts. */
export const isEmptyPerformance = (data) => !data?.current || (data.current.therapists || []).length === 0;

const perHead = (t) => (Number(t?.active) > 0 ? Number(t.service_sales) / Number(t.active) : null);

export function buildTiles(data) {
  const c = data?.current?.team;
  if (!c) return [];
  const hp = hasPrevious(data);
  const p = hp ? data.previous.team : null;
  const nsNow = ratio(c.no_show, c.bookings);
  const nsPrev = p ? ratio(p.no_show, p.bookings) : null;
  const pct1 = (v) => (v == null ? '—' : `${(Math.round(v * 1000) / 10).toLocaleString('en-IN')}%`);
  const salesNow = perHead(c);
  const salesPrev = p ? perHead(p) : null;
  return [
    { key: 'per_head', label: 'Service sales per therapist', value: num(salesNow), lead: true, delta: computeDelta(salesNow, salesPrev), prevText: salesPrev == null ? '' : `vs ${num(salesPrev)}` },
    { key: 'active', label: 'Active therapists', value: num(c.active), delta: null, prevText: !p ? '' : Number(p.active) === Number(c.active) ? 'same as before' : `vs ${num(p.active)}` },
    { key: 'busy', label: 'Busy', value: c.busy == null ? 'No hours set' : pctText(c.busy), delta: computeDelta(c.busy, p?.busy, { unit: 'pts' }), prevText: p?.busy == null ? '' : `vs ${pctText(p.busy)}` },
    { key: 'rebook', label: 'Rebook rate', value: c.rebook_rate == null ? '—' : pctText(c.rebook_rate), delta: computeDelta(c.rebook_rate, p?.rebook_rate, { unit: 'pts' }), prevText: p?.rebook_rate == null ? '' : `vs ${pctText(p.rebook_rate)}` },
    { key: 'no_show', label: 'No-show rate', value: pct1(nsNow), delta: computeDelta(nsNow, nsPrev, { unit: 'pts', goodWhen: 'down' }), prevText: nsPrev == null ? '' : `vs ${pct1(nsPrev)}` },
  ];
}


/** CSV of the table on screen. Ranking = one line per therapist plus the team; By branch = the same per branch; Trend = sales per week. */
export function exportRows(data, tab, rowsFor, staffLabel = 'Therapist') {
  const head = [staffLabel, 'Branch', 'Score', 'Tier', 'Attendance', 'Service sales', 'Completed', 'Avg ticket', 'Busy', 'Rebook', 'No-show', 'Customers served'];
  const line = (r) => [r.name, r.branch_name, r.score, r.tier.label, pctText(r.attendance) ?? '', r.service_sales, r.completed, r.avg_ticket ?? '', pctText(r.busy) ?? '', pctText(r.rebook_rate) ?? '', pctText(r.noShowRate) ?? '', r.customers];
  if (tab === 'trend') {
    const weeks = data.weeks || [];
    return [[staffLabel, ...weeks, 'Total'], ...rowsFor.map((r) => [r.name, ...(r.sales_by_week || []).map(Number), r.service_sales])];
  }
  if (tab === 'branches') {
    return [['Branch', ...head], ...(data.branches || []).flatMap((b) => buildRows(b.current).map((r) => [b.name, ...line(r)]))];
  }
  const t = data.current.team;
  return [
    head,
    ...rowsFor.map(line),
    ['All', '', '', '', pctText(ratio(t.att_present, t.att_days)) ?? '', t.service_sales, t.completed, t.avg_ticket ?? '', pctText(t.busy) ?? '', pctText(t.rebook_rate) ?? '', pctText(ratio(t.no_show, t.bookings)) ?? '', t.customers],
  ];
}

export const DEFINITIONS = [
  { term: 'Service sales', text: "the therapist's Completed bookings dated in the period at final price, minus refunds on them, plus payments kept on no-shows (the same rule as Business health's services delivered). A combo booking is split equally between its therapists. Products are not included." },
  { term: 'Busy', text: 'booked hours ÷ working hours (the dashboard "working" rule: roster, breaks and time off taken out). Shown only when working hours exist; otherwise "No hours set".' },
  { term: 'Rebook', text: 'of the distinct customers served, the share who booked again (any therapist, not Cancelled) within 60 days after a visit. "—" under 5 customers. Not the same as Business health\'s Return rate, which looks back 60 days.' },
  { term: 'Score', text: 'service sales vs the top earner × 40% + completion rate (Completed ÷ bookings whose end time has passed, not Cancelled and not No Show; past bookings never closed count against) × 25% + attendance rate × 20% + busy × 15%, 0–100. 85+ Top performer, 70+ Strong, 55+ Average, below 55 Needs support (amber, never red). A part with no data (no attendance marked, or no working hours set) is left out and the rest are rescaled to 100.' },
  { term: 'No-show', text: 'No Show ÷ bookings not Cancelled. Lent therapists count at the branch where they worked.' },
  { term: 'Completed', text: 'bookings the therapist is on. A combo counts once for each therapist, so the rows can add up to more than the team figure, which counts each booking once and matches Business health.' },
];
