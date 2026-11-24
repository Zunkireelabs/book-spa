import { describe, it, expect } from 'vitest';
import { buildClientIndex, highlightLevel, clientDayInfo, customerIdOf, bookingOf, SHOW_CLIENT_OTHER_VISITS } from './sameClient';

const bk = (id, customerId, startTime, endTime, status = 'confirmed', date = '2026-11-20', visitId = null) => ({ bookingId: id, customerId, startTime, endTime, status, date, visitId });
// Mira: one visit v1 (a, b) at 14:00-16:00, plus c (own visit) 17:00, plus a cancelled row x in v1.
const day = [bk('a', 'mira', '14:00', '14:45', 'confirmed', '2026-11-20', 'v1'), bk('b', 'mira', '14:45', '16:00', 'confirmed', '2026-11-20', 'v1'), bk('c', 'mira', '17:00', '17:45'), bk('d', 'other', '09:00', '10:00'), bk('w', null, '11:00', '12:00'), bk('x', 'mira', '12:00', '12:30', 'cancelled', '2026-11-20', 'v1')];
const idx = buildClientIndex(day);
const levels = (active) => Object.fromEntries(day.map((b) => [b.bookingId, highlightLevel(idx, active, b)]));

describe('same visit / same client highlight (ZNLY-281, ZNLY-402)', () => {
  it('the faint outline switch is on by default', () => { expect(SHOW_CLIENT_OTHER_VISITS).toBe(true); });
  it('active booking in a visit: the visit (incl. its cancelled row) is strong, her other visit is faint, others nothing', () => {
    expect(levels(day[0])).toEqual({ a: 'visit', b: 'visit', c: 'client', d: null, w: null, x: 'visit' });
  });
  it('active booking with no visit: it lights nothing by itself (lone visit), her other bookings are faint', () => {
    expect(levels(day[2])).toEqual({ a: 'client', b: 'client', c: null, d: null, w: null, x: 'client' });
  });
  it('same customer and day but NULL / different visit_id are NOT the same visit', () => {
    const i2 = buildClientIndex([bk('p', 'z', '10:00', '11:00'), bk('q', 'z', '11:00', '12:00')]);
    expect(highlightLevel(i2, bk('p', 'z'), bk('q', 'z'))).toBe('client');
  });
  it('a client with one booking highlights nothing; no active booking highlights nothing', () => {
    expect(highlightLevel(idx, day[3], day[3])).toBeNull();
    expect(highlightLevel(idx, null, day[0])).toBeNull();
  });
  it('walk-in (no customerId) never matches by client, but a shared visit_id still groups it', () => {
    expect(highlightLevel(idx, day[4], day[0])).toBeNull();
    const wi = [bk('s1', null, '10:00', '10:30', 'confirmed', '2026-11-20', 'vw'), bk('s2', null, '10:30', '11:00', 'confirmed', '2026-11-20', 'vw')];
    expect(highlightLevel(buildClientIndex(wi), wi[0], wi[1])).toBe('visit');
  });
  it('banner counts the OTHER bookings that day, never the own visit, never cancelled; range = their first start to last end', () => {
    expect(clientDayInfo(idx, day[0])).toEqual({ count: 1, first: '17:00', last: '17:45' }); // only c is "also booked"
    expect(clientDayInfo(idx, day[2])).toEqual({ count: 2, first: '14:00', last: '16:00' }); // a, b (x cancelled is not counted)
  });
  it('banner is null when the client has nothing else that day (or is a walk-in)', () => {
    expect(clientDayInfo(idx, day[3])).toBeNull();
    expect(clientDayInfo(idx, day[4])).toBeNull();
    const solo = buildClientIndex([bk('a', 'm', '10:00', '11:00', 'confirmed', '2026-11-20', 'v'), bk('b', 'm', '11:00', '12:00', 'confirmed', '2026-11-20', 'v')]);
    expect(clientDayInfo(solo, bk('a', 'm', '10:00', '11:00', 'confirmed', '2026-11-20', 'v'))).toBeNull(); // whole day is one visit
  });
  it('another day is counted separately', () => {
    const n = bk('n', 'mira', '10:00', '11:00', 'confirmed', '2026-11-21');
    const i2 = buildClientIndex([...day, n]);
    expect(clientDayInfo(i2, day[0]).count).toBe(1);
    expect(clientDayInfo(i2, n)).toBeNull();
    expect(highlightLevel(i2, day[0], n)).toBe('client'); // still faint-outlined across the week
  });
  it('copies of a shared booking count once', () => {
    const i3 = buildClientIndex([bk('s', 'z', '10:00', '11:00'), bk('s', 'z', '10:00', '11:00')]);
    expect(highlightLevel(i3, bk('s', 'z'), bk('s', 'z'))).toBeNull();
  });
  it('bookingOf / customerIdOf find the active booking', () => {
    expect(bookingOf(day, 'b').customerId).toBe('mira');
    expect(customerIdOf(day, 'b')).toBe('mira');
    expect(customerIdOf(day, 'nope')).toBeNull();
  });
  it('reads raw calendar rows (visit_id / customer_id) too', () => {
    const raw = [{ id: 'r1', visit_id: 'v9', customer_id: 'k', date: '2026-11-20', start_time: '10:00:00', end_time: '10:30:00', status: 'Confirmed' }, { id: 'r2', visit_id: 'v9', customer_id: 'k', date: '2026-11-20', start_time: '10:30:00', end_time: '11:00:00', status: 'Confirmed' }];
    expect(highlightLevel(buildClientIndex(raw), raw[0], raw[1])).toBe('visit');
  });
});
