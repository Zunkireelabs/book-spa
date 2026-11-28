import { NEPAL_TZ } from '../utils/nepalTime';
// Attendance of a visiting therapist (ZNLY-113 / V33c). One row per person per day, owned by HOME; worked_at_branch_id says where it
import { wordBranch } from '../utils/industryTerms';
import { formatClockNow } from '../utils/clockTime';
// was checked in. Home's Attendance and the profile History show "Worked at Sanepa 12:02 – 3:30 pm" from that row.

/** "12:02" -> "12:02 pm", "15:30" -> "3:30 pm" (the app's 12-hour style). */

/**
 * row: { workedAtBranchId, checkInTime: 'HH:MM'|null, checkOutTime: 'HH:MM'|null }; homeBranchId: the person's home; branchNameById: map.
 * Returns the note text, or null when the work was at home / nowhere recorded.
 */
export function workedAtNote({ row, homeBranchId, branchNameById }) {
  if (!row || !row.workedAtBranchId || row.workedAtBranchId === homeBranchId) return null;
  const name = branchNameById?.[row.workedAtBranchId] || `another ${wordBranch()}`;
  const span = row.checkInTime
    ? ` ${formatClockNow(row.checkInTime)}${row.checkOutTime ? ` – ${formatClockNow(row.checkOutTime)}` : ''}`
    : '';
  return `Worked at ${name}${span}`;
}

/** "from 6:55 pm" for a visitor whose window has not started yet (window start is an ISO timestamp). */
export function visitFromText(windowFromIso) {
  const hm = new Date(windowFromIso).toLocaleTimeString('en-GB', { timeZone: NEPAL_TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  return `from ${formatClockNow(hm)}`;
}
