import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../services/api', () => ({
  createBooking: vi.fn(async () => ({ data: { id: 'new', booking_number: 'BK-1' }, error: null })),
  createComboBookingItems: vi.fn(),
  joinVisitOfBooking: vi.fn(),
}));
import { createBooking, joinVisitOfBooking } from '../../../../services/api';
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
