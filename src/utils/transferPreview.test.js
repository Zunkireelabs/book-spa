import { describe, it, expect } from 'vitest';
import { validateExtension, computeRevertDate, toYmd, toHm, transferSuccessMessage, hasOpenTransfer, transferCreateError } from './transferPreview';

const now = new Date('2026-10-15T10:00:00+05:45');
const revert = '2026-10-17T14:00:00+05:45';

describe('validateExtension', () => {
  it('is silent until both a unit and an amount are given', () => {
    expect(validateExtension({ value: '', unit: 'day', currentRevertAt: revert, now })).toBeNull();
    expect(validateExtension({ value: '2', unit: '', currentRevertAt: revert, now })).toBeNull();
  });

  it('accepts a whole number >= 1 inside the one-year ceiling', () => {
    expect(validateExtension({ value: '1', unit: 'day', currentRevertAt: revert, now })).toBeNull();
    expect(validateExtension({ value: '6', unit: 'month', currentRevertAt: revert, now })).toBeNull();
    expect(validateExtension({ value: '90', unit: 'minute', currentRevertAt: revert, now })).toBeNull();
  });

  it('rejects fractions, zero and negatives with plain copy', () => {
    expect(validateExtension({ value: '1.5', unit: 'day', currentRevertAt: revert, now })).toBe('Enter a whole number.');
    expect(validateExtension({ value: '0', unit: 'day', currentRevertAt: revert, now })).toBe('Enter at least 1.');
    expect(validateExtension({ value: '-3', unit: 'day', currentRevertAt: revert, now })).toBe('Enter at least 1.');
  });

  it('rejects an extension that lands more than 365 days ahead', () => {
    expect(validateExtension({ value: '99999999', unit: 'day', currentRevertAt: revert, now })).toMatch(/more than a year away/);
    expect(validateExtension({ value: '13', unit: 'month', currentRevertAt: revert, now })).toMatch(/more than a year away/);
    expect(validateExtension({ value: '53', unit: 'week', currentRevertAt: revert, now })).toMatch(/more than a year away/);
  });

  it('allows the boundary and refuses one unit past it', () => {
    expect(validateExtension({ value: '362', unit: 'day', currentRevertAt: revert, now })).toBeNull();
    expect(validateExtension({ value: '363', unit: 'day', currentRevertAt: revert, now })).toMatch(/more than a year away/);
  });
});

// Expected values are the output of the database rule in supabase/migration-359
// (transfer_therapist): (date + time)::timestamp + (n || ' ' || unit || 's')::interval,
// read back as Nepal wall-clock. Generated on the local DB; the JS mirror must match.
const DB_CASES = [
  ['2026-01-31', '10:00', 1, 'month', '2026-02-28 10:00'],
  ['2026-01-30', '10:00', 1, 'month', '2026-02-28 10:00'],
  ['2027-01-31', '10:00', 1, 'month', '2027-02-28 10:00'],
  ['2028-01-31', '10:00', 1, 'month', '2028-02-29 10:00'],
  ['2028-02-29', '09:30', 12, 'month', '2029-02-28 09:30'],
  ['2026-12-31', '23:00', 2, 'month', '2027-02-28 23:00'],
  ['2026-10-31', '10:00', 4, 'month', '2027-02-28 10:00'],
  ['2026-11-17', '22:30', 3, 'hour', '2026-11-18 01:30'],
  ['2026-12-31', '23:45', 30, 'minute', '2027-01-01 00:15'],
  ['2026-11-17', '10:15', 90, 'minute', '2026-11-17 11:45'],
  ['2026-02-27', '18:00', 2, 'day', '2026-03-01 18:00'],
  ['2028-02-28', '18:00', 2, 'day', '2028-03-01 18:00'],
  ['2026-12-30', '12:00', 2, 'week', '2027-01-13 12:00'],
];

describe('computeRevertDate matches the DB revert rule', () => {
  it.each(DB_CASES)('%s %s + %s %s', (d, t, v, u, expected) => {
    const r = computeRevertDate(d, t, v, u);
    expect(`${toYmd(r)} ${toHm(r)}`).toBe(expected);
  });
  it('returns null for incomplete input', () => {
    expect(computeRevertDate('', '10:00', 1, 'day')).toBeNull();
    expect(computeRevertDate('2026-01-01', '10:00', 0, 'day')).toBeNull();
  });
});

describe('transferSuccessMessage', () => {
  const base = { name: 'Pema Lama', startDate: '2026-11-30', startTime: '10:00', durationValue: 3, durationUnit: 'month' };
  it('scheduled timed transfer names the start day and return time', () => {
    expect(transferSuccessMessage({ ...base, applied: false, today: '2026-11-17' }))
      .toBe('Transfer scheduled for Pema Lama on Mon 30 Nov, returns around Sun 28 Feb, 10:00am.');
  });
  it('falls back to the start date when applied is unknown', () => {
    expect(transferSuccessMessage({ ...base, today: '2026-11-17' })).toMatch(/^Transfer scheduled for/);
    expect(transferSuccessMessage({ ...base, startDate: '2026-11-17', today: '2026-11-17' })).toMatch(/^Pema Lama transferred, returns around/);
  });
  it('applied immediately and permanent wording', () => {
    expect(transferSuccessMessage({ ...base, applied: true, permanent: true })).toBe('Pema Lama transferred permanently.');
    expect(transferSuccessMessage({ ...base, applied: false, permanent: true, today: '2026-11-17' }))
      .toBe('Transfer scheduled for Pema Lama on Mon 30 Nov.');
  });
});

describe('open-transfer guard', () => {
  it('blocks a scheduled or active transfer, not a finished one', () => {
    expect(hasOpenTransfer({ applied: false, reverted: false })).toBe(true);
    expect(hasOpenTransfer({ applied: true, reverted: false, revertAt: '2027-02-28T04:15:00Z' })).toBe(true);
    expect(hasOpenTransfer({ applied: true, reverted: false, revertAt: null })).toBe(false); // permanent, done
    expect(hasOpenTransfer({ applied: true, reverted: true, revertAt: 'x' })).toBe(false);
    expect(hasOpenTransfer(null)).toBe(false);
  });
  it('turns the RPC guard text into plain words', () => {
    const raw = { message: 'transfer_therapist: a transfer is already pending or in progress for this staffer; cancel or wait for it first' };
    expect(transferCreateError(raw, 'Pema Lama')).toBe('Pema Lama already has a transfer pending or in progress. Cancel it first.');
    expect(transferCreateError({ message: 'boom' }, 'X')).toBe('Boom');
  });
});
