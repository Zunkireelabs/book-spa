// Period math for the Reports frame (ZNLY-159): the chosen range, the equal-length range right before it, and the ▲/▼ between two values.
// Pure. Dates are YYYY-MM-DD in local (Nepal) time, built with periodPresets' toISO so a date never shifts across midnight.
import { toISO, getPeriodRange } from './periodPresets';

export const REPORT_PERIODS = [
  { id: 'last7', label: 'Last 7 days' },
  { id: 'last30', label: 'Last 30 days' },
  { id: 'last90', label: 'Last 90 days' },
  { id: 'month', label: 'This month' },
  { id: 'custom', label: 'Custom range' },
];
export const DEFAULT_REPORT_PERIOD = 'last30';

const parse = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (iso, n) => { const d = parse(iso); d.setDate(d.getDate() + n); return toISO(d); };
/** Number of days from..to, both ends counted. */
export const daysInclusive = (from, to) => Math.round((parse(to) - parse(from)) / 86400000) + 1;

/** The equal-length period right before from..to. */
export function previousPeriod(from, to) {
  const len = daysInclusive(from, to);
  const prevTo = addDays(from, -1);
  return { from: addDays(prevTo, -(len - 1)), to: prevTo };
}

/** { from, to, prev: { from, to }, days, label, vsLabel } for a period id, ending today. */
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const validCustom = (c) => !!c && ISO.test(c.from || '') && ISO.test(c.to || '') && c.from <= c.to && daysInclusive(c.from, c.to) <= 366;

// `custom` = { from, to } is only used for the 'custom' period; an invalid one falls back to the default period.
export function getReportRange(periodId = DEFAULT_REPORT_PERIOD, today = new Date(), custom = null) {
  let period = REPORT_PERIODS.find((p) => p.id === periodId) || REPORT_PERIODS.find((p) => p.id === DEFAULT_REPORT_PERIOD);
  if (period.id === 'custom' && !validCustom(custom)) period = REPORT_PERIODS.find((p) => p.id === DEFAULT_REPORT_PERIOD);
  let to = toISO(today);
  let from;
  if (period.id === 'custom') { from = custom.from; to = custom.to; }
  else if (period.id === 'month') from = getPeriodRange('monthly').startDate;
  else from = addDays(to, -(Number(period.id.replace('last', '')) - 1));
  const days = daysInclusive(from, to);
  return { id: period.id, from, to, prev: previousPeriod(from, to), days, label: period.label, vsLabel: `vs previous ${days}` };
}

/**
 * The change between two values, for a ▲/▼ chip.
 *  unit '%'   : relative change (counts, money). Null when there is no previous value or it is 0 (no honest percentage).
 *  unit 'pts' : percentage points between two 0..1 shares.
 * goodWhen says which direction is good for this metric; `tone` is 'good' | 'bad' | 'flat' so the colour is never assumed from the arrow.
 */
export function computeDelta(now, prev, { unit = '%', goodWhen = 'up' } = {}) {
  if (now == null || prev == null) return null;
  const a = Number(now);
  const b = Number(prev);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  if (unit === '%' && b === 0) return null;
  const value = unit === 'pts' ? Math.round((a - b) * 100) : Math.round(((a - b) / b) * 100);
  const dir = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  const tone = dir === 'flat' ? 'flat' : dir === goodWhen ? 'good' : 'bad';
  return { dir, value: Math.abs(value), unit, tone, text: dir === 'flat' ? 'No change' : `${dir === 'up' ? '▲' : '▼'} ${Math.abs(value)}${unit === 'pts' ? ' pts' : '%'}` };
}
