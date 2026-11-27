import { describe, it, expect } from 'vitest';
import { weekDates, cellKind } from './rosterWeek';

describe('weekDates', () => {
  it('starts on the given day, not Monday, and crosses a month', () => {
    expect(weekDates('2026-11-27')).toEqual(['2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03']);
  });
  it('moves by whole weeks', () => {
    expect(weekDates('2026-11-27', 1)[0]).toBe('2026-12-04');
    expect(weekDates('2026-11-27', -1)[0]).toBe('2026-11-20');
  });
});

describe('cellKind', () => {
  const usual = { isDayOff: false, startTime: '09:00', endTime: '20:00' };
  it('usual hours', () => expect(cellKind({ usual })).toEqual({ kind: 'usual', changed: false }));
  it('changed hours', () => expect(cellKind({ usual, override: { isDayOff: false } })).toEqual({ kind: 'usual', changed: true }));
  it('off by override', () => expect(cellKind({ usual, override: { isDayOff: true } })).toEqual({ kind: 'off', changed: true }));
  it('off by usual / no hours', () => {
    expect(cellKind({ usual: { isDayOff: true } })).toEqual({ kind: 'off', changed: false });
    expect(cellKind({})).toEqual({ kind: 'off', changed: false });
  });
  it('closed beats everything', () => expect(cellKind({ closed: true, usual, override: { isDayOff: true } })).toEqual({ kind: 'closed', changed: false }));
});
