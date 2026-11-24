import { describe, it, expect } from 'vitest';
import { buildClientIndex, isSameClient, clientDayInfo, customerIdOf } from './sameClient';

const bk = (id, customerId, startTime, endTime, status = 'confirmed', date = '2026-11-20') => ({ bookingId: id, customerId, startTime, endTime, status, date });
const day = [bk('a', 'mira', '14:00', '14:45'), bk('b', 'mira', '15:00', '16:00'), bk('c', 'mira', '17:00', '17:45'), bk('d', 'other', '09:00', '10:00'), bk('w', null, '11:00', '12:00'), bk('x', 'mira', '12:00', '12:30', 'cancelled')];
const idx = buildClientIndex(day);

describe('same client (ZNLY-281)', () => {
  it('matches on customerId only: the three Mira bookings and her cancelled one are outlined', () => {
    expect(day.filter((b) => isSameClient(idx, 'mira', b)).map((b) => b.bookingId)).toEqual(['a', 'b', 'c', 'x']);
  });
  it('a client with one booking highlights nothing', () => { expect(isSameClient(idx, 'other', day[3])).toBe(false); });
  it('walk-in (null customerId) highlights nothing, and a null active client matches nothing', () => {
    expect(isSameClient(idx, null, day[4])).toBe(false);
    expect(isSameClient(idx, 'mira', day[4])).toBe(false);
    expect(clientDayInfo(idx, day[4])).toBeNull();
  });
  it('count excludes cancelled; range is first start to last end', () => {
    expect(clientDayInfo(idx, day[0])).toEqual({ count: 3, first: '14:00', last: '17:45' });
  });
  it('another day is counted separately', () => {
    const i2 = buildClientIndex([...day, bk('n', 'mira', '10:00', '11:00', 'confirmed', '2026-11-21')]);
    expect(clientDayInfo(i2, day[0]).count).toBe(3);
    expect(clientDayInfo(i2, bk('n', 'mira', '10:00', '11:00', 'confirmed', '2026-11-21'))).toBeNull(); // only 1 that day
    expect(isSameClient(i2, 'mira', day[0])).toBe(true); // still outlined across the week
  });
  it('copies of a shared booking count once', () => {
    const i3 = buildClientIndex([bk('s', 'z', '10:00', '11:00'), bk('s', 'z', '10:00', '11:00')]);
    expect(isSameClient(i3, 'z', bk('s', 'z'))).toBe(false);
  });
  it('customerIdOf finds the active booking\'s client', () => { expect(customerIdOf(day, 'b')).toBe('mira'); expect(customerIdOf(day, 'nope')).toBeNull(); });
});
