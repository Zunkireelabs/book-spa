// Pure view-model for the therapist inner page's Customers tab (ZNLY-172): rows of get_therapist_customers (migration 374) in, groups / pills / tiles /
// ✦ suggestions / sentences / CSV out. Unit-tested; no React. Owner rule: no number may be readable two ways, so a row carries labels, not visit counts.
import { shortDate, dayRange } from './therapistInnerView';

const BOOKED = ['completed', 'not_closed', 'upcoming'];
const num = (n) => Number(n || 0).toLocaleString('en-IN');
export const TYPE_LABEL = { new: 'New to us', returning: 'Returning', not_served: 'Not served yet' };

/** One row's derived flags and counts. */
export function decorate(c) {
  const by = { completed: [], not_closed: [], upcoming: [], cancelled: [], no_show: [] };
  for (const b of c.bookings || []) (by[b.group] || (by[b.group] = [])).push(b);
  const booked = BOOKED.some((g) => by[g].length > 0);
  const served = by.completed.length > 0;
  const oldestOpen = by.not_closed.length ? by.not_closed.map((b) => `${b.date} ${b.start}`).sort()[0] : null; // date then time
  const group = served ? 'served' : by.not_closed.length ? 'not_closed' : by.upcoming.length ? 'upcoming' : 'cancelled';
  return { ...c, by, booked, served, group, oldestOpen, sales: Number(c.sales) || 0, owed: Number(c.owed) || 0 };
}

/** Booked = ≥1 booking not Cancelled / No-show (Pending counts). Served = ≥1 Completed. The pill counts use the same sets. */
export function build(rows) {
  const all = (rows || []).map(decorate);
  const served = all.filter((c) => c.group === 'served').sort((a, b) => b.sales - a.sales || a.name.localeCompare(b.name));
  const notClosed = all.filter((c) => c.group === 'not_closed').sort((a, b) => a.oldestOpen.localeCompare(b.oldestOpen) || a.name.localeCompare(b.name));
  const upcoming = all.filter((c) => c.group === 'upcoming').sort((a, b) => a.name.localeCompare(b.name));
  const cancelled = all.filter((c) => c.group === 'cancelled').sort((a, b) => a.name.localeCompare(b.name));
  return {
    served, notClosed, upcoming, cancelled,
    counts: { booked: served.length + notClosed.length + upcoming.length, served: served.length, notClosed: notClosed.length, upcoming: upcoming.length, cancelled: cancelled.length },
  };
}

/** The booked-again split of the served customers: with this person, with someone else, not assigned yet. */
export function rebookSplit(served) {
  const again = served.filter((c) => c.booked_again);
  return {
    served: served.length, again: again.length,
    withMe: again.filter((c) => c.booked_again.with_this_therapist === true).length,
    other: again.filter((c) => c.booked_again.therapist && c.booked_again.with_this_therapist !== true).length,
    unassigned: again.filter((c) => !c.booked_again.therapist).length,
  };
}

/** Tile text. `first` = the person's first name. Booked again needs 5 served customers (339's rule), else "—". */
export function tiles(v, first) {
  const sp = rebookSplit(v.served);
  const owedRows = v.served.filter((c) => c.owed > 0);
  const owedTotal = owedRows.reduce((n, c) => n + c.owed, 0);
  const top = owedRows.reduce((a, c) => (!a || c.owed > a.owed ? c : a), null);
  const parts = [];
  parts.push(`${sp.withMe} with ${first}`);
  if (sp.other) parts.push(`${sp.other} with ${sp.other === 1 && !sp.withMe ? 'another therapist' : 'other therapists'}`);
  if (sp.unassigned) parts.push(`${sp.unassigned} not assigned yet`);
  const cancelledNote = v.counts.cancelled ? ` · ${v.counts.cancelled} only cancelled` : '';
  return {
    served: { value: v.counts.served, of: v.counts.booked, line: `${v.counts.notClosed + v.counts.upcoming} ${v.counts.notClosed + v.counts.upcoming === 1 ? 'has' : 'have'} bookings that are not closed${cancelledNote}` },
    again: { value: sp.served >= 5 ? `${Math.round((sp.again / sp.served) * 100)}%` : '—', of: `${sp.again} of ${sp.served}`, line: sp.served >= 5 ? `within 60 days · ${parts.length ? parts.join(', ') : 'none yet'}` : `needs 5 served customers (${sp.served} so far)`, split: sp },
    newToSpa: { value: v.served.filter((c) => c.type === 'new').length, of: v.counts.served },
    owed: { total: owedTotal, customers: owedRows.length, top },
  };
}

/** Up to two ✦ suggestions: (a) booked again but none, or under half, with this person; (b) the largest owed customer. */
export function suggestions(v, first, today) {
  const out = [];
  const sp = rebookSplit(v.served);
  if (sp.again >= 1 && sp.withMe * 2 < sp.again) {
    out.push({ key: 'rebook', text: `${sp.again} of ${first}'s ${sp.served} customers booked again, but ${sp.withMe === 0 ? 'none' : `only ${sp.withMe}`} with ${first}.`, tail: `Offering the next visit with ${first} at checkout may keep them.` });
  }
  const t = tiles(v, first).owed.top;
  if (t) {
    const since = [...t.by.completed].filter((b) => b.price > 0).map((b) => b.date).sort()[0];
    const again = t.booked_again ? ` booked again for ${shortDate(t.booked_again.date)}${t.booked_again.therapist ? ` (${t.booked_again.therapist})` : ''} but` : '';
    out.push({ key: 'owed', name: t.name, text: `${again} still owes ${num(t.owed)}${since ? ` from ${shortDate(since)}` : ''}.`, tail: 'Collect it at that visit.', link: 'money' });
  }
  return out.slice(0, 2);
}

export const searchRows = (rows, q) => {
  const s = String(q || '').trim().toLowerCase();
  return s ? rows.filter((c) => String(c.name || '').toLowerCase().includes(s) || String(c.phone || '').replace(/\s/g, '').includes(s.replace(/\s/g, ''))) : rows;
};

/** The chip on one booking line of the expanded row. */
export function statusChip(b) {
  const paid = b.payment_status === 'paid';
  switch (b.group) {
    case 'completed': return { text: paid ? 'Completed · paid' : 'Completed', tone: paid ? 'ok' : 'warn' };
    case 'not_closed': return { text: Number(b.paid_amount) > 0 ? 'Not closed · paid ahead' : 'Not closed', tone: 'warn' };
    case 'upcoming': return { text: 'Upcoming', tone: 'flat' };
    case 'no_show': return { text: 'No-show', tone: 'flat' };
    default: return { text: 'Cancelled', tone: 'flat' };
  }
}

/** The "With <therapist>" cell: "1 served · 2 not closed". Words only where a count is non-zero. */
export function withCell(c) {
  const bits = [];
  if (c.by.completed.length) bits.push(`${c.by.completed.length} served`);
  if (c.by.not_closed.length) bits.push(`${c.by.not_closed.length} not closed`);
  if (c.by.upcoming.length) bits.push(`${c.by.upcoming.length} upcoming`);
  if (!bits.length) { const n = c.by.cancelled.length + c.by.no_show.length; bits.push(`${n} ${c.by.no_show.length && !c.by.cancelled.length ? 'no-show' : 'cancelled'}`); }
  return bits;
}

/** "16, 19 Oct" style list of the dates of the not-closed bookings. */
export function openDates(c) {
  const d = c.by.not_closed.map((b) => b.date).sort();
  if (!d.length) return '';
  const [, , ] = d[0].split('-');
  const same = d.every((x) => x.slice(0, 7) === d[0].slice(0, 7));
  const pend = c.by.not_closed.length === 1 && c.by.not_closed[0].status === 'Pending' ? ' (Pending)' : '';
  return (same ? `${d.map((x) => Number(x.slice(8))).join(', ')} ${shortDate(d[0]).split(' ')[1]}` : d.map(shortDate).join(', ')) + pend;
}

/** The right side of the expanded row: sentences, no totals. */
export function elsewhere(c, first) {
  const who = (t) => (t ? ` with ${t}` : ' (no therapist yet)');
  const lines = [];
  lines.push(c.first_visit ? { k: 'First visit', v: `${shortDate(c.first_visit.date)}, ${c.first_visit.service}${c.first_visit.therapist ? ` with ${c.first_visit.therapist}` : ''}` } : { k: 'First visit', v: 'none yet' });
  lines.push(c.booked_again ? { k: 'Booked again', v: `${shortDate(c.booked_again.date)}, ${c.booked_again.service}${who(c.booked_again.therapist)}` } : { k: 'Booked again', v: c.served ? 'not within 60 days' : 'not applicable until served' });
  lines.push(c.next_booking ? { k: 'Next booking', v: `${shortDate(c.next_booking.date)}, ${c.next_booking.service}${c.next_booking.therapist ? ` with ${c.next_booking.therapist}` : ''}` } : { k: 'Next booking', v: 'none after today' });
  return lines;
}

/** The Booked again cell: "Yes · 17 Oct · Anil T." / "No · served today" / "—". */
export function againCell(c, today) {
  if (!c.served) return { yes: false, text: '—' };
  if (c.booked_again) return { yes: true, text: `Yes · ${shortDate(c.booked_again.date)} · ${c.booked_again.therapist || 'no therapist yet'}`, me: c.booked_again.with_this_therapist === true };
  return { yes: false, text: c.last_served === today ? 'No · served today' : 'No' };
}

export const CSV_HEAD = ['Customer', 'Phone', 'Bookings with therapist', 'Completed', 'Not closed', 'Sales', 'Owed', 'Last served', 'Booked again', 'Booked again with', 'Customer type'];
/** One row per customer, as on screen (every customer of the tab, whatever the filter). */
export const csvRows = (rows) => [CSV_HEAD, ...rows.map((c) => [
  c.name, c.phone || '', (c.bookings || []).length, c.by.completed.length, c.by.not_closed.length, c.sales, c.owed, c.last_served || '',
  c.booked_again?.date || '', c.booked_again ? (c.booked_again.therapist || 'no therapist yet') : '', TYPE_LABEL[c.type] || '',
])];

export { dayRange };
