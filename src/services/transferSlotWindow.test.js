import { describe, it, expect } from 'vitest';
import { getTransferWindowPhase, isWithinTransferDaySlice } from './transferSlotWindow';

describe('getTransferWindowPhase', () => {
  const start = { date: '2026-09-09', time: '16:45' };
  const end = { date: '2026-09-09', time: '18:50' };

  it('returns "before" for a day before start.date', () => {
    expect(getTransferWindowPhase('2026-09-08', start, end)).toBe('before');
  });

  it('returns "during" for the start day itself', () => {
    expect(getTransferWindowPhase('2026-09-09', start, end)).toBe('during');
  });

  it('returns "after" for a day after end.date — the regression case: an already-returned visitor must never be blocked on a later day', () => {
    expect(getTransferWindowPhase('2026-09-10', start, end)).toBe('after');
  });

  it('treats a missing start as "always started" — never "before"', () => {
    expect(getTransferWindowPhase('2026-09-01', null, end)).not.toBe('before');
  });

  it('treats a multi-day window as "during" on days strictly between start and end', () => {
    const multiEnd = { date: '2026-09-11', time: '10:00' };
    expect(getTransferWindowPhase('2026-09-10', start, multiEnd)).toBe('during');
  });
});

describe('isWithinTransferDaySlice', () => {
  const start = { date: '2026-09-09', time: '16:45' };
  const end = { date: '2026-09-09', time: '18:50' };

  it('returns true for a slot inside [start.time, end.time) on the same day', () => {
    expect(isWithinTransferDaySlice('2026-09-09', 17, 0, start, end)).toBe(true);
  });

  it('returns false for a slot BEFORE the transfer starts, same day', () => {
    expect(isWithinTransferDaySlice('2026-09-09', 15, 0, start, end)).toBe(false);
  });

  it('returns false for a slot AFTER the transfer ends, same day', () => {
    expect(isWithinTransferDaySlice('2026-09-09', 19, 0, start, end)).toBe(false);
  });

  it('returns true exactly at start.time (inclusive lower bound)', () => {
    expect(isWithinTransferDaySlice('2026-09-09', 16, 45, start, end)).toBe(true);
  });

  it('returns false exactly at end.time (exclusive upper bound)', () => {
    expect(isWithinTransferDaySlice('2026-09-09', 18, 50, start, end)).toBe(false);
  });

  it('treats a multi-day window as all-day-inside on days strictly between start and end', () => {
    const multiStart = { date: '2026-09-09', time: '16:45' };
    const multiEnd = { date: '2026-09-11', time: '10:00' };
    expect(isWithinTransferDaySlice('2026-09-10', 3, 0, multiStart, multiEnd)).toBe(true);
  });

  it('treats a missing start as "from 00:00" on end.date', () => {
    expect(isWithinTransferDaySlice('2026-09-09', 0, 0, null, end)).toBe(true);
  });
});
