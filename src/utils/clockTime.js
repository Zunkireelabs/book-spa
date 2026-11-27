import { NEPAL_TZ } from './nepalTime';
import { readUse24h } from './clockPref';

// One place for staff-facing clock text. `use24h` is a purely cosmetic per-user display preference: it never touches
// the "HH:MM"/"HH:MM:SS" values bookings are stored/compared in. Customer-facing text stays 12h and does not use it.
export function formatClockTime(timeStr, use24h) {
  if (!timeStr) return '';
  const [h0, m] = timeStr.split(':').map(Number);
  if (use24h) return `${String(h0).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const h = h0 % 24; // "24:00" (end of day) is midnight: 12:00am in 12h; it stays "24:00" in 24h
  const period = h >= 12 ? 'pm' : 'am';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')}${period}`;
}

// "2:00–5:45pm" (am/pm once when both ends share it), "11:30am–12:15pm"; 24h is never compacted: "14:30–16:30".
export function formatClockRange(start, end, use24h) {
  if (!start) return '';
  const a = formatClockTime(start, use24h);
  if (!end) return a;
  const b = formatClockTime(end, use24h);
  return !use24h && a.slice(-2) === b.slice(-2) ? `${a.slice(0, -2)}–${b}` : `${a}–${b}`;
}

// Label for a whole-hour gridline / column header (e.g. "9am" / "09:00").
export function formatHourLabel(hour, use24h) {
  if (use24h) return `${String(hour).padStart(2, '0')}:00`;
  if (hour === 0) return '12am';
  if (hour < 12) return `${hour}am`;
  if (hour === 12) return '12pm';
  return `${hour - 12}pm`;
}

// An ISO timestamp as Nepal wall-clock time, whatever the viewer's browser timezone is.
export function formatClockIso(iso, use24h) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: NEPAL_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((p) => [p.type, p.value]));
  return formatClockTime(`${parts.hour}:${parts.minute}`, use24h);
}

// For plain (non-React) text builders: an ISO timestamp in Nepal time, in the saved choice.
export const formatClockIsoNow = (iso) => formatClockIso(iso, readUse24h());

// "5 Jun 2026, 2:14pm" (Nepal time): the date part is fixed, the clock part follows the saved choice.
export const formatStampNow = (iso, withYear = true) => {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('en-GB', { timeZone: NEPAL_TZ, day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) })}, ${formatClockIsoNow(iso)}`;
};

// For plain (non-React) text builders such as error messages: reads the saved choice at call time.
export const formatClockNow = (timeStr) => formatClockTime(timeStr, readUse24h());
