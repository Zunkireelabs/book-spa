import { describe, it, expect } from 'vitest';
import { splitStatusPreview, time12 } from './visitPreview';

const lines = { a: { name: 'Gel Nail', price: 3000, start: '11:30', staff: 'Jayanti R.' }, b: { name: 'Brows', price: 349, start: '11:30', staff: 'Rojina K' }, c: { name: 'Upper Lip', price: 99, start: '12:00', staff: 'Rojina K' } };

describe('visitPreview', () => {
  it('formats 12h', () => { expect(time12('11:30:00')).toBe('11:30am'); expect(time12('12:00')).toBe('12:00pm'); expect(time12('00:15')).toBe('12:15am'); });
  it('splits change / keep with price and who', () => {
    const r = splitStatusPreview({ rows: [{ booking_id: 'b', verdict: 'change' }, { booking_id: 'c', verdict: 'change', start: '12:00' }, { booking_id: 'a', verdict: 'keep', reason: 'Started' }] }, lines);
    expect(r.change.map((x) => [x.name, x.price, x.sub])).toEqual([['Brows', 349, '11:30am · Rojina K'], ['Upper Lip', 99, '12:00pm · Rojina K']]);
    expect(r.keep).toHaveLength(1);
    expect(r.keep[0].sub).toBe('Started · Jayanti R.');
  });
  it('already cancelled rows are not listed under These stay', () => {
    const r = splitStatusPreview({ rows: [{ booking_id: 'a', verdict: 'keep', reason: 'Already started' }, { booking_id: 'b', verdict: 'keep', reason: 'Already cancelled' }] }, lines);
    expect(r.keep).toHaveLength(1);
  });
  it('nothing cancellable -> empty change', () => {
    expect(splitStatusPreview({ rows: [{ booking_id: 'a', verdict: 'keep' }] }, lines).change).toEqual([]);
  });
});
