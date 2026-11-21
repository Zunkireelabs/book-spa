import { describe, it, expect, vi, beforeEach } from 'vitest';

// ZNLY-327 service rules, against a table-driven fake Supabase client (api.js builds a live client at import time, so it is mocked).
const state = { tables: {}, updates: [], rpcs: [] };
const chain = (table) => {
  const rows = () => state.tables[table] ?? [];
  const one = () => (Array.isArray(rows()) ? rows()[0] ?? null : rows());
  const c = new Proxy({}, {
    get: (_, prop) => {
      if (prop === 'then') return (res) => res({ data: rows(), error: null });
      if (prop === 'single' || prop === 'maybeSingle') return async () => ({ data: one(), error: one() ? null : { code: 'PGRST116', message: 'none' } });
      if (prop === 'update') return (payload) => { state.updates.push({ table, payload }); return c; };
      return () => c;
    },
  });
  return c;
};
vi.mock('lib/supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table) => chain(table),
    rpc: (...a) => { state.rpcs.push(a); return Promise.resolve({ data: null, error: null }); },
  },
  supabaseCustomer: {},
  supabasePlatform: {},
}));

const { recordPayment, linkWalkInClient } = await import('./api');
const staff = { id: 'u1', role: 'manager', branch_id: 'b1', org_id: 'o1', full_name: 'M' };
const booking = (over = {}) => ({ id: 'bk1', branch_id: 'b1', status: 'Confirmed', payment_status: 'unpaid', final_amount: 1500, is_locked: false, due_holder_name: null, is_walk_in: true, customer_id: null, ...over });
beforeEach(() => { state.tables = { users: [staff], bookings: [booking()], payments: [], customers: [], branches: [{ org_id: 'o1' }] }; state.updates = []; state.rpcs = []; });

describe('recordPayment: a walk-in with no client belongs to nobody', () => {
  it.each(['Membership', 'ReferralWallet', 'ReferralVoucher', 'VoucherWallet', 'SessionPackage'])('refuses a %s tender in plain language, before any RPC', async (mode) => {
    const { error } = await recordPayment({ bookingId: 'bk1', tenders: [{ paymentMode: mode, amount: 100, packageId: 'p', voucherId: 'v', referralId: 'r' }] });
    expect(error.code).toBe('WALK_IN_NEEDS_CLIENT');
    expect(error.message).toMatch(/Add a client/);
    expect(state.rpcs).toHaveLength(0);
  });
  it('refuses to leave a balance (pay later / partial)', async () => {
    const r = await recordPayment({ bookingId: 'bk1', tenders: [{ paymentMode: 'Cash', amount: 500 }], dueHolderName: 'Ram' });
    expect(r.error.code).toBe('WALK_IN_PAY_IN_FULL');
    expect(r.error.message).toMatch(/pay in full/);
    const none = await recordPayment({ bookingId: 'bk1', tenders: [], dueHolderName: 'Ram' });
    expect(none.error.code).toBe('WALK_IN_PAY_IN_FULL');
  });
  it('a walk-in WITH a client is not restricted (the guard steps aside)', async () => {
    state.tables.bookings = [booking({ customer_id: 'c1' })];
    const { error } = await recordPayment({ bookingId: 'bk1', tenders: [{ paymentMode: 'Membership', amount: 100 }] });
    expect(error?.code).not.toBe('WALK_IN_NEEDS_CLIENT');
  });
});

describe('linkWalkInClient', () => {
  it('links an existing customer: sets id, name, phone; keeps is_walk_in (not in the update)', async () => {
    state.tables.customers = [{ id: 'c1', full_name: 'Sita Rai', phone: '+9779841221840' }];
    state.tables.bookings = [booking()];
    const r = await linkWalkInClient({ bookingId: 'bk1', customerId: 'c1' });
    expect(r.error).toBeNull();
    const up = state.updates.find((u) => u.table === 'bookings');
    expect(up.payload).toEqual({ customer_id: 'c1', customer_name: 'Sita Rai', customer_phone: '+9779841221840' });
    expect(up.payload.is_walk_in).toBeUndefined();
  });
  it('refuses a closed day, a Cancelled / No Show booking, a non-walk-in and one that already has a client', async () => {
    for (const [over, code] of [[{ is_locked: true }, 'DAY_LOCKED'], [{ status: 'No Show' }, 'BOOKING_IMMUTABLE'], [{ status: 'Cancelled' }, 'BOOKING_IMMUTABLE'], [{ is_walk_in: false }, 'NOT_WALK_IN'], [{ customer_id: 'c9' }, 'ALREADY_HAS_CLIENT']]) {
      state.tables.bookings = [booking(over)];
      const r = await linkWalkInClient({ bookingId: 'bk1', customerId: 'c1' });
      expect(r.error.code).toBe(code);
    }
    expect(state.updates).toHaveLength(0);
  });
  it('a paid, in-progress or Completed walk-in may still get a client (it moves no money)', async () => {
    state.tables.customers = [{ id: 'c1', full_name: 'Sita', phone: '+9779841221840' }];
    for (const over of [{ status: 'In-Progress' }, { payment_status: 'paid' }, { status: 'Completed' }]) {
      state.tables.bookings = [booking(over)];
      expect((await linkWalkInClient({ bookingId: 'bk1', customerId: 'c1' })).error).toBeNull();
    }
  });
  it('a new client needs a name and a phone', async () => {
    expect((await linkWalkInClient({ bookingId: 'bk1', customerName: '', customerPhone: '9841221840' })).error.code).toBe('INVALID_INPUT');
    expect((await linkWalkInClient({ bookingId: 'bk1', customerName: 'Sita', customerPhone: '' })).error.code).toBe('INVALID_INPUT');
  });
});
