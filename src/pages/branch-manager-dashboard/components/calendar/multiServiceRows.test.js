import { describe, it, expect } from 'vitest';
import { rowTimes, bookingTotal, rowsIncompleteReason, toGroupServices, newRow, ownOverlaps } from './multiServiceRows';

const svc = [
  { id: 'a', name: 'Manicure', duration_minutes: 45, price_npr: 1500 },
  { id: 'b', name: 'Brows', duration_minutes: 30, price_npr: 349 },
  { id: 'c', name: 'Lip', duration_minutes: 15, price_npr: 99, price_type: 'tiered' },
];
const first = svc[0];

describe('multi-service rows (ZNLY-402 3b)', () => {
  it('each row starts when the previous one ends, an edited start wins and later rows follow it', () => {
    const rows = [{ serviceId: 'b', start: '' }, { serviceId: 'c', start: '' }];
    expect(rowTimes(rows, svc, '10:00', 45).map((t) => [t.start, t.end])).toEqual([['10:45', '11:15'], ['11:15', '11:30']]);
    const edited = [{ serviceId: 'b', start: '12:00' }, { serviceId: 'c', start: '' }];
    expect(rowTimes(edited, svc, '10:00', 45).map((t) => [t.start, t.end])).toEqual([['12:00', '12:30'], ['12:30', '12:45']]);
  });
  it('the total is the sum of the lines; a tiered service makes it approximate', () => {
    expect(bookingTotal(first, [{ serviceId: 'b' }], svc)).toMatchObject({ total: 1849, approx: false, count: 2 });
    expect(bookingTotal(first, [{ serviceId: 'b' }, { serviceId: 'c' }], svc)).toMatchObject({ total: 1948, approx: true, count: 3 });
  });
  it('an empty row blocks Create with a plain reason naming the service number', () => {
    expect(rowsIncompleteReason([{ serviceId: 'b' }, { serviceId: '' }])).toBe('Pick a service for service 3');
    expect(rowsIncompleteReason([{ serviceId: 'b' }])).toBe('');
  });
  it('builds the createBookingGroup list: own start and staff per row', () => {
    const rows = [{ serviceId: 'b', therapistId: 't2', start: '' }];
    expect(toGroupServices({ first, firstStart: '10:00', firstTherapistIds: ['t1'], rows, services: svc })).toEqual([
      { id: 'a', name: 'Manicure', duration_minutes: 45, startTime: '10:00', therapistIds: ['t1'] },
      { id: 'b', name: 'Brows', duration_minutes: 30, startTime: '10:45', therapistIds: ['t2'] },
    ]);
  });
  it('new rows are empty and unique', () => {
    const a = newRow(); const b = newRow();
    expect(a.key).not.toBe(b.key);
    expect(a).toMatchObject({ serviceId: '', therapistId: '', start: '' });
  });
  it('the same person in two overlapping services of one booking is a problem on the later one', () => {
    const slots = [{ ids: ['t1'], startMin: 600, endMin: 645 }, { ids: ['t1'], startMin: 630, endMin: 660 }, { ids: ['t2'], startMin: 630, endMin: 660 }];
    expect(ownOverlaps(slots, () => 'Mira')).toEqual({ 1: 'Mira is already in service 1 at this time. Pick another time or someone else.' });
    expect(ownOverlaps([{ ids: ['t1'], startMin: 600, endMin: 645 }, { ids: ['t1'], startMin: 645, endMin: 660 }])).toEqual({});
  });
});
