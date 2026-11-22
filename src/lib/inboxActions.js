import { NEPAL_TZ } from '../utils/nepalTime';
// Inbox hover quick actions (ZNLY-140): which primary action a row offers, the "handled by" note, and the
// Gmail-style delayed save behind Confirm. Pure (no React, no Supabase) so it is unit-tested (inboxActions.test.js).

export const CONFIRM_UNDO_MS = 5000;

const TEAM_TYPES = ['attendance_gaps', 'attendance_gap', 'transferred_staff_reminder'];
const DEST_BY_CATEGORY = { team: 'attendance', stock: 'products', guests: 'outreach-review' };
export const OPEN_LABEL = { attendance: 'Open attendance →', products: 'Open products →', 'outreach-review': 'Open review →' };

/** Booking start (date + start_time, Nepal time) already behind us? Unknown start = not passed. */
export function startedAlready(booking, now = new Date()) {
  if (!booking?.date || !booking?.start_time) return false;
  const start = new Date(`${booking.date}T${String(booking.start_time).slice(0, 8)}+05:45`);
  return !Number.isNaN(start.getTime()) && start.getTime() < new Date(now).getTime();
}

/** An online-booking notification that points at a booking the join could not find (deleted). */
export const isRemovedBooking = (row) => row?.type === 'new_online_booking' && !!row.bookingId && !row.booking;

/**
 * row: { type, category, booking?: { status, ... } }  ->  'confirm' | 'note' | 'open' (the booking panel) | 'open:<dest>' | 'none'.
 * Online bookings: Confirm while Pending (not for read-only viewers), otherwise the "handled by" note.
 * Team / stock / guests rows: a "go there" action. Discount and approval rows already open their booking, so none.
 */
export function actionFor(row, { role, now = new Date() } = {}) {
  if (!row) return 'none';
  if (row.type === 'new_online_booking') {
    const status = row.booking?.status;
    if (!status) return 'none'; // deleted (the join came back empty) or never had one
    if (status === 'Pending') {
      if (startedAlready(row.booking, now)) return 'open'; // too late to confirm: look at it instead
      return role === 'admin_viewer' ? 'none' : 'confirm';
    }
    return 'note';
  }
  const dest = TEAM_TYPES.includes(row.type) ? 'attendance' : DEST_BY_CATEGORY[row.category];
  return dest ? `open:${dest}` : 'none';
}

/** Nepal-time h:mm (no am/pm, as in the mockup: "Confirmed by Ram · 9:12"). */
export const clockOf = (iso) => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: NEPAL_TZ, hour: 'numeric', minute: '2-digit', hourCycle: 'h12' }).formatToParts(new Date(iso));
  return `${parts.find((p) => p.type === 'hour').value}:${parts.find((p) => p.type === 'minute').value}`;
};

/**
 * "Confirmed by Ram · 9:12" / "Cancelled by you · 9:12" / "Confirmed" (nobody recorded).
 * The status changer isn't stored, so the person who acknowledged the booking stands in for them.
 */
export function noteFor(row, { userId } = {}) {
  const b = row?.booking;
  if (!b?.status) return '';
  const who = b.acknowledged_by && b.acknowledged_by === userId ? 'you'
    : (b.acknowledger?.full_name || '').trim().split(/\s+/)[0] || null;
  const head = who ? `${b.status} by ${who}` : b.status;
  return b.acknowledged_at ? `${head} · ${clockOf(b.acknowledged_at)}` : head;
}

/**
 * The always-visible status in the title line (online bookings only):
 * Pending -> { kind: 'pending', text: 'Needs confirming' }; handled -> { kind: 'note', text: noteFor(...) }, with a "✓ " while
 * its Confirm is still waiting out the Undo window (`saving`); anything else -> { kind: null, text: '' }.
 */
export function statusChipFor(row, { userId, saving = false, now = new Date(), word = 'booking' } = {}) {
  if (isRemovedBooking(row)) return { kind: 'removed', text: `${word.charAt(0).toUpperCase()}${word.slice(1)} removed` };
  if (row?.type !== 'new_online_booking' || !row.booking?.status) return { kind: null, text: '' };
  if (row.booking.status === 'Pending') {
    return startedAlready(row.booking, now) ? { kind: 'late', text: 'Time passed · not confirmed' } : { kind: 'pending', text: 'Needs confirming' };
  }
  const text = noteFor(row, { userId });
  return text ? { kind: 'note', text: saving ? `✓ ${text}` : text } : { kind: null, text: '' };
}

/**
 * Delayed save with Undo. schedule(id, payload) starts a timer; after `delayMs` save(id, payload) runs.
 * undo(id) cancels it (nothing written). flush() saves everything still waiting now (page leave / unmount).
 * Each id has its own timer, so several confirms in a row each get their own pending save.
 */
export function createDelayedSaver({ save, delayMs = CONFIRM_UNDO_MS, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const pending = new Map();
  const run = (id) => {
    const p = pending.get(id);
    if (!p) return Promise.resolve();
    pending.delete(id);
    clearTimer(p.timer);
    return Promise.resolve(save(id, p.payload));
  };
  return {
    schedule(id, payload) {
      if (pending.has(id)) return;
      pending.set(id, { payload, timer: setTimer(() => { run(id); }, delayMs) });
    },
    undo(id) {
      const p = pending.get(id);
      if (!p) return false;
      clearTimer(p.timer);
      pending.delete(id);
      return true;
    },
    flush: () => Promise.all([...pending.keys()].map(run)),
    has: (id) => pending.has(id),
    get size() { return pending.size; },
  };
}
