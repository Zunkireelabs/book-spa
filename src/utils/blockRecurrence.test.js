import { describe, it, expect } from 'vitest';
import { expandBlockOccurrences } from './blockRecurrence';

const baseBlock = {
  blockDate: '2026-09-01',
  startTime: '14:00:00',
  durationMinutes: 60,
  recurrenceFreq: null,
  recurrenceInterval: 1,
  recurrenceEndDate: null,
  recurrenceCount: null,
  isCancelled: false,
};

describe('expandBlockOccurrences', () => {
  it('returns a single occurrence for a one-off block within range', () => {
    const result = expandBlockOccurrences(baseBlock, [], '2026-09-01', '2026-09-30');
    expect(result).toEqual([{ date: '2026-09-01', startTime: '14:00', endTime: '15:00' }]);
  });

  it('excludes a one-off block outside the range', () => {
    const result = expandBlockOccurrences(baseBlock, [], '2026-10-01', '2026-10-31');
    expect(result).toEqual([]);
  });

  it('returns nothing for a cancelled block', () => {
    const result = expandBlockOccurrences({ ...baseBlock, isCancelled: true }, [], '2026-09-01', '2026-09-30');
    expect(result).toEqual([]);
  });

  it('expands a daily recurrence within range', () => {
    const block = { ...baseBlock, recurrenceFreq: 'daily', recurrenceInterval: 1 };
    const result = expandBlockOccurrences(block, [], '2026-09-01', '2026-09-05');
    expect(result.map(o => o.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05']);
  });

  it('expands a weekly recurrence, respecting interval', () => {
    const block = { ...baseBlock, recurrenceFreq: 'weekly', recurrenceInterval: 2 };
    const result = expandBlockOccurrences(block, [], '2026-09-01', '2026-10-15');
    expect(result.map(o => o.date)).toEqual(['2026-09-01', '2026-09-15', '2026-09-29', '2026-10-13']);
  });

  it('stops a monthly recurrence at recurrence_end_date', () => {
    const block = { ...baseBlock, blockDate: '2026-01-31', recurrenceFreq: 'monthly', recurrenceInterval: 1, recurrenceEndDate: '2026-04-01' };
    const result = expandBlockOccurrences(block, [], '2026-01-01', '2026-12-31');
    // Jan 31 -> Feb 28 (clamped, not Mar 3) -> Mar 31 -> Apr 30 would be past end date, excluded
    expect(result.map(o => o.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });

  it('stops a recurrence after recurrence_count occurrences', () => {
    const block = { ...baseBlock, recurrenceFreq: 'daily', recurrenceInterval: 1, recurrenceCount: 3 };
    const result = expandBlockOccurrences(block, [], '2026-09-01', '2026-12-31');
    expect(result.map(o => o.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
  });

  it('filters out occurrences on exception dates', () => {
    const block = { ...baseBlock, recurrenceFreq: 'daily', recurrenceInterval: 1 };
    const result = expandBlockOccurrences(block, ['2026-09-02'], '2026-09-01', '2026-09-03');
    expect(result.map(o => o.date)).toEqual(['2026-09-01', '2026-09-03']);
  });
});
