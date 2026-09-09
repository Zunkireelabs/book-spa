import { describe, it, expect } from 'vitest';
import { dedupeTransfersByKey, sortTransfersByTime } from './transferDedup';

describe('dedupeTransfersByKey', () => {
  it('returns rows unchanged when every key is unique', () => {
    const rows = [{ id: 'a', v: 1 }, { id: 'b', v: 2 }];
    expect(dedupeTransfersByKey(rows, r => r.id)).toEqual(rows);
  });

  it('keeps only the LAST row for a repeated key', () => {
    const rows = [
      { id: 'a', v: 'first' },
      { id: 'b', v: 'only' },
      { id: 'a', v: 'second' },
    ];
    expect(dedupeTransfersByKey(rows, r => r.id)).toEqual([
      { id: 'b', v: 'only' },
      { id: 'a', v: 'second' },
    ]);
  });

  it('drops rows whose key is null, undefined, or empty string', () => {
    const rows = [
      { id: null, v: 1 },
      { id: 'a', v: 2 },
      { id: undefined, v: 3 },
      { id: '', v: 4 },
    ];
    expect(dedupeTransfersByKey(rows, r => r.id)).toEqual([{ id: 'a', v: 2 }]);
  });

  it('returns an empty array for empty input', () => {
    expect(dedupeTransfersByKey([], r => r.id)).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const rows = [{ id: 'a', v: 1 }, { id: 'a', v: 2 }];
    const rowsCopy = JSON.parse(JSON.stringify(rows));
    dedupeTransfersByKey(rows, r => r.id);
    expect(rows).toEqual(rowsCopy);
  });

  it('supports a key function that reaches into a nested object (therapist.id shape)', () => {
    const rows = [
      { therapist: { id: 't1' }, start: '09:00' },
      { therapist: { id: 't1' }, start: '14:00' },
      { therapist: { id: 't2' }, start: '10:00' },
    ];
    const result = dedupeTransfersByKey(rows, r => r.therapist?.id);
    expect(result).toEqual([
      { therapist: { id: 't1' }, start: '14:00' },
      { therapist: { id: 't2' }, start: '10:00' },
    ]);
  });

  it('picks the chronologically LATEST row, not just the last one in a two-block concatenation', () => {
    // Reproduces the real getCalendarBookings shape: a still-LIVE transfer (from the live
    // query, listed FIRST in the concatenation) can be chronologically AFTER an
    // already-reverted transfer for the same therapist earlier today (from the
    // reverted-today query, listed SECOND) — per-query .order() alone can't fix this,
    // rows must be globally sorted before dedupe or the stale row wins.
    const liveRow = { therapist_id: 't1', effective_date: '2026-09-09', start_time: '15:00:00', label: 'live-3pm' };
    const revertedTodayRow = { therapist_id: 't1', effective_date: '2026-09-09', start_time: '09:00:00', label: 'reverted-9am' };
    const rows = sortTransfersByTime([liveRow, revertedTodayRow]);
    const result = dedupeTransfersByKey(rows, r => r.therapist_id);
    expect(result).toEqual([liveRow]);
  });
});

describe('sortTransfersByTime', () => {
  it('sorts ascending by effective_date then start_time', () => {
    const rows = [
      { effective_date: '2026-09-09', start_time: '15:00:00', label: 'c' },
      { effective_date: '2026-09-08', start_time: '20:00:00', label: 'a' },
      { effective_date: '2026-09-09', start_time: '09:00:00', label: 'b' },
    ];
    expect(sortTransfersByTime(rows).map(r => r.label)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input array', () => {
    const rows = [
      { effective_date: '2026-09-09', start_time: '15:00:00' },
      { effective_date: '2026-09-08', start_time: '09:00:00' },
    ];
    const rowsCopy = JSON.parse(JSON.stringify(rows));
    sortTransfersByTime(rows);
    expect(rows).toEqual(rowsCopy);
  });

  it('does not throw on a missing effective_date/start_time (defensive — real rows always have both)', () => {
    const rows = [
      { effective_date: '2026-09-09', start_time: '09:00:00', label: 'has-date' },
      { effective_date: null, start_time: null, label: 'no-date' },
    ];
    expect(() => sortTransfersByTime(rows)).not.toThrow();
    expect(sortTransfersByTime(rows).map(r => r.label).sort()).toEqual(['has-date', 'no-date']);
  });
});
