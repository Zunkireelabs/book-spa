import { describe, it, expect } from 'vitest';
import { validateExtension } from './transferPreview';

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
