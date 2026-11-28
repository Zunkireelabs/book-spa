import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { DISCOUNT_LIMITS } from './discountLimits';

// ZNLY-402 piece 5: the api.js wrappers over migration 430 (visit_* functions).
const rpcCalls = [];
let rpcReply = { data: { ok: true, rows: [], totals: {} }, error: null };
vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (fn, args) => { rpcCalls.push([fn, args]); return Promise.resolve(rpcReply); },
    from: () => { throw new Error('single-edit path must not run in these cases'); },
  },
  default: {},
}));

import { visitCreate, visitUpdate, visitSetStatus, visitRemoveService, visitReschedule, visitApplyDiscount, visitSetStaff } from './api';

beforeEach(() => { rpcCalls.length = 0; rpcReply = { data: { ok: true, rows: [{ booking_id: 'a', verdict: 'change' }], totals: { change: 1 } }, error: null }; });

describe('visit_* wrappers: one function each, contract parameter names, dryRun defaults to false', () => {
  it('sends the contract names', async () => {
    await visitSetStatus({ visitKey: 'v', status: 'Cancelled', reason: 'r' });
    await visitRemoveService({ bookingId: 'b', reason: 'r', dryRun: true });
    await visitReschedule({ visitKey: 'v', date: '2027-01-02', startTime: '10:00' });
    await visitApplyDiscount({ visitKey: 'v', lines: [{ booking_id: 'a', type: '%', value: 5 }], reason: 'loyal' });
    await visitSetStaff({ visitKey: 'v', lines: [{ booking_id: 'a', therapist_id: 't', room_id: null }], notes: 'n' });
    await visitUpdate({ visitKey: 'v', changes: { services: [] } });
    expect(rpcCalls.map((c) => c[0])).toEqual(['visit_set_status', 'visit_remove_service', 'visit_reschedule', 'visit_apply_discount', 'visit_set_staff', 'visit_update']);
    expect(rpcCalls[0][1]).toEqual({ p_visit_key: 'v', p_status: 'Cancelled', p_reason: 'r', p_dry_run: false });
    expect(rpcCalls[1][1]).toEqual({ p_booking_id: 'b', p_reason: 'r', p_dry_run: true });
    expect(rpcCalls[2][1]).toMatchObject({ p_visit_key: 'v', p_date: '2027-01-02', p_start_time: '10:00', p_dry_run: false, p_override_reason: null });
    expect(rpcCalls[3][1]).toMatchObject({ p_requested_to: null, p_reason: 'loyal', p_dry_run: false });
    expect(rpcCalls[4][1]).toMatchObject({ p_notes: 'n', p_dry_run: false });
  });
  it('visitCreate sends the phone in E.164 and trims blank override reasons', async () => {
    await visitCreate({ branchId: 'br', customer: { name: 'A', phone: '9800000001' }, services: [{ service_id: 's', date: '2027-01-02', start_time: '10:00', override_reason: '  ' }], overrideReason: ' ' });
    const a = rpcCalls[0][1];
    expect(a.p_customer.phone).toBe('+9779800000001');
    expect(a.p_override_reason).toBeNull();
    expect(a.p_services[0].override_reason).toBeUndefined();
    expect(a.p_dry_run).toBe(false);
  });
  it('a success passes the per-row verdicts through', async () => {
    const r = await visitSetStatus({ visitKey: 'v', status: 'Cancelled', reason: 'r', dryRun: true });
    expect(r.error).toBeNull();
    expect(r.data.rows[0].verdict).toBe('change');
  });
});

describe('refusals are plain, keep the rows, and say when an override is possible', () => {
  it('maps { ok:false } to error { code, message, rows } and keeps data for the preview', async () => {
    rpcReply = { data: { ok: false, error: { code: 'DAY_LOCKED', message: 'This day has been closed.' }, rows: [{ booking_id: 'a', verdict: 'block', reason: 'closed' }] }, error: null };
    const r = await visitReschedule({ visitKey: 'v', date: '2027-01-02', startTime: '10:00' });
    expect(r.error).toMatchObject({ code: 'DAY_LOCKED', message: 'This day has been closed.', overridable: false, plain: true });
    expect(r.error.rows[0].verdict).toBe('block');
    expect(r.data.rows).toHaveLength(1);
  });
  it('NEEDS_OVERRIDE is flagged overridable', async () => {
    rpcReply = { data: { ok: false, error: { code: 'NEEDS_OVERRIDE', message: 'X is off until 09:00' }, rows: [] }, error: null };
    expect((await visitCreate({ branchId: 'b', customer: {}, services: [] })).error.overridable).toBe(true);
  });
  it('a transport error never shows SQL text', async () => {
    rpcReply = { data: null, error: { message: 'relation "bookings" does not exist', code: '42P01' } };
    const r = await visitSetStatus({ visitKey: 'v', status: 'Cancelled', reason: 'r' });
    expect(r.error.message).not.toMatch(/relation|bookings/i);
    expect(r.error.plain).toBe(true);
  });
});

describe('combo / multi-staff: routed to today\'s single edit, never a dead end', () => {
  it('a dry run answers ok + routed and sends no other call', async () => {
    rpcReply = { data: { ok: false, error: { code: 'COMBO_USE_SINGLE_EDIT', message: 'combo' }, rows: [] }, error: null };
    const u = await visitUpdate({ visitKey: 'v', changes: { services: [{ booking_id: 'a', start_time: '10:00' }] }, dryRun: true });
    const s = await visitSetStaff({ visitKey: 'v', lines: [{ booking_id: 'a', therapist_id: 't' }], dryRun: true });
    expect(u.error).toBeNull(); expect(u.data.routed).toBe('single');
    expect(s.error).toBeNull(); expect(s.data.routed).toBe('single');
    expect(rpcCalls).toHaveLength(2);
  });
});

describe('discount limits: SQL and JS cannot drift', () => {
  const sql = readFileSync(new URL('../../supabase/migration-430-visit-functions.sql', import.meta.url), 'utf8');
  const fn = (name) => {
    const body = sql.slice(sql.indexOf(`FUNCTION public.${name}`));
    const m = {};
    for (const role of ['staff', 'manager', 'admin']) m[role] = Number(new RegExp(`WHEN '${role}' THEN ([0-9.]+)`).exec(body.slice(0, 600))[1]);
    return m;
  };
  it('_visit_discount_limit equals DISCOUNT_LIMITS for every role', () => {
    const m = fn('_visit_discount_limit');
    expect(m).toEqual({ staff: DISCOUNT_LIMITS.staff, manager: DISCOUNT_LIMITS.manager, admin: DISCOUNT_LIMITS.admin });
  });
  it('_visit_discount_ceiling equals the staff request ceiling (0.50) and the manager/admin limit', () => {
    const m = fn('_visit_discount_ceiling');
    expect(m).toEqual({ staff: 0.5, manager: DISCOUNT_LIMITS.manager, admin: DISCOUNT_LIMITS.admin });
  });
});
