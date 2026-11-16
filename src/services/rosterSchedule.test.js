import { describe, it, expect } from 'vitest';
import {
  isoDayOfWeek,
  isoDayOfWeekFromDateStr,
  resolveEffectiveHours,
  getRosterShadingSegments,
} from './rosterSchedule';

// 2026-10-26 is a Monday.
const MONDAY = '2026-10-26';
const SUNDAY = '2026-11-01';

const weekly = (rows) => new Map([['t1', rows]]);
const overrides = (entries) => new Map(entries);

describe('isoDayOfWeek', () => {
  it('maps JS Sunday (0) to ISO 6', () => {
    expect(isoDayOfWeek(new Date(2026, 10, 1))).toBe(6); // 2026-11-01, Sunday
  });

  it('maps JS Monday (1) to ISO 0', () => {
    expect(isoDayOfWeek(new Date(2026, 9, 26))).toBe(0); // 2026-10-26, Monday
  });

  it('maps a date string without a UTC-parse day shift', () => {
    expect(isoDayOfWeekFromDateStr(MONDAY)).toBe(0);
    expect(isoDayOfWeekFromDateStr(SUNDAY)).toBe(6);
  });

  it('returns null for a missing/garbage date string', () => {
    expect(isoDayOfWeekFromDateStr(null)).toBeNull();
    expect(isoDayOfWeekFromDateStr('')).toBeNull();
    expect(isoDayOfWeekFromDateStr('not-a-date')).toBeNull();
  });
});

describe('resolveEffectiveHours', () => {
  it('returns null when the therapist has no roster at all — must read as fully open, not as a day off', () => {
    expect(resolveEffectiveHours({
      therapistId: 't1', date: MONDAY, weeklyByTherapist: new Map(), overridesByKey: new Map(),
    })).toBeNull();
  });

  it('picks the weekly row for the date\'s ISO day-of-week, not getDay()', () => {
    const result = resolveEffectiveHours({
      therapistId: 't1',
      date: MONDAY,
      weeklyByTherapist: weekly([
        { dayOfWeek: 0, startTime: '09:00:00', endTime: '17:00:00', isDayOff: false, breaks: [] },
        { dayOfWeek: 1, startTime: '11:00:00', endTime: '19:00:00', isDayOff: false, breaks: [] },
      ]),
      overridesByKey: new Map(),
    });
    expect(result).toMatchObject({ source: 'weekly', startTime: '09:00:00', endTime: '17:00:00' });
  });

  it('carries the weekly day\'s breaks through', () => {
    const result = resolveEffectiveHours({
      therapistId: 't1',
      date: MONDAY,
      weeklyByTherapist: weekly([
        { dayOfWeek: 0, startTime: '09:00:00', endTime: '17:00:00', isDayOff: false, breaks: [{ name: 'Lunch', startTime: '13:00:00', endTime: '14:00:00' }] },
      ]),
      overridesByKey: new Map(),
    });
    expect(result.breaks).toEqual([{ name: 'Lunch', startTime: '13:00', endTime: '14:00' }]);
  });

  it('reports a weekly day off', () => {
    const result = resolveEffectiveHours({
      therapistId: 't1',
      date: MONDAY,
      weeklyByTherapist: weekly([{ dayOfWeek: 0, startTime: null, endTime: null, isDayOff: true, breaks: [] }]),
      overridesByKey: new Map(),
    });
    expect(result).toMatchObject({ isDayOff: true, source: 'weekly' });
  });

  it('lets a per-date override win over the weekly default', () => {
    const result = resolveEffectiveHours({
      therapistId: 't1',
      date: MONDAY,
      weeklyByTherapist: weekly([{ dayOfWeek: 0, startTime: '09:00:00', endTime: '17:00:00', isDayOff: false, breaks: [] }]),
      overridesByKey: overrides([[`t1_${MONDAY}`, { startTime: '12:00:00', endTime: '20:00:00', isDayOff: false }]]),
    });
    expect(result).toMatchObject({ source: 'override', startTime: '12:00:00', endTime: '20:00:00' });
  });

  it('applies an override day off even when the weekly default is a working day', () => {
    const result = resolveEffectiveHours({
      therapistId: 't1',
      date: MONDAY,
      weeklyByTherapist: weekly([{ dayOfWeek: 0, startTime: '09:00:00', endTime: '17:00:00', isDayOff: false, breaks: [] }]),
      overridesByKey: overrides([[`t1_${MONDAY}`, { startTime: null, endTime: null, isDayOff: true }]]),
    });
    expect(result).toMatchObject({ isDayOff: true, source: 'override' });
  });

  it('clips a weekly break to an override window that narrows the shift', () => {
    const result = resolveEffectiveHours({
      therapistId: 't1',
      date: MONDAY,
      weeklyByTherapist: weekly([{
        dayOfWeek: 0, startTime: '09:00:00', endTime: '17:00:00', isDayOff: false,
        breaks: [
          { name: 'Lunch', startTime: '13:00:00', endTime: '14:00:00' },
          { name: 'Tea', startTime: '16:00:00', endTime: '16:30:00' },
        ],
      }]),
      overridesByKey: overrides([[`t1_${MONDAY}`, { startTime: '09:00:00', endTime: '13:30:00', isDayOff: false }]]),
    });
    // Lunch truncated at the new end, Tea dropped entirely (fully outside).
    expect(result.breaks).toEqual([{ name: 'Lunch', startTime: '13:00', endTime: '13:30' }]);
  });

  it('treats a malformed working row (missing/inverted bounds) as unconfigured rather than shading the column', () => {
    const missing = resolveEffectiveHours({
      therapistId: 't1', date: MONDAY,
      weeklyByTherapist: weekly([{ dayOfWeek: 0, startTime: '09:00:00', endTime: null, isDayOff: false, breaks: [] }]),
      overridesByKey: new Map(),
    });
    const inverted = resolveEffectiveHours({
      therapistId: 't1', date: MONDAY,
      weeklyByTherapist: weekly([{ dayOfWeek: 0, startTime: '17:00:00', endTime: '09:00:00', isDayOff: false, breaks: [] }]),
      overridesByKey: new Map(),
    });
    expect(missing).toBeNull();
    expect(inverted).toBeNull();
  });

  it('tolerates absent lookups entirely', () => {
    expect(resolveEffectiveHours({ therapistId: 't1', date: MONDAY })).toBeNull();
    expect(resolveEffectiveHours({ therapistId: null, date: MONDAY, weeklyByTherapist: weekly([]) })).toBeNull();
  });
});

describe('getRosterShadingSegments', () => {
  const grid = { openTime: '08:00', closeTime: '20:00' };

  it('shades nothing when no roster is configured', () => {
    expect(getRosterShadingSegments({ effective: null, ...grid })).toEqual([]);
  });

  it('shades the whole grid for a day off', () => {
    const segs = getRosterShadingSegments({ effective: { isDayOff: true, breaks: [] }, ...grid });
    expect(segs).toEqual([{ kind: 'off', fromTime: '08:00', toTime: '20:00', label: 'Day off' }]);
  });

  it('shades before and after the shift, and breaks separately', () => {
    const segs = getRosterShadingSegments({
      effective: {
        isDayOff: false,
        startTime: '09:00:00',
        endTime: '17:00:00',
        breaks: [{ name: 'Lunch', startTime: '13:00', endTime: '14:00' }],
      },
      ...grid,
    });
    expect(segs).toEqual([
      { kind: 'off', fromTime: '08:00', toTime: '09:00', label: 'Off roster' },
      { kind: 'off', fromTime: '17:00', toTime: '20:00', label: 'Off roster' },
      { kind: 'break', fromTime: '13:00', toTime: '14:00', label: 'Break · Lunch' },
    ]);
  });

  it('labels an unnamed break plainly', () => {
    const segs = getRosterShadingSegments({
      effective: { isDayOff: false, startTime: '09:00', endTime: '17:00', breaks: [{ name: '', startTime: '13:00', endTime: '14:00' }] },
      ...grid,
    });
    expect(segs.find(s => s.kind === 'break').label).toBe('Break');
  });

  it('emits no off-roster band when the shift covers the whole visible grid', () => {
    const segs = getRosterShadingSegments({
      effective: { isDayOff: false, startTime: '08:00', endTime: '20:00', breaks: [] },
      ...grid,
    });
    expect(segs).toEqual([]);
  });

  it('clips bands that extend past the grid bounds', () => {
    const segs = getRosterShadingSegments({
      effective: { isDayOff: false, startTime: '06:00', endTime: '23:00', breaks: [{ name: '', startTime: '07:00', endTime: '09:00' }] },
      ...grid,
    });
    // Shift already covers the grid, so only the break shows — clipped at open.
    expect(segs).toEqual([{ kind: 'break', fromTime: '08:00', toTime: '09:00', label: 'Break' }]);
  });

  it('compares "HH:MM:SS" DB times against "HH:MM" grid bounds numerically, not lexically', () => {
    const segs = getRosterShadingSegments({
      effective: { isDayOff: false, startTime: '08:00:00', endTime: '20:00:00', breaks: [] },
      ...grid,
    });
    // A lexical compare would read "08:00:00" > "08:00" and emit a zero-width band.
    expect(segs).toEqual([]);
  });

  it('handles a full-day grid (00:00-24:00)', () => {
    const segs = getRosterShadingSegments({
      effective: { isDayOff: false, startTime: '09:00', endTime: '17:00', breaks: [] },
      openTime: '00:00',
      closeTime: '24:00',
    });
    expect(segs).toEqual([
      { kind: 'off', fromTime: '00:00', toTime: '09:00', label: 'Off roster' },
      { kind: 'off', fromTime: '17:00', toTime: '24:00', label: 'Off roster' },
    ]);
  });
});
