import { describe, it, expect } from 'vitest';
import { buildAddServiceSlot, lockedClientOf, sameStaffIfFree } from './addServiceSlot';

const base = { id: 'BK-20261122-0015', bookingId: 'uuid-1', date: '2026-11-22', startTime: '11:20:00', endTime: '11:50:00', serviceId: 'svc-1', customerName: 'Walk-in · Sahil', therapists: [{ id: 't-susan' }] };
const raw = (o) => ({ id: 'x', date: '2026-11-22', status: 'Confirmed', start_time: '11:50:00', end_time: '13:50:00', therapist_id: 't-susan', ...o });

describe('lockedClientOf', () => {
  it('walk-in stays a walk-in with its label', () => expect(lockedClientOf({ ...base, isWalkIn: true, walkInLabel: 'Sahil' })).toMatchObject({ kind: 'walkin', walkInLabel: 'Sahil', bookingNumber: base.id }));
  it('known client is used by record id', () => expect(lockedClientOf({ ...base, customerId: 'c1', customerName: 'Anish Balami' })).toMatchObject({ kind: 'existing', customerId: 'c1' }));
  it('old booking with no record cannot be locked', () => expect(lockedClientOf(base)).toBeNull());
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
