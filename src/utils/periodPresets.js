// Shared period presets for report date filtering.
// Ranges are calendar-period-to-date ending today, except "weekly" which is a
// rolling last-7-days window. Dates are formatted in local (Nepal) time so the
// boundaries line up with the user's calendar rather than UTC.

export const PERIOD_PRESETS = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'semiannual', label: 'Semi-Annually' },
  { id: 'annually', label: 'Annually' },
];

const toISO = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export function getPeriodRange(presetId) {
  const today = new Date();
  const end = toISO(today);
  let start;
  switch (presetId) {
    case 'daily':
      start = end;
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
