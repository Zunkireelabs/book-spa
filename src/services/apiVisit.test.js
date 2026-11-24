import { describe, it, expect, vi, beforeEach } from 'vitest';

// ZNLY-402: fetchRelatedUnpaidBookings / fetchGroupBookings are keyed on visit_id only (no booking_group_id, no name + date fallback).
const calls = [];
let rows = [];
vi.mock('../lib/supabase', () => {
  const chain = (log) => {
    const q = new Proxy({}, {
      get: (_, m) => {
        if (m === 'then') return (res) => res({ data: rows, error: null });
        return (...args) => { log.push([m, ...args]); return q; };
      },
    });
    return q;
  };
  return { supabase: { from: (t) => { const log = [['from', t]]; calls.push(log); return chain(log); } }, default: {} };
});

import { fetchRelatedUnpaidBookings, fetchGroupBookings } from './api';

beforeEach(() => { calls.length = 0; rows = []; });
const has = (log, m, ...a) => log.some((c) => c[0] === m && a.every((x, i) => c[i + 1] === x));

describe('same-visit reads (ZNLY-402)', () => {
  it('a booking with no visit_id has no related bookings and sends no query (no fallback guess)', async () => {
    expect(await fetchRelatedUnpaidBookings({ excludeBookingId: 'a', visitId: null, customerId: 'c' })).toEqual({ data: [], error: null });
    expect(await fetchGroupBookings({ visitId: undefined, excludeBookingId: 'a' })).toEqual({ data: [], error: null });
    expect(calls).toHaveLength(0);
  });
  it('related: same visit_id, same customer, not cancelled / no-show, not itself', async () => {
    rows = [{ id: 'b', payments: [], payment_refunds: [], final_amount: 100 }];
    const r = await fetchRelatedUnpaidBookings({ excludeBookingId: 'a', visitId: 'v1', customerId: 'c1' });
    const log = calls[0];
    expect(has(log, 'eq', 'visit_id', 'v1')).toBe(true);
    expect(has(log, 'eq', 'customer_id', 'c1')).toBe(true);
    expect(has(log, 'neq', 'id', 'a')).toBe(true);
    expect(has(log, 'not', 'status', 'in', '("Cancelled","No Show")')).toBe(true);
    expect(log.some((c) => c[0] === 'eq' && (c[1] === 'booking_group_id' || c[1] === 'customer_name' || c[1] === 'date'))).toBe(false);
    expect(r.data.map((x) => x.id)).toEqual(['b']);
  });
  it('display siblings: same visit_id and customer, any payment status', async () => {
    rows = [{ id: 'b', payment_status: 'paid' }];
    const r = await fetchGroupBookings({ visitId: 'v1', excludeBookingId: 'a', customerId: 'c1' });
    expect(has(calls[0], 'eq', 'visit_id', 'v1')).toBe(true);
    expect(has(calls[0], 'eq', 'customer_id', 'c1')).toBe(true);
    expect(r.data).toHaveLength(1);
  });
});
