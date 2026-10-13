// Pure date/time helpers shared by the calendar orchestrator, the grid and the quick-create panel.
import { to12h as to12hSpaced } from '../../../../services/bookingTransformers';

export function toLocalISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function todayStr() {
  return toLocalISO(new Date());
}

// Local-time date math. We can't use toISOString here: in Nepal (UTC+5:45)
// local midnight is the previous UTC day, so toISOString().split('T')[0]
// strips off the day-increment we just applied.
export function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return toLocalISO(d);
}

// Local-time month math; clamps to the last day of the target month (Jan 31 + 1 month -> Feb 28).
export function addMonths(dateStr, months) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return toLocalISO(d);
}

// Nepal-business-timezone date ("YYYY-MM-DD") + time-of-day ("HH:MM") for an ISO instant,
// regardless of the viewer's own browser timezone.
export function toKathmanduParts(isoString) {
  if (!isoString) return null;
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return null;
  return {
    date: d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kathmandu' }),
    time: d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', hour12: false }),
  };
}

// Compact 12h ('2:00pm') to match the gutter and cards.
export const to12h = (t) => to12hSpaced(t).replace(' ', '');

export function getDateRange(dateStr, viewMode) {
  if (viewMode === '4day') {
    return { start: dateStr, end: addDays(dateStr, 3) };
  }
  return { start: dateStr, end: dateStr };
}

export function getStepDays(viewMode) {
  return viewMode === '4day' ? 4 : 1;
}

export function formatTimeFromSlot(hour, minute) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function calculateEndTime(startHour, startMinute, durationMinutes) {
  const totalMinutes = startHour * 60 + startMinute + (durationMinutes || 60);
  const endHour = Math.floor(totalMinutes / 60);
  const endMinute = totalMinutes % 60;
  return `${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`;
}

export function formatTimeDisplay(time) {
  if (!time) return '';
  // Convert HH:MM to display format
  const [h, m] = time.split(':').map(Number);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
