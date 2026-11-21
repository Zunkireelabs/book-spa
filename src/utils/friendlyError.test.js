import { describe, it, expect } from 'vitest';
import { friendlyError, GENERIC_SAVE_ERROR_COPY, isNetworkError, NETWORK_ERROR_COPY, NETWORK_CHECK_CALENDAR_COPY } from './friendlyError';

describe('friendlyError: PIN save refusals (set_user_pin, migration-416)', () => {
  it('maps not-allowed and bad-shape to plain sentences, no function name on screen', () => {
    expect(friendlyError({ message: "set_user_pin: not allowed" })).toBe("You can't set this person's PIN. Ask an admin.");
    expect(friendlyError({ message: 'set_user_pin: no such user' })).toBe("You can't set this person's PIN. Ask an admin.");
    expect(friendlyError({ message: 'PIN must be exactly 4 digits' })).toBe('PIN must be 4 digits.');
    expect(friendlyError({ message: 'A PIN can only be set with set_user_pin()' })).not.toMatch(/set_user_pin/);
  });
});

describe('friendlyError', () => {
  it('strips the SQL function prefix and capitalises', () => {
    expect(friendlyError({ message: 'reschedule_booking: slot no longer available' })).toBe('Slot no longer available');
    expect(friendlyError({ message: 'issue_voucher: voucher code NT 4326-1 is already in use' })).toBe('Voucher code NT 4326-1 is already in use');
  });

  it('maps network failures to one sentence', () => {
    expect(friendlyError(new TypeError('Failed to fetch'))).toBe(NETWORK_ERROR_COPY);
    expect(friendlyError({ message: 'NetworkError when attempting to fetch resource.' })).toBe(NETWORK_ERROR_COPY);
    expect(friendlyError({ message: 'Load failed' })).toBe(NETWORK_ERROR_COPY);
  });

  it('does not promise that nothing was changed', () => {
    expect(NETWORK_ERROR_COPY).toBe("Couldn't reach the server. Check your connection and try again.");
    expect(NETWORK_ERROR_COPY).not.toMatch(/nothing was changed/i);
  });

  it('has one single-sentence copy for non-idempotent writes', () => {
    expect(NETWORK_CHECK_CALENDAR_COPY).toBe("Couldn't reach the server. Check the calendar before trying again.");
  });

  it('does not treat other TypeErrors as network problems', () => {
    expect(friendlyError(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(GENERIC_SAVE_ERROR_COPY);
    expect(friendlyError(new TypeError('x is not a function'), 'Custom fallback')).toBe('Custom fallback');
  });

  it('isNetworkError matches by message only', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkError({ message: 'reschedule_booking: slot no longer available' })).toBe(false);
    expect(isNetworkError(new TypeError('x is not a function'))).toBe(false);
    expect(isNetworkError(null)).toBe(false);
  });

  it('leaves ordinary messages alone', () => {
    expect(friendlyError({ message: 'Only an admin may do that.' })).toBe('Only an admin may do that.');
    expect(friendlyError('Enter a valid amount: 3')).toBe('Enter a valid amount: 3');
  });

  it('falls back when there is no message', () => {
    expect(friendlyError(null)).toBe(GENERIC_SAVE_ERROR_COPY);
    expect(friendlyError({}, 'Custom fallback')).toBe('Custom fallback');
    expect(friendlyError({ message: '  ' })).toBe(GENERIC_SAVE_ERROR_COPY);
  });

  it('hides raw database text behind the generic sentence (ZNLY-268)', () => {
    const raw = [
      'update_org_profile_settings: unknown setting key calendar_show_full_day',
      'duplicate key value violates unique constraint "bookings_pkey"',
      "Could not find the table 'public.staff_transfers' in the schema cache",
      'new row violates row-level security policy for table "customers"',
      'null value in column "branch_id" of relation "rooms" violates not-null constraint',
      'permission denied for table payments',
    ];
    for (const m of raw) expect(friendlyError({ message: m })).toBe(GENERIC_SAVE_ERROR_COPY);
    expect(friendlyError({ message: raw[0] }, 'Could not load that.')).toBe('Could not load that.');
  });

  it('keeps messages that are already friendly', () => {
    expect(friendlyError({ message: 'That room is already booked at this time.' })).toBe('That room is already booked at this time.');
    expect(friendlyError({ message: 'issue_voucher: voucher code NT 4326-1 is already in use' })).toBe('Voucher code NT 4326-1 is already in use');
    expect(friendlyError({ message: 'Discount above your limit. Ask a manager.' })).toBe('Discount above your limit. Ask a manager.');
  });

  it('keeps already-friendly "already exists" messages (ZNLY-268 review)', () => {
    for (const m of ['A category with this name already exists.', 'A service with this name already exists in your organization.',
      'transfer_therapist: a scheduled transfer already exists for this staffer; cancel it first']) {
      expect(friendlyError({ message: m })).not.toBe(GENERIC_SAVE_ERROR_COPY);
    }
    expect(friendlyError({ message: 'A tier with this name already exists.' })).toBe('A tier with this name already exists.');
    expect(friendlyError({ message: 'transfer_therapist: a scheduled transfer already exists for this staffer; cancel it first' }))
      .toBe('A scheduled transfer already exists for this staffer; cancel it first');
  });

  it('maps known booking and customer failures to specific sentences', () => {
    const overlap = 'conflicting key value violates exclusion constraint "excl_therapist_overlap"';
    expect(friendlyError({ message: overlap })).toBe('This therapist already has a booking at that time. Pick another time or person.');
    expect(friendlyError({ message: 'excl_therapist_overlap' })).toMatch(/already has a booking at that time/);
    const dup = 'duplicate key value violates unique constraint "customers_org_nphone_uniq"';
    expect(friendlyError({ message: dup })).toBe('A customer with this phone number already exists.');
  });

  it('shows code-prefixed staff messages after the prefix strip', () => {
    const cases = {
      'DAY_LOCKED: This day has been closed. No further modifications allowed.': 'This day has been closed. No further modifications allowed.',
      'BOOKING_IMMUTABLE: Completed bookings cannot be modified.': 'Completed bookings cannot be modified.',
      'ROOM_AT_CAPACITY: Room is fully booked for this time range.': 'Room is fully booked for this time range.',
      'OVERPAYMENT: Payment exceeds the remaining balance.': 'Payment exceeds the remaining balance.',
      'BOOKING_PAID: This booking is already paid — cancel and refund it explicitly, or collect the difference, before rescheduling.': 'This booking is already paid — cancel and refund it explicitly, or collect the difference, before rescheduling.',
      'THERAPIST_ABSENT: Asha is marked as on_leave on this date.': 'Asha is marked as on_leave on this date.',
      'THERAPIST_CHECKED_OUT: Asha already checked out for this date.': 'Asha already checked out for this date.',
      'PUNCH_OVERLAP: This time overlaps another punch for this person.': 'This time overlaps another punch for this person.',
    };
    for (const [raw, want] of Object.entries(cases)) expect(friendlyError({ message: raw })).toBe(want);
  });

  it('still hides the raw unknown-setting-key error', () => {
    expect(friendlyError({ message: 'update_org_profile_settings: unknown setting key calendar_show_full_day' })).toBe(GENERIC_SAVE_ERROR_COPY);
  });
});
