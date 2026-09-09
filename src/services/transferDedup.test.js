import { describe, it, expect } from 'vitest';
import { dedupeTransfersByKey } from './transferDedup';

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
});
