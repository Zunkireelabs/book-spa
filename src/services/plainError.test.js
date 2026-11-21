import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn(), auth: {} } }));
const { plainError } = await import('./api');

describe('plainError (ZNLY-266/268): the one place a raw database error becomes screen text', () => {
  it('keeps { code, message } but the message is plain', () => {
    const e = plainError({ code: '23P01', message: 'conflicting key value violates exclusion constraint "excl_therapist_overlap"', details: 'x' });
    expect(e.code).toBe('23P01');
    expect(e.message).toMatch(/already has a booking at that time/);
    expect(e.message).not.toMatch(/excl_|constraint/);
    expect(e.rawMessage).toMatch(/excl_therapist_overlap/); // kept for code, never shown
  });
  it('ROOM_AT_CAPACITY → the room sentence', () => {
    expect(plainError({ code: 'P0001', message: 'ROOM_AT_CAPACITY: Room is fully booked for this time range.' }).message)
      .toBe('That room is fully booked at this time. Choose another time or room.');
  });
  it('raw SQL / RPC text never reaches the message', () => {
    for (const raw of ['null value in column "x" violates not-null constraint', 'function public.foo(uuid) does not exist', 'permission denied for table users', 'duplicate key value violates unique constraint "u_idx"']) {
      const m = plainError({ message: raw }).message;
      expect(m).not.toMatch(/violates|function public|permission denied|duplicate key|constraint/i);
      expect(m.length).toBeGreaterThan(5);
    }
  });
  it('is idempotent, and survives null / strings / network errors', () => {
    const once = plainError({ message: 'Failed to fetch' });
    expect(plainError(once)).toBe(once);
    expect(plainError(null)).toBeNull();
    expect(plainError('boom_snake_case_text').message).toBeTruthy();
  });
});

// Guard: the write paths of this release must not hand a raw error back (`return { data: null, error };`).
describe('write paths return plain errors', () => {
  const src = readFileSync(fileURLToPath(new URL('./api.js', import.meta.url)), 'utf8');
  const names = ['updateBookingStatus', 'assignTherapist', 'updateTherapistTime', 'resizeSharedBookingTime', 'updateBookingDetails', 'rescheduleBooking',
    'rescheduleBookingAsNewBooking', 'createBooking', 'closePastBooking', 'closeDay', 'recordPayment', 'recordGroupPayment', 'recordTip', 'applyDiscount',
    'approveDiscount', 'rejectDiscount', 'checkoutWithProducts', 'refundProductSale', 'adminCorrectBooking', 'correctPaymentMode', 'correctPaymentAmount',
    'adminDeleteBooking', 'grantStaffAccess', 'updateStaffAccess', 'linkStaffToAccount', 'unlinkStaffAccess', 'updateOrgBookingSetting', 'updateOrgProfileSetting',
    'updateOrgPaymentMethods', 'setAttendanceSettings', 'markVisitorAttendance', 'updateBranchAdvanceBookingWindow', 'setEnforceStaffAvailability'];
  const starts = [...src.matchAll(/^(?:export )?(?:async )?function (\w+)/gm)].map((m) => [m.index, m[1]]);
  const body = (n) => { const i = starts.findIndex((s) => s[1] === n); return src.slice(starts[i][0], (starts[i + 1] || [src.length])[0]); };
  for (const n of names) {
    it(`${n} has no raw error return`, () => {
      const b = body(n);
      expect(b).not.toMatch(/return \{ data: null, error \};/);
      expect(b).not.toMatch(/message: (?:error|\w+Error)\.message \}/);
    });
  }
});
