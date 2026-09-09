import { describe, it, expect } from 'vitest';
import { isSlotInsideTransferWindow } from './transferSlotWindow';

describe('isSlotInsideTransferWindow', () => {
  const start = { date: '2026-09-09', time: '16:45' };
  const end = { date: '2026-09-09', time: '18:50' };

  it('returns true for on same-day start/end, if slot is inside [start.time, end.time)', () => {
    expect(isSlotInsideTransferWindow('2026-09-09', 17, 0, start, end)).toBe(true);
  });

  it('returns false for a slot BEFORE the transfer starts, same day (the reported bug)', () => {
    expect(isSlotInsideTransferWindow('2026-09-09', 15, 0, start, end)).toBe(false);
  });

  it('returns false for a slot AFTER the transfer ends, same day', () => {
    expect(isSlotInsideTransferWindow('2026-09-09', 19, 0, start, end)).toBe(false);
  });

  it('returns true exactly at start.time (inclusive lower bound)', () => {
    expect(isSlotInsideTransferWindow('2026-09-09', 16, 45, start, end)).toBe(true);
  });

  it('returns false exactly at end.time (exclusive upper bound)', () => {
    expect(isSlotInsideTransferWindow('2026-09-09', 18, 50, start, end)).toBe(false);
  });

  it('returns false for a day before start.date', () => {
    expect(isSlotInsideTransferWindow('2026-09-08', 12, 0, start, end)).toBe(false);
  });

  it('returns false for a day after end.date', () => {
    expect(isSlotInsideTransferWindow('2026-09-10', 12, 0, start, end)).toBe(false);
  });

  it('treats a multi-day window as all-day-inside on days strictly between start and end', () => {
    const multiStart = { date: '2026-09-09', time: '16:45' };
    const multiEnd = { date: '2026-09-11', time: '10:00' };
    expect(isSlotInsideTransferWindow('2026-09-10', 3, 0, multiStart, multiEnd)).toBe(true);
  });

  it('returns true (conservative) when end is falsy, regardless of day/time', () => {
    expect(isSlotInsideTransferWindow('2026-09-09', 12, 0, start, null)).toBe(true);
  });

  it('treats a missing start as "always started" (from time 00:00 on end.date)', () => {
    expect(isSlotInsideTransferWindow('2026-09-09', 0, 0, null, end)).toBe(true);
  });
});
