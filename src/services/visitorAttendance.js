// Attendance of a visiting therapist (ZNLY-113 / V33c). One row per person per day, owned by HOME; worked_at_branch_id says where it
// was checked in. Home's Attendance and the profile History show "Worked at Sanepa 12:02 – 3:30 pm" from that row.

/** "12:02" -> "12:02 pm", "15:30" -> "3:30 pm" (the app's 12-hour style). */
export function hmTo12h(hm) {
  if (!hm) return '';
  const [h, m] = String(hm).slice(0, 5).split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`;
}

/**
 * row: { workedAtBranchId, checkInTime: 'HH:MM'|null, checkOutTime: 'HH:MM'|null }; homeBranchId: the person's home; branchNameById: map.
 * Returns the note text, or null when the work was at home / nowhere recorded.
 */
export function workedAtNote({ row, homeBranchId, branchNameById }) {
  if (!row || !row.workedAtBranchId || row.workedAtBranchId === homeBranchId) return null;
  const name = branchNameById?.[row.workedAtBranchId] || 'another branch';
  const span = row.checkInTime
    ? ` ${hmTo12h(row.checkInTime)}${row.checkOutTime ? ` – ${hmTo12h(row.checkOutTime)}` : ''}`
    : '';
  return `Worked at ${name}${span}`;
}

/** "from 6:55 pm" for a visitor whose window has not started yet (window start is an ISO timestamp). */
export function visitFromText(windowFromIso) {
  const hm = new Date(windowFromIso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', hour12: false });
  return `from ${hmTo12h(hm)}`;
}
