import { describe, it, expect } from 'vitest';
import { indexShifts, buildShadeSegments, shiftHeaderInfo, slotVerdict, isOutsideShift, outsideReasonText } from './availabilityShading';

const day = (o = {}) => ({
  therapist_id: 't1', shift_date: '2026-10-26', works: true, start_time: '09:00:00', end_time: '18:00:00', source: 'weekly',
  breaks: [], off: [], ...o,
});

describe('buildShadeSegments', () => {
  it('shades before and after the shift in grey', () => {
    expect(buildShadeSegments(day()).map((s) => [s.kind, s.startMin, s.endMin])).toEqual([['off', 0, 540], ['off', 1080, 1440]]);
  });

  it('treats 23:59:59 as 24:00 (no after-shift shade)', () => {
    expect(buildShadeSegments(day({ end_time: '23:59:59' })).filter((s) => s.startMin >= 1000)).toEqual([]);
  });

  it('shades a whole day off', () => {
    expect(buildShadeSegments(day({ works: false, start_time: null, end_time: null }))).toMatchObject([{ kind: 'off', startMin: 0, endMin: 1440 }]);
  });

  it('labels a break with its own name and time', () => {
    const seg = buildShadeSegments(day({ breaks: [{ name: 'Lunch', start_min: 780, end_min: 840 }] })).find((s) => s.kind === 'break');
    expect(seg).toMatchObject({ startMin: 780, endMin: 840, label: 'Lunch 13:00–14:00' });
  });

  it('labels full and half leave', () => {
    const full = buildShadeSegments(day({ works: false, off: [{ code: 'ON_LEAVE', reason: 'leave_full', start_min: 0, end_min: 1440 }] }));
    expect(full.find((s) => s.kind === 'leave').label).toBe('Leave');
    const half = buildShadeSegments(day({ off: [{ code: 'ON_LEAVE', reason: 'leave_half', start_min: 810, end_min: 1080 }] }));
    expect(half.find((s) => s.kind === 'leave').label).toBe('Leave · off 13:30–18:00');
  });

  it('labels another branch and leaves blocks to the block layer', () => {
    const segs = buildShadeSegments(day({ off: [
      { code: 'OTHER_BRANCH', reason: 'other_branch', label: 'Sanepa', start_min: 720, end_min: 960 },
      { code: 'BLOCKED', reason: 'block', label: 'Training', start_min: 960, end_min: 1020 },
    ] }));
    expect(segs.find((s) => s.kind === 'branch').label).toBe('At Sanepa 12:00–16:00');
    expect(segs.some((s) => s.code === 'BLOCKED')).toBe(false);
  });

  it('applies the display formatter to labels', () => {
    const seg = buildShadeSegments(day({ breaks: [{ name: 'Lunch', start_min: 780, end_min: 840 }] }), (t) => `<${t}>`).find((s) => s.kind === 'break');
    expect(seg.label).toBe('Lunch <13:00>–<14:00>');
  });

  it('returns nothing without a row', () => {
    expect(buildShadeSegments(null)).toEqual([]);
  });
});

describe('shiftHeaderInfo', () => {
  it('covers each header line', () => {
    expect(shiftHeaderInfo(day())).toMatchObject({ text: '09:00–18:00', tone: 'shift', dot: 'grey' });
    expect(shiftHeaderInfo(day({ end_time: '23:59:59' })).text).toBe('09:00–24:00');
    expect(shiftHeaderInfo(day({ works: false }))).toMatchObject({ text: 'Day off', tone: 'off' });
    expect(shiftHeaderInfo(day({ works: false, off: [{ code: 'ON_LEAVE', reason: 'leave_full' }] }))).toMatchObject({ text: 'On leave', tone: 'leave', dot: 'purple' });
    expect(shiftHeaderInfo(day({ source: 'none' }))).toMatchObject({ text: 'No set hours', dot: 'green' });
    // today's column reads the live state
    expect(shiftHeaderInfo(day(), { isToday: true, nowMin: 600 })).toMatchObject({ text: 'Not checked in', dot: 'amber' });
    expect(shiftHeaderInfo(day(), { isToday: true, nowMin: 600, attendance: { status: 'Present', checkInTime: '09:07' } })).toMatchObject({ text: '09:00–18:00', dot: 'green' });
    expect(shiftHeaderInfo(null)).toBeNull();
  });
});

describe('slotVerdict / isOutsideShift', () => {
  const d = day({ breaks: [{ name: 'Lunch', start_min: 780, end_min: 840 }] });
  it('reports the reason for shaded time and null for free time', () => {
    expect(slotVerdict(d, 780, 810, { therapistName: 'Vina' }).message).toBe('Vina is on a break 13:00–14:00');
    expect(slotVerdict(d, 600, 660)).toBeNull();
  });
  it('flags a booking now outside the rule', () => {
    expect(isOutsideShift(d, 480, 570)).toBe(true);
    expect(isOutsideShift(d, 600, 660)).toBe(false);
    expect(isOutsideShift(null, 0, 60)).toBe(false);
  });
});

describe('indexShifts', () => {
  it('keys rows by therapist then date', () => {
    const idx = indexShifts([day(), day({ therapist_id: 't2', shift_date: '2026-10-27' })]);
    expect(idx.t1['2026-10-26'].works).toBe(true);
    expect(idx.t2['2026-10-27']).toBeDefined();
  });
});

describe('outsideReasonText (the outlined booking card names the real reason)', () => {
  const d = day({ breaks: [{ name: 'Lunch', start_min: 780, end_min: 840 }], off: [
    { code: 'ON_LEAVE', reason: 'leave_half', start_min: 900, end_min: 1020 },
    { code: 'BLOCKED', reason: 'block', label: 'Training', start_min: 1020, end_min: 1080 },
    { code: 'OTHER_BRANCH', reason: 'transfer', label: 'Sanepa', start_min: 600, end_min: 660 },
  ] });
  it('maps each rule to its own words', () => {
    expect(outsideReasonText(slotVerdict(d, 480, 540))).toBe('outside hours');
    expect(outsideReasonText(slotVerdict(d, 780, 810))).toBe('during a break');
    expect(outsideReasonText(slotVerdict(d, 900, 960))).toBe('on leave');
    expect(outsideReasonText(slotVerdict(d, 1030, 1060))).toBe('in a block');
    expect(outsideReasonText(slotVerdict(d, 600, 630))).toBe('at Sanepa');
    expect(outsideReasonText(slotVerdict(d, 700, 730))).toBeNull();
  });
});
