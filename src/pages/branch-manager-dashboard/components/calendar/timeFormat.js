// Shared 12h/24h clock-time formatting for the operational calendar (Day/Week/Month
// grids, booking cards, hover previews, print report). `use24h` is a purely cosmetic
// per-user display preference (see calendar/index.jsx's `use24h` state) — it never
// touches the underlying "HH:MM"/"HH:MM:SS" values bookings are stored/compared in.
export function formatClockTime(timeStr, use24h) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  if (use24h) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const period = h >= 12 ? 'pm' : 'am';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')}${period}`;
}

// Label for a whole-hour gridline / column header (e.g. "9am" / "09:00").
export function formatHourLabel(hour, use24h) {
  if (use24h) return `${String(hour).padStart(2, '0')}:00`;
  if (hour === 0) return '12am';
  if (hour < 12) return `${hour}am`;
  if (hour === 12) return '12pm';
  return `${hour - 12}pm`;
}
