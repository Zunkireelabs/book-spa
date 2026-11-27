import { describe, it, expect } from 'vitest';
import { visitKey, sameVisit, visitMembers } from './visit';

const b = (bookingId, visitId = null, extra = {}) => ({ bookingId, visitId, customerId: 'mira', date: '2026-11-20', ...extra });

describe('visit helper (ZNLY-402)', () => {
  it('a booking with no visit_id is its own visit', () => {
    expect(visitKey(b('a'))).toBe('own:a');
    expect(sameVisit(b('a'), b('a'))).toBe(true);
    expect(sameVisit(b('a'), b('c'))).toBe(false);
  });
  it('two rows with the same visit_id are one visit', () => {
    expect(sameVisit(b('a', 'v1'), b('c', 'v1'))).toBe(true);
    expect(sameVisit(b('a', 'v1'), b('c', 'v2'))).toBe(false);
  });
  it('same customer and day but NULL or different visit_id = different visits (no guessing)', () => {
    expect(sameVisit(b('a'), b('c'))).toBe(false);
    expect(sameVisit(b('a', 'v1'), b('c'))).toBe(false);
    expect(sameVisit(b('a', null, { bookingGroupId: 'g' }), b('c', null, { bookingGroupId: 'g' }))).toBe(false); // party link is not a visit
    expect(sameVisit(b('a', null, { customerName: 'Mira' }), b('c', null, { customerName: 'Mira' }))).toBe(false);
  });
  it('reads raw rows too (visit_id / id)', () => {
    expect(sameVisit({ id: 'a', visit_id: 'v1' }, { id: 'c', visit_id: 'v1' })).toBe(true);
    expect(visitKey({ id: 'a' })).toBe('own:a');
  });
  it('copies of one shared booking are one visit', () => { expect(sameVisit(b('s'), b('s'))).toBe(true); });
  it('visitMembers includes cancelled rows and the booking itself', () => {
    const list = [b('a', 'v1'), b('c', 'v1', { status: 'cancelled' }), b('d', 'v2'), b('e')];
    expect(visitMembers(list, list[0]).map((x) => x.bookingId)).toEqual(['a', 'c']);
    expect(visitMembers(list, list[3]).map((x) => x.bookingId)).toEqual(['e']);
  });
  it('junk input is nobody\'s visit', () => {
    expect(visitKey(null)).toBeNull();
    expect(sameVisit(null, null)).toBe(false);
    expect(visitMembers([b('a')], {})).toEqual([]);
  });
});

import { visitCount } from './bookingsList';
describe('Bookings list visit label (ZNLY-402)', () => {
  it('counts the visit, not the party or the client-day', () => {
    const all = [b('a', 'v1', { bookingGroupId: 'g' }), b('c', 'v1', { bookingGroupId: 'g' }), b('d', null, { bookingGroupId: 'g' }), b('e')];
    expect(visitCount(all[0], all)).toBe(2);
    expect(visitCount(all[2], all)).toBe(1); // party member without visit_id
    expect(visitCount(all[3], all)).toBe(1);
  });
});
