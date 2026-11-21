import { describe, it, expect, vi } from 'vitest';
import { confirmPendingBooking } from './confirmBooking';

describe('staff Confirm on a Pending booking (ZNLY-266)', () => {
  it('a refusal is shown as a plain toast and reported as not confirmed', async () => {
    const notify = vi.fn();
    const update = vi.fn().mockResolvedValue({ data: null, error: { code: 'P0001', message: 'That room is fully booked at this time. Choose another time or room.' } });
    expect(await confirmPendingBooking('b1', { update, notify })).toBe(false);
    expect(update).toHaveBeenCalledWith({ bookingId: 'b1', newStatus: 'Confirmed' });
    expect(notify).toHaveBeenCalledWith('That room is fully booked at this time. Choose another time or room.', 'error');
  });
  it('an error with no text still says something', async () => {
    const notify = vi.fn();
    await confirmPendingBooking('b1', { update: async () => ({ error: {} }), notify });
    expect(notify).toHaveBeenCalledWith("Couldn't confirm this booking. Please try again.", 'error');
  });
  it('success: no toast, true', async () => {
    const notify = vi.fn();
    expect(await confirmPendingBooking('b1', { update: async () => ({ data: { success: true }, error: null }), notify })).toBe(true);
    expect(notify).not.toHaveBeenCalled();
  });
});
