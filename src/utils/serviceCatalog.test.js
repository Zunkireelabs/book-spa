import { describe, it, expect } from 'vitest';
import { mostBooked, categoryGroups, showCategoryHeaders, priceLine, searchServices } from './serviceCatalog';

const svc = (id, name, extra = {}) => ({ id, name, duration_minutes: 60, price_npr: 3499, category: 'Hair', ...extra });
const list = [svc('a', 'Alpha'), svc('b', 'Beta'), svc('c', 'Gamma'), svc('d', 'Delta'), svc('e', 'Eps')];
const c = (id, n, at = '2026-11-01T00:00:00Z') => ({ service_id: id, booking_count: n, last_booked_at: at });

describe('mostBooked', () => {
  it('returns [] when the branch total is under 20', () => {
    expect(mostBooked([c('a', 10), c('b', 9)], list)).toEqual([]);
  });
  it('needs 5 each, max 3, highest first', () => {
    expect(mostBooked([c('a', 8), c('b', 7), c('c', 6), c('d', 5), c('e', 4)], list)).toEqual(['a', 'b', 'c']);
    expect(mostBooked([c('a', 15), c('b', 4), c('c', 4)], list)).toEqual(['a']);
  });
  it('ties: later last_booked_at, then name', () => {
    expect(mostBooked([c('a', 6, '2026-10-01T00:00:00Z'), c('b', 6, '2026-11-01T00:00:00Z'), c('c', 6, '2026-11-01T00:00:00Z'), c('d', 6, '2026-09-01T00:00:00Z')], list)).toEqual(['b', 'c', 'a']);
  });
  it('only services in the bookable list; counts still feed the total', () => {
    expect(mostBooked([c('zz', 30), c('a', 5)], list)).toEqual(['a']);
    expect(mostBooked([c('a', 25)], [svc('b', 'Beta')])).toEqual([]);
  });
  it('bad input gives []', () => {
    expect(mostBooked(null, list)).toEqual([]);
    expect(mostBooked([c('a', 30)], [])).toEqual([]);
  });
});

describe('category headers rule', () => {
  const many = (cats, n) => Array.from({ length: n }, (_, i) => svc(`s${i}`, `S${i}`, { category: cats[i % cats.length] }));
  it('needs 2+ categories and more than 8 services', () => {
    expect(showCategoryHeaders(many(['A', 'B'], 9))).toBe(true);
    expect(showCategoryHeaders(many(['A', 'B'], 8))).toBe(false);
    expect(showCategoryHeaders(many(['A'], 20))).toBe(false);
  });
  it('ordered categories first, unordered A–Z after', () => {
    const s = [svc('1', 'x', { category: 'Zed' }), svc('2', 'y', { category: 'Nails' }), svc('3', 'z', { category: 'Apple' }), svc('4', 'w', { category: 'Hair' })];
    expect(categoryGroups(s, { Nails: 2, Hair: 1 }).map((g) => g.name)).toEqual(['Hair', 'Nails', 'Apple', 'Zed']);
  });
});

describe('priceLine', () => {
  it('plain price', () => expect(priceLine(svc('a', 'A'), undefined)).toBe('60 min · NPR 3,499'));
  it('"- From" fixed-price names show the real price, no "from"', () => expect(priceLine(svc('a', 'Cut - From', { price_type: 'fixed' }), [100])).toBe('60 min · NPR 3,499'));
  it('tiered with tier rows: from the lowest of base and tiers', () => expect(priceLine(svc('a', 'A', { price_type: 'tiered' }), [4000, 2500])).toBe('60 min · from NPR 2,500'));
  it('tiered without tier rows: plain', () => expect(priceLine(svc('a', 'A', { price_type: 'tiered' }), [])).toBe('60 min · NPR 3,499'));
  it('hidden prices: duration only', () => expect(priceLine(svc('a', 'A'), undefined, false)).toBe('60 min'));
  it('uses the offer price when present', () => expect(priceLine(svc('a', 'A', { effective_price_npr: 2999 }), undefined)).toBe('60 min · NPR 2,999'));
});

describe('searchServices', () => {
  it('flat, case-insensitive, keeps order', () => expect(searchServices(list, 'LT').map((s) => s.id)).toEqual(['d']));
});

describe('category order, mixed', () => {
  it('a category missing from the order map is not treated as ordered', () => {
    const s = [svc('1', 'x', { category: 'Beta' }), svc('2', 'y', { category: 'Alpha' }), svc('3', 'z', { category: 'Zero' })];
    expect(categoryGroups(s, { Zero: 0 }).map((g) => g.name)).toEqual(['Zero', 'Alpha', 'Beta']);
  });
});
