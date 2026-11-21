import { describe, it, expect } from 'vitest';
import { transferOccurrencesForDate } from './transferOccurrences';

const NP = (d, t) => `${d}T${t}:00+05:45`;
const visit = (startDate, startTime, endAt) => ({ therapistId: 't1', kind: 'in', startDate, startTime, endAt, otherBranch: 'Lazimpat' });
const spans = (occ) => occ.map((o) => [o.startTime, o.endTime]);

describe('visitor "not here" occurrences', () => {
  it('one window: before and after it', () => {
    expect(spans(transferOccurrencesForDate([visit('2026-10-27', '12:00', NP('2026-10-27', '15:30'))], '2026-10-27')))
      .toEqual([['00:00', '12:00'], ['15:30', '24:00']]);
  });
  it('two windows the same day: only outside their union (the 7:40 pm booking is allowed)', () => {
    const rows = [visit('2026-10-27', '12:00', NP('2026-10-27', '15:30')), visit('2026-10-27', '18:55', NP('2026-10-27', '21:55'))];
    expect(spans(transferOccurrencesForDate(rows, '2026-10-27'))).toEqual([['00:00', '12:00'], ['15:30', '18:55'], ['21:55', '24:00']]);
    expect(spans(transferOccurrencesForDate([...rows].reverse(), '2026-10-27'))).toEqual([['00:00', '12:00'], ['15:30', '18:55'], ['21:55', '24:00']]);
  });
  it('a window spanning midnight is open the whole next day until it ends', () => {
    const rows = [visit('2026-10-27', '20:00', NP('2026-10-28', '06:00'))];
    expect(spans(transferOccurrencesForDate(rows, '2026-10-27'))).toEqual([['00:00', '20:00']]);
    expect(spans(transferOccurrencesForDate(rows, '2026-10-28'))).toEqual([['06:00', '24:00']]);
  });
  it('already returned home: nothing; not arrived yet: whole day', () => {
    const rows = [visit('2026-10-27', '12:00', NP('2026-10-27', '15:30'))];
    expect(transferOccurrencesForDate(rows, '2026-10-28')).toEqual([]);
    expect(spans(transferOccurrencesForDate(rows, '2026-10-26'))).toEqual([['00:00', '24:00']]);
  });
  it('transfer-out rows are unchanged', () => {
    const out = { therapistId: 't2', kind: 'out', startDate: '2026-10-27', startTime: '12:00', endAt: NP('2026-10-27', '15:30'), otherBranch: 'Sanepa' };
    expect(spans(transferOccurrencesForDate([out], '2026-10-27'))).toEqual([['12:00', '15:30']]);
  });
});
