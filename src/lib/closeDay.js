// Close Day rules (ZNLY-234). The database refuses the close too (trigger on daily_reports, migration 392); this is the plain-words side.
export const UNFINISHED_STATUSES = ['Pending', 'Confirmed', 'In-Progress'];

export function isUnfinished(status) {
  return UNFINISHED_STATUSES.includes(status);
}

// rows: [{ bookingId, bookingNumber, customerName, status }]. Blocked while any booking of the day is unfinished.
export function closeDayBlock(rows) {
  const list = (rows || []).filter((r) => isUnfinished(r.status));
  if (list.length === 0) return { blocked: false, count: 0, message: '', rows: [] };
  const n = list.length;
  return {
    blocked: true,
    count: n,
    rows: list,
    message: `${n} booking${n === 1 ? ' is' : 's are'} still Pending, Confirmed or In-Progress. Complete, cancel or mark ${n === 1 ? 'it' : 'them'} no-show first; closing the day would freeze ${n === 1 ? 'it' : 'them'} as is.`,
  };
}

// The warning for part-paid / unpaid bookings, which do NOT block the close (they stay collectable afterwards).
export function unpaidCloseWarning(count) {
  if (!(count > 0)) return '';
  return `${count} booking${count === 1 ? ' is' : 's are'} not fully paid. You can still close the day: the balance can be collected later, it is recorded on the day it is received, and the closed day's report does not change.`;
}
