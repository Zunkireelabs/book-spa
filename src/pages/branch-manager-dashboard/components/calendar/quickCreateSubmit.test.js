import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../services/api', () => ({
  createBooking: vi.fn(async () => ({ data: { id: 'new', booking_number: 'BK-1' }, error: null })),
  createBookingGroup: vi.fn(async () => ({ data: { bookings: [{ id: 'a', booking_number: 'BK-1' }, { id: 'b' }] }, error: null })),
  createComboBookingItems: vi.fn(),
  joinVisitOfBooking: vi.fn(),
}));
import { createBooking, createBookingGroup, joinVisitOfBooking } from '../../../../services/api';
import { submitQuickCreate } from './quickCreateSubmit';
import { buildAddServiceSlot } from './addServiceSlot';

const guard = (fn) => fn(null);
const form = { bookingDate: '2026-11-24', bookingTime: '10:00', serviceId: 'svc', customerName: 'TEST 3a', customerPhone: '+9771', mode: 'individual' };
beforeEach(() => { vi.clearAllMocks(); });

describe('"+ Service" visit link (ZNLY-402)', () => {
  it('joins the source visit: createBooking gets the visitId', async () => {
    joinVisitOfBooking.mockResolvedValue({ data: 'v1', error: null });
    await submitQuickCreate({ formData: form, branchId: 'br', guard, joinVisitOfBookingId: 'src' });
    expect(joinVisitOfBooking).toHaveBeenCalledWith({ sourceBookingId: 'src', branchId: 'br' });
    expect(createBooking.mock.calls[0][0].visitId).toBe('v1');
  });
  it('OFF org (no visit returned): no visitId is sent', async () => {
    joinVisitOfBooking.mockResolvedValue({ data: null, error: null });
    await submitQuickCreate({ formData: form, branchId: 'br', guard, joinVisitOfBookingId: 'src' });
    expect(createBooking.mock.calls[0][0].visitId).toBeUndefined();
  });
  it('a normal new booking (no source) never touches visits', async () => {
    await submitQuickCreate({ formData: form, branchId: 'br', guard });
    expect(joinVisitOfBooking).not.toHaveBeenCalled();
    expect(createBooking.mock.calls[0][0].visitId).toBeUndefined();
  });
  it('a failed join stops: nothing is created unlinked', async () => {
    joinVisitOfBooking.mockResolvedValue({ data: null, error: { message: 'x' } });
    const r = await submitQuickCreate({ formData: form, branchId: 'br', guard, joinVisitOfBookingId: 'src' });
    expect(r.error).toBeTruthy();
    expect(createBooking).not.toHaveBeenCalled();
  });
  it('only "+ Service" carries the join id; Rebook does not', () => {
    const booking = { bookingId: 'src', date: '2026-11-24', endTime: '11:00', customerId: 'c' };
    expect(buildAddServiceSlot({ booking, mode: 'add-service' }).joinVisitOfBookingId).toBe('src');
    expect(buildAddServiceSlot({ booking, mode: 'rebook' }).joinVisitOfBookingId).toBeUndefined();
  });
});

describe('several services: override parity (ZNLY-402 3b)', () => {
  const multi = (extra = {}) => ({ ...form, multiServices: [{ id: 'a', startTime: '10:00' }, { id: 'b', startTime: '10:45', ...extra }] });
  // the real guard: run, and if the refusal is overridable ask for a reason and run again with it
  const askingGuard = (reason) => async (run) => { const first = await run(undefined); if (!first?.error?.overridable) return first; return { ...(await run(reason)), overrideReason: reason }; };

  it('no row needs an override: one create, no reason', async () => {
    await submitQuickCreate({ formData: multi(), branchId: 'br', guard });
    expect(createBookingGroup).toHaveBeenCalledTimes(1);
    expect(createBookingGroup.mock.calls[0][0].services.every((s) => s.overrideReason === undefined)).toBe(true);
  });
  it('a row needs an override: nothing is created until the reason is given, then only that row carries it', async () => {
    await submitQuickCreate({ formData: multi({ overrideNeeded: true, overrideNote: "Rojina K's shift ends at 20:00" }), branchId: 'br', guard: askingGuard('regular client') });
    expect(createBookingGroup).toHaveBeenCalledTimes(1);
    const rows = createBookingGroup.mock.calls[0][0].services;
    expect(rows[0].overrideReason).toBeUndefined();
    expect(rows[1].overrideReason).toBe('regular client');
  });
  it('declining the reason creates nothing', async () => {
    const declining = async (run) => { const first = await run(undefined); return { ...first, error: { ...first.error, cancelled: true } }; };
    const r = await submitQuickCreate({ formData: multi({ overrideNeeded: true }), branchId: 'br', guard: declining });
    expect(createBookingGroup).not.toHaveBeenCalled();
    expect(r.error).toBeTruthy();
  });
});

import { refusedRow } from './quickCreateSubmit';
describe('refusedRow (Edit refusal -> the service card that failed)', () => {
  it('picks the block row with a reason; ignores change / keep rows', () => {
    const rows = [{ booking_id: 'a', verdict: 'keep', reason: 'Already started' }, { booking_id: 'b', verdict: 'change' }, { booking_id: 'c', verdict: 'block', reason: 'Rojina K is busy 11:30–12:00. Pick another staff.' }];
    expect(refusedRow(rows).booking_id).toBe('c');
  });
  it('falls back to warn, then to any non-change row with a reason; none -> null', () => {
    expect(refusedRow([{ booking_id: 'a', verdict: 'warn', reason: 'shift ends 8pm' }]).booking_id).toBe('a');
    expect(refusedRow([{ booking_id: 'a', verdict: 'change' }])).toBeNull();
    expect(refusedRow(undefined)).toBeNull();
  });
});
