import { describe, it, expect, vi } from 'vitest';

// api.js imports lib/supabase.js, which creates a live Supabase client at
// module-import time — not viable under vitest/Node. Mock it so importing
// api.js here only pulls in the service functions, same pattern as
// computeTherapistMetrics.test.js.
const rpcMock = vi.fn();

vi.mock('lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: 'u1' } } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { id: 'u1', role: 'admin', branch_id: 'b1', org_id: 'org1' }, error: null }),
        }),
      }),
    }),
    rpc: (...args) => rpcMock(...args),
  },
  supabaseCustomer: {},
  supabasePlatform: {},
}));

const { topUpMembership, adjustMembership } = await import('./api');

// Regression coverage for the migration-236 day-lock gap: record_membership_
// transaction_backdated now rejects a p_backdated_at that falls on an
// already-closed day (daily_reports row exists for branch+date), same
// DAY_LOCKED posture every other mutation path already enforces. This is the
// service-layer half — confirms topUpMembership/adjustMembership propagate
// that Postgres error unchanged rather than swallowing or rewording it,
// mirroring the pure error-propagation style the rest of this suite uses for
// api.js (no live DB involved).
describe('backdated membership transaction propagates the closed-day rejection', () => {
  const CLOSED_DAY_ERROR = {
    message: 'record_membership_transaction_backdated: that day has already been closed for this branch',
  };

  it('topUpMembership returns the RPC error unchanged when backdatedAt targets a closed day', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: CLOSED_DAY_ERROR });

    const { data, error } = await topUpMembership({
      membershipId: 'm1',
      amount: 5000,
      paymentMode: 'Cash',
      branchId: 'b1',
      backdatedAt: '2026-09-01',
    });

    expect(data).toBeNull();
    expect(error).toBe(CLOSED_DAY_ERROR);
    expect(rpcMock).toHaveBeenCalledWith(
      'record_membership_transaction_backdated',
      expect.objectContaining({ p_kind: 'deposit', p_backdated_at: '2026-09-01' })
    );
  });

  it('adjustMembership returns the RPC error unchanged when backdatedAt targets a closed day', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: CLOSED_DAY_ERROR });

    const { data, error } = await adjustMembership({
      membershipId: 'm1',
      amount: -500,
      notes: 'correction',
      branchId: 'b1',
      backdatedAt: '2026-09-01',
    });

    expect(data).toBeNull();
    expect(error).toBe(CLOSED_DAY_ERROR);
    expect(rpcMock).toHaveBeenCalledWith(
      'record_membership_transaction_backdated',
      expect.objectContaining({ p_kind: 'adjustment', p_backdated_at: '2026-09-01' })
    );
  });

  it('topUpMembership still calls the non-backdated RPC when backdatedAt is omitted', async () => {
    rpcMock.mockResolvedValueOnce({ data: 'txn-id', error: null });

    const { data, error } = await topUpMembership({
      membershipId: 'm1',
      amount: 5000,
      paymentMode: 'Cash',
      branchId: 'b1',
    });

    expect(error).toBeNull();
    expect(data).toEqual({ transactionId: 'txn-id' });
    expect(rpcMock).toHaveBeenCalledWith('record_membership_transaction', expect.any(Object));
  });
});
