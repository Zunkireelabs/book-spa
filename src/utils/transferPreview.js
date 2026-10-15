// Client-side revert-time estimate for a temporary transfer (the server — transfer_therapist(), migration-041 — independently
// computes the authoritative revert_at). Used for the preview line, and for the grid's shaded-window preview.
export const DURATION_UNIT_OPTIONS = [
  { value: 'minute', label: 'Minutes' },
  { value: 'hour', label: 'Hours' },
  { value: 'day', label: 'Days' },
  { value: 'week', label: 'Weeks' },
  { value: 'month', label: 'Months' },
];

export function computeRevertDate(dateStr, timeStr, value, unit) {
  if (!dateStr || !timeStr || !value || !unit) return null;
  const start = new Date(`${dateStr}T${timeStr}`);
  if (Number.isNaN(start.getTime())) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (unit === 'month') {
    // Match Postgres's `timestamp + interval 'n months'` (clamp to the last valid day of the target month).
    const targetMonthIndex = start.getMonth() + n;
    const targetYear = start.getFullYear() + Math.floor(targetMonthIndex / 12);
    const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
    const lastDay = new Date(targetYear, normalizedMonth + 1, 0).getDate();
    return new Date(targetYear, normalizedMonth, Math.min(start.getDate(), lastDay), start.getHours(), start.getMinutes(), start.getSeconds());
  }
  const msPerUnit = { minute: 60000, hour: 3600000, day: 86400000, week: 604800000 };
  return new Date(start.getTime() + n * msPerUnit[unit]);
}

const pad = (n) => String(n).padStart(2, '0');
export const toYmd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toHm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// 'Wed 14 Oct, 6:50pm'
export function formatRevert(d) {
  if (!d) return '';
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
  const h = d.getHours();
  return `${day}, ${h % 12 === 0 ? 12 : h % 12}:${pad(d.getMinutes())}${h >= 12 ? 'pm' : 'am'}`;
}

// `date + n unit` for the extension check (months clamp to the last valid day, like Postgres).
function addDuration(date, n, unit) {
  const d = new Date(date.getTime());
  if (unit === 'month') {
    const idx = d.getMonth() + n;
    const year = d.getFullYear() + Math.floor(idx / 12);
    const month = ((idx % 12) + 12) % 12;
    const lastDay = new Date(year, month + 1, 0).getDate();
    return new Date(year, month, Math.min(d.getDate(), lastDay), d.getHours(), d.getMinutes(), d.getSeconds());
  }
  const msPerUnit = { minute: 60000, hour: 3600000, day: 86400000, week: 604800000 };
  return new Date(d.getTime() + n * (msPerUnit[unit] || 0));
}

export const MAX_EXTENSION_DAYS_AHEAD = 365;

/**
 * Validates "add extra time" to an active transfer. Returns a plain-language error, or null when it is fine (or still
 * incomplete: nothing typed yet). The amount must be a whole number >= 1 and the new return can be at most
 * MAX_EXTENSION_DAYS_AHEAD days from now. Client-side only: the extend_staff_transfer RPC does not enforce a ceiling.
 */
export function validateExtension({ value, unit, currentRevertAt, now = new Date() }) {
  if (value === '' || value == null || !unit) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return 'Enter a number.';
  if (!Number.isInteger(n)) return 'Enter a whole number.';
  if (n < 1) return 'Enter at least 1.';
  const base = currentRevertAt ? new Date(currentRevertAt) : now;
  if (Number.isNaN(base.getTime())) return null;
  const next = addDuration(base, n, unit);
  const limit = new Date(now.getTime() + MAX_EXTENSION_DAYS_AHEAD * 86400000);
  if (Number.isNaN(next.getTime()) || next > limit) {
    const latest = limit.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).replace(',', '');
    return `That would put the return more than a year away. The latest you can set is ${latest}.`;
  }
  return null;
}
