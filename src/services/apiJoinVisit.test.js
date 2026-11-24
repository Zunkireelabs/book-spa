import { describe, it, expect, vi, beforeEach } from 'vitest';

// ZNLY-402: "+ Service" joins the source booking's visit; OFF orgs write nothing.
const log = [];
let results = [];   // one result per awaited query, in order
vi.mock('../lib/supabase', () => {
  const chain = (entry) => new Proxy({}, {
    get: (_, m) => {
      if (m === 'then') return (res) => res(results.shift() || { data: null, error: null });
      return (...args) => { entry.push([m, ...args]); return chain(entry); };
    },
  });
  return { supabase: { from: (t) => { const e = [['from', t]]; log.push(e); return chain(e); } }, default: {} };
});

import { joinVisitOfBooking } from './api';

beforeEach(() => { log.length = 0; results = []; });
const orgFlag = (on) => ({ data: { organizations: { multi_service_bookings: on } }, error: null });
let n = 0;
const branch = () => `b-join-${n++}`;   // the flag is cached per branch: a fresh branch id per test

describe('joinVisitOfBooking (ZNLY-402)', () => {
  it('OFF org: no visit, no write', async () => {
    results = [orgFlag(false)];
    expect(await joinVisitOfBooking({ sourceBookingId: 's1', branchId: branch() })).toEqual({ data: null, error: null });
    expect(log.map((e) => e[0][1])).toEqual(['branches']);
  });
  it('ON org, source already in a visit: returns it, writes nothing', async () => {
    results = [orgFlag(true), { data: { id: 's1', visit_id: 'v-existing' }, error: null }];
    expect(await joinVisitOfBooking({ sourceBookingId: 's1', branchId: branch() })).toEqual({ data: 'v-existing', error: null });
    expect(log.some((e) => e.some((c) => c[0] === 'update'))).toBe(false);
  });
  it('ON org, source has no visit: stamps a new id on the source first, returns it', async () => {
    results = [orgFlag(true), { data: { id: 's1', visit_id: null }, error: null }, { data: [{ visit_id: 'x' }], error: null }];
    const r = await joinVisitOfBooking({ sourceBookingId: 's1', branchId: branch() });
    const upd = log.flatMap((e) => e).find((c) => c[0] === 'update');
    expect(r.error).toBeNull();
    expect(r.data).toBeTruthy();
    expect(upd[1]).toEqual({ visit_id: r.data });
    expect(log.flatMap((e) => e).some((c) => c[0] === 'is' && c[1] === 'visit_id' && c[2] === null)).toBe(true);   // only stamps a still-empty visit_id
  });
  it('a failed stamp is an error (the new service is not created unlinked)', async () => {
    results = [orgFlag(true), { data: { id: 's1', visit_id: null }, error: null }, { data: null, error: { message: 'DAY_LOCKED' } }];
    const r = await joinVisitOfBooking({ sourceBookingId: 's1', branchId: branch() });
    expect(r.data).toBeNull();
    expect(r.error).toBeTruthy();
  });
});
