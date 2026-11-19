import { describe, it, expect } from 'vitest';
import {
  daysUntil, isLive, isExpired, isEndsSoon, isLastSession, displayStatus, owedValue, toCollect, stripStats, leadParts, needsItems,
  sortPackages, matchesPackageSearch, validityLabel, perSession, typeUsage, valuePerSession, shortName, SEGMENTS, reminderText,
} from './packagesView';

const TODAY = '2026-10-19';
const pkg = (o) => ({
  id: o.id, guestName: o.guestName || o.id, guestInfo: o.guestInfo || '', packageTypeId: o.packageTypeId || 't1', packageTypeName: o.packageTypeName || 'Swedish · 6 sessions',
  serviceName: o.serviceName || 'Swedish Massage', status: o.status || 'partially_used', sessionsTotal: o.sessionsTotal ?? 6, sessionsRemaining: o.sessionsRemaining ?? 4,
  expiryDate: o.expiryDate ?? '2027-02-21', issuedDate: o.issuedDate || '2026-04-01', paidAmount: o.paidAmount ?? 10500, finalAmount: o.finalAmount ?? null, dueAmount: o.dueAmount || 0,
});

// The mockup's nine packages (temp_ss/mockups/packages-v1.html): numbers in the lead / strip were worked out by hand from these.
const MOCK = [
  pkg({ id: 'pari', guestName: 'Pari Shrestha', sessionsTotal: 6, sessionsRemaining: 4, expiryDate: '2026-11-03', paidAmount: 9000, finalAmount: 12000, dueAmount: 3000 }),
  pkg({ id: 'gaurav', guestName: 'Gaurav Karki', sessionsTotal: 10, sessionsRemaining: 1, expiryDate: '2027-01-02', paidAmount: 30000 }),
  pkg({ id: 'farah', guestName: 'Farah Test', sessionsTotal: 6, sessionsRemaining: 5, expiryDate: '2027-04-14', paidAmount: 12000 }),
  pkg({ id: 'milan', guestName: 'Milan Sample', sessionsTotal: 6, sessionsRemaining: 3, expiryDate: '2026-10-28', paidAmount: 12000 }),
  pkg({ id: 'hema', guestName: 'Hema Sample', status: 'unused', sessionsTotal: 5, sessionsRemaining: 5, expiryDate: '2027-10-10', paidAmount: 7500 }),
  pkg({ id: 'nina', guestName: 'Nina Faux', sessionsTotal: 10, sessionsRemaining: 6, expiryDate: '2027-06-08', paidAmount: 30000 }),
  pkg({ id: 'alok', guestName: 'Alok Demo', sessionsTotal: 6, sessionsRemaining: 4, expiryDate: '2027-02-21', paidAmount: 10500 }),
  pkg({ id: 'sana', guestName: 'Sana Mock', status: 'fully_redeemed', sessionsTotal: 4, sessionsRemaining: 0, expiryDate: '2027-01-09', paidAmount: 8000 }),
  pkg({ id: 'dhiren', guestName: 'Dhiren Gurung', status: 'expired', sessionsTotal: 6, sessionsRemaining: 1, expiryDate: '2026-09-30', paidAmount: 10500 }),
];
const byId = Object.fromEntries(MOCK.map((p) => [p.id, p]));

describe('package states', () => {
  it('daysUntil counts whole days', () => {
    expect(daysUntil('2026-11-03', TODAY)).toBe(15);
    expect(daysUntil('2026-10-18', TODAY)).toBe(-1);
    expect(daysUntil(null, TODAY)).toBeNull();
  });
  it('live = not started / part used and not past expiry', () => {
    expect(isLive(byId.farah, TODAY)).toBe(true);
    expect(isLive(byId.hema, TODAY)).toBe(true);
    expect(isLive(byId.sana, TODAY)).toBe(false);
    expect(isLive(byId.dhiren, TODAY)).toBe(false);
    // A stale "partially_used" status past its expiry still counts as expired.
    const stale = pkg({ id: 's', expiryDate: '2026-10-18' });
    expect(isExpired(stale, TODAY)).toBe(true);
    expect(isLive(stale, TODAY)).toBe(false);
  });
  it('ends soon is inclusive of today and day 30', () => {
    expect(isEndsSoon(pkg({ id: 'a', expiryDate: TODAY }), TODAY)).toBe(true);
    expect(isEndsSoon(pkg({ id: 'b', expiryDate: '2026-11-18' }), TODAY)).toBe(true); // 30 days
    expect(isEndsSoon(pkg({ id: 'c', expiryDate: '2026-11-19' }), TODAY)).toBe(false); // 31 days
    expect(isEndsSoon(byId.dhiren, TODAY)).toBe(false);
  });
  it('last session needs more than one session in total', () => {
    expect(isLastSession(byId.gaurav, TODAY)).toBe(true);
    expect(isLastSession(pkg({ id: 'single', status: 'unused', sessionsTotal: 1, sessionsRemaining: 1 }), TODAY)).toBe(false);
  });
  it('display status follows the priority order', () => {
    expect(MOCK.map((p) => displayStatus(p, TODAY))).toEqual(['endsSoon', 'lastSession', 'active', 'endsSoon', 'notStarted', 'active', 'active', 'usedUp', 'expired']);
    // Ends soon wins over last session.
    expect(displayStatus(pkg({ id: 'x', sessionsRemaining: 1, expiryDate: '2026-10-25' }), TODAY)).toBe('endsSoon');
  });
});

describe('money and the lead', () => {
  it('owed value = remaining × price per session over live packages', () => {
    // Pari 4×2000 + Gaurav 1×3000 + Farah 5×2000 + Milan 3×2000 + Hema 5×1500 + Nina 6×3000 + Alok 4×1750 = 59,500
    expect(owedValue(MOCK, TODAY)).toBe(59500);
    expect(toCollect(MOCK)).toBe(3000);
  });
  it('guards a package with no sessions and rounds to whole NPR', () => {
    expect(valuePerSession({ sessionsTotal: 0, paidAmount: 100 })).toBeNull();
    expect(valuePerSession({ sessionsTotal: null, paidAmount: 100 })).toBeNull();
    expect(owedValue([pkg({ id: 'r', sessionsTotal: 3, sessionsRemaining: 1, paidAmount: 1000 })], TODAY)).toBe(333);
  });
  it('lead sentence drops the parts that are zero', () => {
    const text = (parts) => parts.map((p) => p.strong || p.text).join('');
    expect(text(leadParts(MOCK, TODAY))).toBe('28 sessions still owed to guests, worth NPR 59,500 prepaid · NPR 3,000 to collect');
    expect(text(leadParts(MOCK.filter((p) => p.id !== 'pari'), TODAY))).not.toContain('to collect');
    expect(text(leadParts([byId.sana, byId.dhiren], TODAY))).toBe('No sessions owed right now.');
    expect(text(leadParts([{ ...byId.sana, dueAmount: 500 }], TODAY))).toBe('NPR 500 to collect');
  });
});

describe('strip and needs-you-now', () => {
  it('strip counts match the mockup', () => {
    const s = stripStats(MOCK, TODAY);
    expect(s.active).toEqual({ count: 7, sub: '28 sessions left', hint: 'Includes 1 not started yet' });
    expect(s.last.count).toBe(1);
    expect(s.ending).toMatchObject({ count: 2, sub: '7 sessions unused' });
    expect(s.usedup.count).toBe(1);
    expect(s.expired).toMatchObject({ count: 1, sub: '1 session lost' });
  });
  it('segments filter (and may overlap)', () => {
    const ids = (seg) => MOCK.filter((p) => SEGMENTS.find((s) => s.id === seg).test(p, TODAY)).map((p) => p.id);
    expect(ids('last')).toEqual(['gaurav']);
    expect(ids('ending')).toEqual(['pari', 'milan']);
    expect(ids('active')).toContain('gaurav');
  });
  it('needs-you-now shows only what has a count', () => {
    const items = needsItems(MOCK, TODAY);
    expect(items.map((i) => i.text)).toEqual(['2 end within 30 days · 7 sessions unused', 'Gaurav K. is on the last session', 'NPR 3,000 due on 1 package']);
    expect(items[1].pkg.id).toBe('gaurav');
    expect(items[0].pkg).toBeNull();
    expect(needsItems([byId.farah], TODAY)).toEqual([]);
    expect(needsItems([byId.gaurav, pkg({ id: 'g2', sessionsTotal: 5, sessionsRemaining: 1 })], TODAY)[0].text).toBe('2 guests on their last session');
  });
  it('shortName', () => {
    expect(shortName('Gaurav Karki')).toBe('Gaurav K.');
    expect(shortName('Madonna')).toBe('Madonna');
  });
});

describe('sort and search', () => {
  it('ends soonest: live by expiry, then used up, then expired', () => {
    expect(sortPackages(MOCK, 'ends', TODAY).map((p) => p.id)).toEqual(['milan', 'pari', 'gaurav', 'alok', 'farah', 'nina', 'hema', 'sana', 'dhiren']);
  });
  it('fewest left keeps used up / expired at the end', () => {
    expect(sortPackages(MOCK, 'fewest', TODAY).slice(0, 2).map((p) => p.id)).toEqual(['gaurav', 'milan']);
    expect(sortPackages(MOCK, 'fewest', TODAY).slice(-2).map((p) => p.id)).toEqual(['sana', 'dhiren']);
  });
  it('guest A–Z and latest sold', () => {
    expect(sortPackages(MOCK, 'guest', TODAY)[0].id).toBe('alok');
    const a = pkg({ id: 'old', issuedDate: '2026-01-01' });
    const b = pkg({ id: 'new', issuedDate: '2026-09-01' });
    expect(sortPackages([a, b], 'latest', TODAY).map((p) => p.id)).toEqual(['new', 'old']);
  });
  it('search matches name, phone (any format), type and service', () => {
    const p = pkg({ id: 'q', guestName: 'Pari Shrestha', guestInfo: '+977 980-000-0040', packageTypeName: 'Swedish · 6 sessions', serviceName: 'Swedish Massage' });
    expect(matchesPackageSearch(p, 'pari')).toBe(true);
    expect(matchesPackageSearch(p, '9800000040')).toBe(true);
    expect(matchesPackageSearch(p, '0040')).toBe(true);
    expect(matchesPackageSearch(p, 'massage')).toBe(true);
    expect(matchesPackageSearch(p, 'hot stone')).toBe(false);
    expect(matchesPackageSearch(p, '')).toBe(true);
  });
});

describe('package types', () => {
  it('validity labels', () => {
    expect(validityLabel(365)).toBe('1 year');
    expect(validityLabel(730)).toBe('2 years');
    expect(validityLabel(180)).toBe('6 months');
    expect(validityLabel(90)).toBe('3 months');
    expect(validityLabel(45)).toBe('45 days');
    expect(validityLabel(null)).toBe('—');
  });
  it('per session and saving vs a single visit', () => {
    expect(perSession({ standard_price: 12000, default_sessions: 6, service: { price_npr: 2500 } })).toEqual({ per: 2000, single: 2500, saves: 20 });
    expect(perSession({ standard_price: 30000, default_sessions: 10, service: { price_npr: 3500 } }).saves).toBe(14);
    expect(perSession({ standard_price: 8000, default_sessions: 4, service: { price_npr: 2000 } }).saves).toBeNull(); // 0%
    expect(perSession({ standard_price: null, default_sessions: 6, service: { price_npr: 2500 } }).per).toBeNull();
    expect(perSession({ standard_price: 8000, default_sessions: null, service: null })).toEqual({ per: null, single: null, saves: null });
  });
  it('active / sold per type', () => {
    expect(typeUsage(MOCK, TODAY).t1).toEqual({ active: 7, sold: 9 });
  });
  it('reminder text', () => {
    expect(reminderText(byId.pari, TODAY, 'Nuad Thai Spa')).toBe('Hi Pari, a friendly reminder from Nuad Thai Spa: your Swedish · 6 sessions package has 4 sessions left and ends in 15 days. Reply here to book your next visit.');
  });
});
