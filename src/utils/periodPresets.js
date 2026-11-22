import { nepalToday } from './nepalTime';

// Shared period presets for report date filtering.
// Ranges are calendar-period-to-date ending today, except "weekly" which is a
// rolling last-7-days window. Dates are formatted in local (Nepal) time so the
// boundaries line up with the user's calendar rather than UTC.

export const PERIOD_PRESETS = [
  { id: 'daily', label: 'Daily' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'semiannual', label: 'Semi-Annually' },
  { id: 'annually', label: 'Annually' },
];

// Format a Date as YYYY-MM-DD in local (Nepal) time, avoiding the UTC shift of
// toISOString() that can roll the date back a day near midnight.
export const toISO = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Today in NEPAL (not the device's day), as a string and as a Date whose LOCAL fields are the Nepal calendar day. The period maths below
// (and utils/reportPeriod) works on local-field Dates, so building "today" this way keeps every range on the Nepal day whatever the
// device timezone is.
export const getTodayISO = () => nepalToday();
export const nepalLocalDate = () => {
  const [y, m, d] = nepalToday().split('-').map(Number);
  return new Date(y, m - 1, d);
};

export function getPeriodRange(presetId) {
  const today = nepalLocalDate();
  let end = toISO(today);
  let start;
  switch (presetId) {
    case 'daily':
      start = end;
      break;
    case 'yesterday':
      start = end = toISO(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));
      break;
    case 'weekly':
      start = toISO(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6));
      break;
    case 'monthly':
      start = toISO(new Date(today.getFullYear(), today.getMonth(), 1));
      break;
    case 'quarterly': {
      const q = Math.floor(today.getMonth() / 3);
      start = toISO(new Date(today.getFullYear(), q * 3, 1));
      break;
    }
    case 'semiannual': {
      const half = today.getMonth() < 6 ? 0 : 6;
      start = toISO(new Date(today.getFullYear(), half, 1));
      break;
    }
    case 'annually':
      start = toISO(new Date(today.getFullYear(), 0, 1));
      break;
    default:
      start = end;
  }
  return { startDate: start, endDate: end };
}
