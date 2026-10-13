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
