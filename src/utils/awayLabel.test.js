import { describe, it, expect } from 'vitest';
import { awayLabel } from './awayLabel';
import { buildShadeSegments } from '../services/availabilityShading';

const hm12 = (t) => { const [h, m] = t.split(':').map(Number); return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')}${h >= 12 && h < 24 ? 'pm' : 'am'}`; };

describe('awayLabel (one wording for a transfer window)', () => {
  it('first day: from the start time, never the day edge', () => {
    expect(awayLabel('QC Second Studio', 600, 1440, { fmt: hm12 })).toBe('At QC Second Studio from 10:00am');
  });
  it('middle day: just the place', () => {
    expect(awayLabel('QC Second Studio', 0, 1440, { fmt: hm12 })).toBe('At QC Second Studio');
  });
  it('return day: until the revert time', () => {
    expect(awayLabel('QC Second Studio', 0, 600, { fmt: hm12 })).toBe('At QC Second Studio until 10:00am');
  });
  it('a window inside one day prints both ends', () => {
    expect(awayLabel('QC Second Studio', 720, 960, { fmt: hm12 })).toBe('At QC Second Studio 12:00pm–4:00pm');
  });
  it('uses the calendar open/close as the day edges when given', () => {
    expect(awayLabel('X', 540, 1260, { openMin: 540, closeMin: 1260, fmt: hm12 })).toBe('At X');
  });
});

describe('availability RPC OTHER_BRANCH labels', () => {
  const day = (off, works = true) => ({ works, start_time: works ? '09:00' : null, end_time: works ? '18:00' : null, off: [{ code: 'OTHER_BRANCH', reason: 'other_branch', label: 'QC Second Studio', ...off }] });
  const label = (row) => buildShadeSegments(row, hm12).find((s) => s.kind === 'branch').label;
  it('first, middle and return day read the window (the RPC cuts each day to 0..1440)', () => {
    expect(label(day({ start_min: 600, end_min: 1440 }))).toBe('At QC Second Studio from 10:00am');
    expect(label(day({ start_min: 0, end_min: 1440 }))).toBe('At QC Second Studio');
    expect(label(day({ start_min: 0, end_min: 600 }))).toBe('At QC Second Studio until 10:00am');
  });
  it('is the same with a day off or a shorter roster override', () => {
    expect(label(day({ start_min: 600, end_min: 1440 }, false))).toBe('At QC Second Studio from 10:00am');
    expect(label({ ...day({ start_min: 600, end_min: 1440 }), start_time: '10:00', end_time: '12:00' })).toBe('At QC Second Studio from 10:00am');
  });
  it('a range inside the day (a gap between two visits) keeps both ends', () => {
    expect(label(day({ start_min: 720, end_min: 960 }))).toBe('At QC Second Studio 12:00pm–4:00pm');
  });
});
