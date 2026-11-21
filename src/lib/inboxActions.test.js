import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { actionFor, noteFor, clockOf, statusChipFor, isRemovedBooking, createDelayedSaver } from './inboxActions';

const online = (booking, o = {}) => ({ type: 'new_online_booking', category: 'bookings', booking, ...o });

describe('actionFor', () => {
  it('Pending online booking -> confirm', () => expect(actionFor(online({ status: 'Pending' }), { role: 'staff' })).toBe('confirm'));
  it.each(['manager', 'admin'])('%s can confirm', (role) => expect(actionFor(online({ status: 'Pending' }), { role })).toBe('confirm'));
  it('admin_viewer gets no Confirm', () => expect(actionFor(online({ status: 'Pending' }), { role: 'admin_viewer' })).toBe('none'));
  it.each(['Confirmed', 'In-Progress', 'Completed', 'Cancelled', 'No Show'])('%s -> note', (status) =>
    expect(actionFor(online({ status }), { role: 'staff' })).toBe('note'));
  it('viewer still sees the note for a handled booking', () => expect(actionFor(online({ status: 'Confirmed' }), { role: 'admin_viewer' })).toBe('note'));
  it('missing booking (deleted) -> none', () => expect(actionFor(online(null), { role: 'staff' })).toBe('none'));
  it.each(['attendance_gaps', 'attendance_gap', 'transferred_staff_reminder'])('%s -> open attendance', (type) =>
    expect(actionFor({ type, category: 'team' }, { role: 'manager' })).toBe('open:attendance'));
  it('stock -> products, guests -> review', () => {
    expect(actionFor({ type: 'low_stock', category: 'stock' }, {})).toBe('open:products');
    expect(actionFor({ type: 'renewal_due', category: 'guests' }, {})).toBe('open:outreach-review');
  });
  it.each(['discount_request', 'discount_approved', 'discount_declined', 'discount_big_fyi', 'discount_fyi'])('%s -> none', (type) =>
    expect(actionFor({ type, category: 'approvals' }, { role: 'manager' })).toBe('none'));
  it('guest cancel/reschedule rows -> none', () => {
    expect(actionFor({ type: 'booking_cancelled_by_guest', category: 'bookings', booking: { status: 'Cancelled' } }, {})).toBe('none');
  });
});

describe('noteFor', () => {
  const at = '2026-10-29T03:27:00Z'; // 9:12 Nepal
  it('names the acknowledger by first name + Nepal time', () =>
    expect(noteFor({ booking: { status: 'Confirmed', acknowledged_at: at, acknowledged_by: 'u2', acknowledger: { full_name: 'Ram Thapa' } } }, { userId: 'u1' })).toBe('Confirmed by Ram · 9:12'));
  it('"by you" when it is me', () =>
    expect(noteFor({ booking: { status: 'Confirmed', acknowledged_at: at, acknowledged_by: 'u1', acknowledger: { full_name: 'Me X' } } }, { userId: 'u1' })).toBe('Confirmed by you · 9:12'));
  it('uses the status word for cancelled etc.', () =>
    expect(noteFor({ booking: { status: 'Cancelled', acknowledged_at: at, acknowledger: { full_name: 'Sita' } } }, {})).toBe('Cancelled by Sita · 9:12'));
  it('nobody recorded -> just the status', () => expect(noteFor({ booking: { status: 'Confirmed' } }, {})).toBe('Confirmed'));
  it('no booking -> empty', () => expect(noteFor({ booking: null }, {})).toBe(''));
  it('clockOf is Nepal h:mm', () => expect(clockOf('2026-10-29T09:15:00Z')).toBe('3:00'));
});

describe('statusChipFor', () => {
  const at = '2026-10-29T03:27:00Z';
  it('Pending -> amber pill, for every role (it is status)', () =>
    expect(statusChipFor(online({ status: 'Pending' }), { userId: 'u1' })).toEqual({ kind: 'pending', text: 'Needs confirming' }));
  it('handled -> note text', () =>
    expect(statusChipFor(online({ status: 'Confirmed', acknowledged_at: at, acknowledged_by: 'u2', acknowledger: { full_name: 'Ram T' } }), { userId: 'u1' }))
      .toEqual({ kind: 'note', text: 'Confirmed by Ram · 9:12' }));
  it('waiting out the Undo window -> ✓ prefix', () =>
    expect(statusChipFor(online({ status: 'Confirmed', acknowledged_at: at, acknowledged_by: 'u1' }), { userId: 'u1', saving: true }).text).toBe('✓ Confirmed by you · 9:12'));
  it('non-online rows and missing bookings -> none', () => {
    expect(statusChipFor({ type: 'low_stock', booking: null }, {}).kind).toBe(null);
    expect(statusChipFor(online(null), {}).kind).toBe(null);
  });
});

describe('deleted + past-Pending bookings', () => {
  const now = new Date('2026-10-29T08:00:00Z'); // 1:45 pm Nepal
  const pend = (date, start_time) => online({ status: 'Pending', date, start_time }, { bookingId: 'b1' });
  const gone = { type: 'new_online_booking', category: 'bookings', bookingId: 'b1', booking: null };
  it('deleted booking -> removed chip (industry word) and no action', () => {
    expect(isRemovedBooking(gone)).toBe(true);
    expect(statusChipFor(gone, { word: 'session' })).toEqual({ kind: 'removed', text: 'Session removed' });
    expect(statusChipFor(gone, {}).text).toBe('Booking removed');
    expect(actionFor(gone, { role: 'manager', now })).toBe('none');
  });
  it('no booking_id at all is not "removed"', () => expect(isRemovedBooking({ ...gone, bookingId: null })).toBe(false));
  it('Pending whose start has passed -> late chip + open (no Confirm), even for a viewer', () => {
    const r = pend('2026-10-29', '13:00:00');
    expect(statusChipFor(r, { now })).toEqual({ kind: 'late', text: 'Time passed · not confirmed' });
    expect(actionFor(r, { role: 'staff', now })).toBe('open');
    expect(actionFor(r, { role: 'admin_viewer', now })).toBe('open');
  });
  it('Pending later today / in the future -> still confirmable', () => {
    const r = pend('2026-10-29', '14:00:00');
    expect(statusChipFor(r, { now }).kind).toBe('pending');
    expect(actionFor(r, { role: 'staff', now })).toBe('confirm');
    expect(actionFor(pend('2026-10-30', '09:00:00'), { role: 'staff', now })).toBe('confirm');
  });
  it('a past day -> late', () => expect(actionFor(pend('2026-10-25', '10:00:00'), { role: 'manager', now })).toBe('open'));
});

describe('createDelayedSaver', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('saves after 5 s, not before', () => {
    const save = vi.fn();
    const s = createDelayedSaver({ save });
    s.schedule('a', { n: 1 });
    vi.advanceTimersByTime(4999);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledWith('a', { n: 1 });
    expect(s.size).toBe(0);
  });
  it('Undo cancels: nothing is written', () => {
    const save = vi.fn();
    const s = createDelayedSaver({ save });
    s.schedule('a', {});
    expect(s.undo('a')).toBe(true);
    vi.advanceTimersByTime(10000);
    expect(save).not.toHaveBeenCalled();
    expect(s.undo('a')).toBe(false);
  });
  it('flush saves everything waiting immediately, once', async () => {
    const save = vi.fn();
    const s = createDelayedSaver({ save });
    s.schedule('a', 1); s.schedule('b', 2);
    await s.flush();
    expect(save).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(10000);
    expect(save).toHaveBeenCalledTimes(2);
  });
  it('two pending confirms each keep their own timer and undo', () => {
    const save = vi.fn();
    const s = createDelayedSaver({ save });
    s.schedule('a', 1);
    vi.advanceTimersByTime(2000);
    s.schedule('b', 2);
    vi.advanceTimersByTime(3000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith('a', 1);
    s.undo('b');
    vi.advanceTimersByTime(5000);
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('scheduling the same id twice does not double-save', () => {
    const save = vi.fn();
    const s = createDelayedSaver({ save });
    s.schedule('a', 1); s.schedule('a', 1);
    vi.advanceTimersByTime(6000);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
