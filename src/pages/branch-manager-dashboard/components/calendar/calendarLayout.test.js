import { describe, it, expect } from 'vitest';
import { clusterOverlapping, getOverlapLayout } from './calendarLayout';

const b = (id, startTime, endTime) => ({ id, startTime, endTime });
describe('clusterOverlapping with the shortest drawn card (ZNLY-265c)', () => {
  const day = [b('rita', '10:00', '10:15'), b('puja1', '10:15', '10:30'), b('puja2', '10:30', '12:30')];
  it('strict times: back-to-back bookings are separate clusters (old behaviour, minMinutes 0)', () => {
    expect(clusterOverlapping(day).map((c) => c.length)).toEqual([1, 1, 1]);
  });
  it('a 24px minimum card (20 min at 72px/h) makes the three share one cluster, so they sit side by side', () => {
    const cl = clusterOverlapping(day, 20);
    expect(cl.map((c) => c.map((x) => x.id))).toEqual([['rita', 'puja1', 'puja2']]);
    expect(getOverlapLayout(3).cards.length).toBe(3);
  });
  it('far-apart bookings stay separate', () => {
    expect(clusterOverlapping([b('a', '09:00', '09:15'), b('b', '11:00', '11:15')], 20).length).toBe(2);
  });
  it('real overlaps still cluster', () => {
    expect(clusterOverlapping([b('a', '10:00', '11:00'), b('b', '10:30', '11:30')], 20).length).toBe(1);
  });
});
