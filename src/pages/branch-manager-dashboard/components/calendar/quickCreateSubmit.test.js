import { describe, it, expect, vi } from 'vitest';

const createBooking = vi.hoisted(() => vi.fn());
vi.mock('../../../../services/api', async (importOriginal) => ({ ...(await importOriginal()), createBooking, createComboBookingItems: vi.fn() }));
import { submitQuickCreate } from './quickCreateSubmit';

const guard = (run) => run(undefined);
const person = (n) => ({ serviceId: 's1', customerName: `Guest ${n}`, customerPhone: '+97798410000' + n, therapistIds: [] });
const group = { mode: 'group', bookingDate: '2026-11-22', bookingTime: '12:00', people: [person(1), person(2), person(3)] };

describe('submitQuickCreate group failure', () => {
  it('returns the raw error, the failing code and how many were already created (so the card can say so)', async () => {
    createBooking.mockReset();
    createBooking.mockResolvedValueOnce({ data: { id: 'b1' } }).mockResolvedValueOnce({ data: { id: 'b2' } }).mockResolvedValueOnce({ error: { code: 'ROOMS_FULL', message: 'full' } });
    const r = await submitQuickCreate({ formData: group, branchId: 'br1', guard });
    expect(r).toMatchObject({ code: 'ROOMS_FULL', raw: { code: 'ROOMS_FULL' }, partial: { created: 2, total: 3 } });
    expect(r.error).toMatch(/2 bookings already created/);
  });
  it('a lost connection on the first person keeps the raw error and reports no partial', async () => {
    createBooking.mockReset();
    createBooking.mockResolvedValueOnce({ error: new TypeError('Failed to fetch') });
    const r = await submitQuickCreate({ formData: group, branchId: 'br1', guard });
    expect(r.raw).toBeInstanceOf(TypeError);
    expect(r.partial).toBeUndefined();
  });
  it('a single booking failure also hands back the raw error (network text is otherwise lost)', async () => {
    createBooking.mockReset();
    createBooking.mockResolvedValueOnce({ error: new TypeError('Failed to fetch') });
    const r = await submitQuickCreate({ formData: { serviceId: 's1', customerName: 'Walk-in', isWalkIn: true, bookingDate: '2026-11-22', bookingTime: '12:00' }, branchId: 'br1', guard });
    expect(r.raw).toBeInstanceOf(TypeError);
  });
});
