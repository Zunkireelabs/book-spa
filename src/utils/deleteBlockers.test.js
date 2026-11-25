import { describe, it, expect } from 'vitest';
import { deleteBlockers } from './deleteBlockers';

const pay = { amount: 1500, paymentMode: 'Cash', createdAt: '2026-11-17T08:00:00Z' };
describe('deleteBlockers', () => {
  it('nothing attached: deletable', () => expect(deleteBlockers({})).toBeNull());
  it('paid booking: names the money and offers Cancel and refund', () => {
    const r = deleteBlockers({ payments: [pay], status: 'completed', paymentStatus: 'paid' });
    expect(r.title).toBe("Can't delete: NPR 1,500 was paid (Cash, 17 Nov)");
    expect(r.canCancel).toBe(true);
    expect(r.refund).toBe(1500);
  });
  it('a refund already exists: no button (the trigger would refund twice)', () => {
    const r = deleteBlockers({ payments: [pay], refunds: [{ amount: 500 }], status: 'completed', paymentStatus: 'partial' });
    expect(r.canCancel).toBe(false);
  });
  it('payments but a stale payment status: no refund promise', () => {
    expect(deleteBlockers({ payments: [pay], status: 'completed', paymentStatus: 'pending' }).canCancel).toBe(false);
  });
  it('tip only: cancel without a refund line', () => {
    const r = deleteBlockers({ tips: [{ amount: 100 }], status: 'completed', paymentStatus: 'pending' });
    expect(r.canCancel).toBe(true);
    expect(r.refund).toBe(0);
  });
  it('already cancelled: no button', () => {
    expect(deleteBlockers({ refunds: [{ amount: 1500 }], status: 'cancelled', paymentStatus: 'refunded' }).canCancel).toBe(false);
  });
});
