import { describe, it, expect, vi, beforeEach } from 'vitest';
import { announceBooking, _resetAnnounced } from './visitAnnounce';

const now = () => Promise.resolve();
beforeEach(() => _resetAnnounced());

describe('announceBooking (ZNLY-402)', () => {
  it('a booking without a visit announces immediately, as before', async () => {
    const go = vi.fn();
    await announceBooking({ id: 'a' }, vi.fn(), go, now);
    expect(go).toHaveBeenCalledTimes(1);
  });
  it('a multi-service booking announces once, after it settled', async () => {
    const go = vi.fn(); const read = vi.fn().mockResolvedValue('Pending');
    await Promise.all(['r1', 'r2', 'r3'].map((id) => announceBooking({ id, visit_id: 'v' }, read, go, now)));
    expect(go).toHaveBeenCalledTimes(1);
  });
  it('a rolled-back booking (Cancelled) is never announced', async () => {
    const go = vi.fn();
    await Promise.all(['r1', 'r2'].map((id) => announceBooking({ id, visit_id: 'v' }, vi.fn().mockResolvedValue('Cancelled'), go, now)));
    expect(go).not.toHaveBeenCalled();
  });
});
