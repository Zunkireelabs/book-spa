import { describe, it, expect } from 'vitest';
import { fmtDuration, fmtClock, upcomingGaps, freeTime, axisBounds, bookingSplit, splitLine } from './dashboardFloor';

describe('formatting', () => {
  it('durations', () => {
    expect(fmtDuration(45)).toBe('45m');
    expect(fmtDuration(120)).toBe('2h');
    expect(fmtDuration(390)).toBe('6h 30m');
  });
  it('clock', () => {
    expect(fmtClock(930)).toBe('3:30 pm');
    expect(fmtClock(600)).toBe('10 am');
    expect(fmtClock(720)).toBe('12 pm');
  });
});

describe('gaps and free time', () => {
  const gaps = [{ from_min: 600, to_min: 720 }, { from_min: 900, to_min: 1020 }];
  it('clips to now and drops gaps under an hour', () => {
    expect(upcomingGaps(gaps, 690)).toEqual([{ from_min: 900, to_min: 1020 }]);
    expect(upcomingGaps(gaps, null)).toHaveLength(2);
  });
  it('sums free time and finds the biggest gap', () => {
    const f = freeTime([{ gaps }, { gaps: [{ from_min: 840, to_min: 1020 }] }], 660);
    expect(f.total).toBe(60 + 120 + 180);
    expect(f.biggest).toEqual({ from_min: 840, to_min: 1020, minutes: 180 });
  });
  it('is empty without gaps', () => {
    expect(freeTime([], 600)).toEqual({ total: 0, people: 0, biggest: null });
  });
});

describe('axisBounds', () => {
  it('covers branch hours and shifts in whole hours', () => {
    expect(axisBounds([{ shift_from_min: 570, shift_to_min: 1110 }], 600, 1200)).toEqual({ start: 540, end: 1200 });
  });
  it('falls back without data', () => {
    expect(axisBounds([])).toEqual({ start: 540, end: 1260 });
  });
});

describe('bookingSplit', () => {
  it('groups statuses', () => {
    expect(bookingSplit({ completed: 8, in_progress: 3, confirmed: 2, pending: 1 })).toEqual({ done: 8, now: 3, late: 0, toCome: 3 });
    expect(bookingSplit(null)).toEqual({ done: 0, now: 0, late: 0, toCome: 0 });
  });
  it('splits late out of to come', () => {
    const s = bookingSplit({ completed: 1, in_progress: 0, confirmed: 4, pending: 1, late: 3 });
    expect(s).toEqual({ done: 1, now: 0, late: 3, toCome: 2 });
    expect(splitLine(s)).toBe('1 done · 3 late · 2 to come');
  });
});
