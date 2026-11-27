// Time helpers shared by DateTimeRow (New booking + Edit details). "HH:MM" 24h strings in and out.

/** Free-typed time ("9", "9:30", "9:30am", "21:15") -> "HH:MM"; null while incomplete/invalid. */
export function parseTimeInput(raw) {
  const match = String(raw ?? '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;
  let h = parseInt(match[1], 10);
  const m = match[2] ? parseInt(match[2], 10) : 0;
  const ampm = match[3]?.toLowerCase();
  if (ampm) {
    if (h < 1 || h > 12) return null;
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
  }
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 15-minute slots from opening to closing time; the current value is added if it is off the grid. */
export function buildTimeOptions(branchHours, current) {
  const [openH] = (branchHours?.openTime || '09:00:00').split(':').map(Number);
  const [closeH, closeM] = (branchHours?.closeTime || '21:00:00').split(':').map(Number);
  const opts = [];
  for (let h = openH; h <= closeH; h++) {
    for (let m = 0; m < 60; m += 15) {
      if (h === closeH && m > closeM) break;
      opts.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  if (current && !opts.includes(current)) { opts.push(current); opts.sort(); }
  return opts;
}

/** "2026-11-21" -> "Sat 21 Nov". */
export function formatDateChip(date) {
  return date
    ? new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '')
    : 'Pick a date';
}
