import { describe, it, expect } from 'vitest';
import { formatClockTime, formatHourLabel, formatClockIso, formatClockRange } from './clockTime';

describe('clock time', () => {
  it.each([['00:00', '12:00am', '00:00'], ['12:00', '12:00pm', '12:00'], ['23:59', '11:59pm', '23:59'], ['09:05:00', '9:05am', '09:05']])('%s', (i, h12, h24) => {
    expect(formatClockTime(i, false)).toBe(h12);
    expect(formatClockTime(i, true)).toBe(h24);
  });
  it('24:00 is midnight: 12:00am in 12h, unchanged in 24h', () => {
    expect(formatClockTime('24:00', false)).toBe('12:00am');
    expect(formatClockTime('24:00', true)).toBe('24:00');
    expect(formatClockRange('22:00', '24:00', false)).toBe('10:00pm–12:00am');
  });
  it('empty stays empty', () => { expect(formatClockTime('', true)).toBe(''); expect(formatClockIso(null, false)).toBe(''); expect(formatClockIso('nope', false)).toBe(''); });
  it('hour labels', () => {
    expect([0, 12, 13].map((h) => formatHourLabel(h, false))).toEqual(['12am', '12pm', '1pm']);
    expect([0, 12, 13].map((h) => formatHourLabel(h, true))).toEqual(['00:00', '12:00', '13:00']);
  });
  it('ISO is read in Nepal time (UTC+5:45), not the browser zone', () => {
    expect(formatClockIso('2026-11-25T18:15:00Z', true)).toBe('00:00'); // 18:15 UTC = 00:00 next day in Nepal
    expect(formatClockIso('2026-11-25T18:15:00Z', false)).toBe('12:00am');
    expect(formatClockIso('2026-11-25T06:14:00Z', false)).toBe('11:59am');
  });
});

describe('formatClockRange', () => {
  it('24h is never compacted', () => {
    expect(formatClockRange('14:30', '16:30', true)).toBe('14:30–16:30');
    expect(formatClockRange('15:00', '20:00', true)).toBe('15:00–20:00');
  });
  it('12h shows am/pm once when shared', () => {
    expect(formatClockRange('14:00', '17:45', false)).toBe('2:00–5:45pm');
    expect(formatClockRange('11:30', '12:15', false)).toBe('11:30am–12:15pm');
  });
});
