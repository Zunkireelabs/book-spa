import { describe, it, expect } from 'vitest';
import { buildAddServiceSlot, lockedClientOf, sameStaffIfFree } from './addServiceSlot';

const base = { id: 'BK-20261122-0015', bookingId: 'uuid-1', date: '2026-11-22', startTime: '11:20:00', endTime: '11:50:00', serviceId: 'svc-1', customerName: 'Walk-in · Sahil', therapists: [{ id: 't-susan' }] };
const raw = (o) => ({ id: 'x', date: '2026-11-22', status: 'Confirmed', start_time: '11:50:00', end_time: '13:50:00', therapist_id: 't-susan', ...o });

describe('lockedClientOf', () => {
  it('walk-in stays a walk-in with its label', () => expect(lockedClientOf({ ...base, isWalkIn: true, walkInLabel: 'Sahil' })).toMatchObject({ kind: 'walkin', walkInLabel: 'Sahil', bookingNumber: base.id }));
  it('known client is used by record id', () => expect(lockedClientOf({ ...base, customerId: 'c1', customerName: 'Anish Balami' })).toMatchObject({ kind: 'existing', customerId: 'c1' }));
  it('a walk-in with a linked client is that client by record, not a clientless walk-in', () => {
    // the booking's customer_name is the walk-in text, so the name is left for the panel to load from the client record
    expect(lockedClientOf({ ...base, isWalkIn: true, walkInLabel: 'Sahil', customerId: 'c9', customerName: 'Walk-in · Sahil' })).toMatchObject({ kind: 'existing', customerId: 'c9', name: '' });
    const slot = buildAddServiceSlot({ booking: { ...base, isWalkIn: true, customerId: 'c9' } });
    expect(slot).toMatchObject({ defaultCustomerId: 'c9', lockedClient: { kind: 'existing' } });
  });
  it('old booking with no record cannot be locked', () => expect(lockedClientOf(base)).toBeNull());
});

describe('presets one person only', () => {
  const couple = { ...base, therapists: [{ id: 't-susan' }, { id: 't-aksa' }] };
  it('a couple source presets only the first person', () => expect(buildAddServiceSlot({ booking: couple }).defaultTherapistIds).toEqual(['t-susan']));
  it('the first person busy means nobody is preset (the second is not substituted)', () => {
    expect(buildAddServiceSlot({ booking: couple, rawBookings: [raw({ start_time: '11:40:00' })] }).defaultTherapistIds).toEqual([]);
  });
  it('sameStaffIfFree with max 2 keeps both when free (couple service)', () => expect(sameStaffIfFree(couple, [], 11 * 60 + 50, 2)).toEqual(['t-susan', 't-aksa']));
});

describe('buildAddServiceSlot', () => {
  it('+ Service: same day, time = end of the current service, service list opens first, walk-in locked', () => {
    const s = buildAddServiceSlot({ booking: { ...base, isWalkIn: true, walkInLabel: 'Sahil' } });
    expect(s).toMatchObject({ day: '2026-11-22', hour: 11, minute: 50, title: 'Add a service', openServiceFirst: true, lockedClient: { kind: 'walkin' } });
  });
  it('same staff when free at that minute, empty when busy', () => {
    expect(buildAddServiceSlot({ booking: base, rawBookings: [] }).defaultTherapistIds).toEqual(['t-susan']);
    expect(buildAddServiceSlot({ booking: base, rawBookings: [raw({ start_time: '11:40:00' })] }).defaultTherapistIds).toEqual([]);
  });
  it('a booking that starts exactly when the current one ends does not count as busy before it; one covering that minute does', () => {
    expect(sameStaffIfFree(base, [raw({ start_time: '11:50:00' })], 11 * 60 + 50)).toEqual([]);
    expect(sameStaffIfFree(base, [raw({ start_time: '12:00:00' })], 11 * 60 + 50)).toEqual(['t-susan']);
  });
  it('cancelled, other-day and the booking itself are ignored', () => {
    const rb = [raw({ status: 'Cancelled' }), raw({ date: '2026-11-23' }), raw({ id: 'uuid-1' })];
    expect(sameStaffIfFree(base, rb, 11 * 60 + 50)).toEqual(['t-susan']);
  });
  it('junction-table therapists are read before the primary one', () => {
    expect(sameStaffIfFree(base, [raw({ therapist_id: null, booking_therapists: [{ therapist_id: 't-susan' }] })], 11 * 60 + 50)).toEqual([]);
  });
  it('rebook: title, service carried over, time = original start, same staff if free then', () => {
    const s = buildAddServiceSlot({ booking: { ...base, customerId: 'c1' }, mode: 'rebook' });
    expect(s).toMatchObject({ title: 'Rebook', defaultServiceId: 'svc-1', openServiceFirst: false, defaultCustomerId: 'c1', hour: 11, minute: 20, defaultTherapistIds: ['t-susan'] });
  });
  it.each([
    ['busy at the original start', [raw({ start_time: '11:00:00', end_time: '12:00:00' })], []],
    ['free at the original start', [raw({ start_time: '11:30:00', end_time: '12:00:00' })], ['t-susan']],
    ['the booking itself does not block its own rebook', [raw({ id: 'uuid-1', start_time: '11:20:00', end_time: '11:50:00' })], ['t-susan']],
  ])('rebook staff default: %s', (_n, rb, want) => {
    expect(buildAddServiceSlot({ booking: base, mode: 'rebook', rawBookings: rb }).defaultTherapistIds).toEqual(want);
  });
  it('old booking without a record keeps name and split phone for the panel to complete', () => {
    const s = buildAddServiceSlot({ booking: { ...base, customerName: 'Ram', customerPhone: '+9779841000000' }, mode: 'rebook' });
    expect(s.lockedClient).toBeNull(); expect(s).toMatchObject({ defaultCustomerName: 'Ram', defaultCustomerPhone: '9841000000', defaultCustomerCountryCode: '+977' });
  });
});

// ZNLY-436: the start follows the client's own chain of services
describe('nextFreeStart chain', () => {
  const me = { ...base, endTime: '12:30:00', customerId: 'c1', visitId: 'v1' };
  const own = (id, s, e, o = {}) => raw({ id, customer_id: 'c1', start_time: s, end_time: e, therapist_id: `t-${id}`, ...o });
  const start = (rawBookings, booking = me) => { const s = buildAddServiceSlot({ booking, rawBookings }); return [s.hour, s.minute, s.defaultTherapistIds]; };
  it('no other service: the end of the clicked one, same staff', () => expect(start([])).toEqual([12, 30, ['t-susan']]));
  it('chain 12:30 -> 1:00 -> 1:15, staff of the last service jumped over', () => {
    expect(start([own('a', '12:30:00', '13:00:00'), own('b', '13:00:00', '13:15:00')])).toEqual([13, 15, ['t-b']]);
  });
  it('a gap stops the chain', () => expect(start([own('a', '12:30:00', '13:00:00'), own('b', '13:15:00', '13:45:00')])).toEqual([13, 0, ['t-a']]));
  it('a cancelled service and another client\'s booking are ignored', () => {
    expect(start([own('a', '12:30:00', '13:00:00', { status: 'Cancelled' }), own('b', '12:30:00', '13:00:00', { customer_id: 'c2', therapist_id: 't-z' })])).toEqual([12, 30, ['t-susan']]);
  });
  it('a walk-in with no customer_id follows its visit only (other walk-ins ignored)', () => {
    const w = { ...base, endTime: '12:30:00', isWalkIn: true, visitId: 'v1', customerId: null };
    expect(start([own('a', '12:30:00', '13:00:00', { customer_id: null, visit_id: 'v1' }), own('b', '13:00:00', '14:00:00', { customer_id: null, visit_id: 'v2' })], w)).toEqual([13, 0, ['t-a']]);
  });
  it('the followed service\'s staff busy at the new start: nobody is preset', () => {
    expect(start([own('a', '12:30:00', '13:00:00'), raw({ id: 'z', customer_id: 'c2', start_time: '12:45:00', end_time: '13:30:00', therapist_id: 't-a' })])[2]).toEqual([]);
  });
  it('carries the source booking back and the visit summary (dead rows ignored)', () => {
    const s = buildAddServiceSlot({ booking: me, blockRows: [{ start: '11:00', end: '11:45', final: 500 }, { start: '12:00', end: '12:30', final: 250.5 }, { dead: true, start: '09:00', end: '10:00', final: 99 }] });
    expect(s.returnToBooking).toBe(me);
    expect(s.visit).toEqual({ count: 2, start: '11:00', end: '12:30', total: 750.5 });
  });
});
