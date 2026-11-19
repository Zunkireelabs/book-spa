import { describe, it, expect } from 'vitest';
import {
  isLowBalance, isEndsSoon, toActivate, perkUsedInCurrentCycle, nextBirthday, isBirthdaySoon, birthdayTag, longDay, displayStatus, stripStats,
  leadParts, needsItems, sortMembers, matchesMemberSearch, discountChips, headlineDiscount, goldTierId, tierStats, activityTotals, rangeFor,
  rangeLabel, rangeLead, whenLabel, SEGMENTS, tierDeposit, reminderText,
} from './membershipsView';

const TODAY = '2026-10-19'; // a Monday
const PREMIUM = { tierId: 'p', tierName: 'Premium Club', tierAdvanceAmount: 100000 };
const DELUXE = { tierId: 'd', tierName: 'Deluxe Club', tierAdvanceAmount: 50000 };
const mem = (o) => ({
  id: o.id, customerName: o.name, customerPhone: o.phone || '+9779811110100', membershipNumber: o.card || 'PC-0001', status: o.status || 'active',
  balance: o.balance ?? 50000, cycleDeposited: o.deposited ?? (o.tier || PREMIUM).tierAdvanceAmount, activationDate: o.activation ?? '2026-06-20',
  expiryDate: o.expiry ?? '2027-06-20', customerDateOfBirth: o.dob || null, birthdayPerkUsedAt: o.perk || null, createdAt: o.created || '2026-06-20T10:00:00Z',
  ...(o.tier || PREMIUM),
});

// The mockup's eight members (temp_ss/mockups/memberships-v1.html).
const MOCK = [
  mem({ id: 'bikash', name: 'Bikash Shah', status: 'pending', balance: 60000, deposited: 60000, activation: null, expiry: null, card: 'PC-0016' }),
  mem({ id: 'rohan', name: 'Rohan Thapa', tier: DELUXE, balance: 31500, expiry: '2026-11-05', card: 'DC-0009' }),
  mem({ id: 'anjali', name: 'Anjali Rana', balance: 12400, expiry: '2027-03-02', card: 'PC-0014' }),
  mem({ id: 'sita', name: 'Sita Gurung', balance: 64200, expiry: '2027-06-20', dob: '1991-10-22', card: 'PC-0011', phone: '+977 981-111-0111' }),
  mem({ id: 'maya', name: 'Maya Lama', tier: DELUXE, balance: 48000, expiry: '2027-10-12', card: 'DC-0012' }),
  mem({ id: 'kiran', name: 'Kiran Joshi', balance: 88900, expiry: '2027-01-14', card: 'PC-0007' }),
  mem({ id: 'prakash', name: 'Prakash KC', tier: DELUXE, status: 'depleted', balance: 0, expiry: '2027-08-08', card: 'DC-0004' }),
  mem({ id: 'asha', name: 'Asha Tamang', status: 'lapsed', balance: 7200, expiry: '2026-09-30', card: 'PC-0003' }),
];
const byId = Object.fromEntries(MOCK.map((m) => [m.id, m]));
const text = (parts) => parts.map((p) => p.strong || p.text).join('');

describe('member states', () => {
  it('low balance is under 15% of the tier deposit, on active wallets only', () => {
    expect(isLowBalance(byId.anjali)).toBe(true); // 12,400 < 15,000
    expect(isLowBalance(byId.kiran)).toBe(false);
    expect(isLowBalance(byId.prakash)).toBe(false); // used up, not low
    expect(isLowBalance(byId.asha)).toBe(false);
    expect(isLowBalance({ ...byId.anjali, tierAdvanceAmount: null, cycleDeposited: 100000 })).toBe(true); // falls back to the cycle deposit
  });
  it('ends soon within 30 days, inclusive', () => {
    expect(isEndsSoon(byId.rohan, TODAY)).toBe(true);
    expect(isEndsSoon({ ...byId.kiran, expiryDate: '2026-11-18' }, TODAY)).toBe(true);
    expect(isEndsSoon({ ...byId.kiran, expiryDate: '2026-11-19' }, TODAY)).toBe(false);
    expect(isEndsSoon(byId.asha, TODAY)).toBe(false);
  });
  it('to activate never goes negative', () => {
    expect(toActivate(byId.bikash)).toBe(40000);
    expect(toActivate({ ...byId.bikash, cycleDeposited: 120000 })).toBe(0);
    expect(toActivate(byId.kiran)).toBe(0);
    expect(tierDeposit(byId.rohan)).toBe(50000);
  });
  it('display status priority', () => {
    expect(MOCK.map((m) => displayStatus(m, TODAY))).toEqual(['pending', 'endsSoon', 'lowBalance', 'active', 'active', 'active', 'usedUp', 'lapsed']);
    expect(displayStatus({ ...byId.anjali, expiryDate: '2026-10-25' }, TODAY)).toBe('endsSoon'); // ends soon beats low balance
  });
});

describe('birthdays', () => {
  it('next birthday, the year wrap and 29 Feb', () => {
    expect(nextBirthday('1991-10-22', TODAY)).toEqual({ date: '2026-10-22', days: 3 });
    expect(nextBirthday('1991-10-19', TODAY)).toEqual({ date: '2026-10-19', days: 0 });
    expect(nextBirthday('1991-10-18', TODAY)).toEqual({ date: '2027-10-18', days: 364 });
    expect(nextBirthday('1990-01-02', '2026-12-28')).toEqual({ date: '2027-01-02', days: 5 });
    expect(nextBirthday('1992-02-29', '2027-02-25').date).toBe('2027-02-28');
    expect(nextBirthday('1992-02-29', '2028-02-25').date).toBe('2028-02-29');
    expect(nextBirthday(null, TODAY)).toBeNull();
  });
  it('birthday soon needs an active wallet, a DOB, and the perk unused this cycle', () => {
    expect(isBirthdaySoon(byId.sita, TODAY)).toBe(true);
    expect(birthdayTag(byId.sita, TODAY)).toBe('Thu');
    expect(birthdayTag({ ...byId.sita, customerDateOfBirth: '1991-10-19' }, TODAY)).toBe('Today');
    expect(isBirthdaySoon({ ...byId.sita, birthdayPerkUsedAt: '2026-10-01T10:00:00Z' }, TODAY)).toBe(false);
    expect(isBirthdaySoon({ ...byId.sita, customerDateOfBirth: '1991-10-27' }, TODAY)).toBe(false); // 8 days
    expect(isBirthdaySoon({ ...byId.asha, customerDateOfBirth: '1991-10-22' }, TODAY)).toBe(false);
    expect(longDay('2026-10-22')).toBe('Thursday, 22 Oct');
  });
  it('perk used only counts inside the current cycle', () => {
    expect(perkUsedInCurrentCycle({ birthdayPerkUsedAt: '2025-10-22T10:00:00Z', activationDate: '2026-06-20', expiryDate: '2027-06-20' })).toBe(false);
    expect(perkUsedInCurrentCycle({ birthdayPerkUsedAt: '2026-10-22T10:00:00Z', activationDate: '2026-06-20', expiryDate: '2027-06-20' })).toBe(true);
    expect(perkUsedInCurrentCycle({ birthdayPerkUsedAt: '2026-10-22T10:00:00Z', activationDate: null })).toBe(false);
  });
});

describe('lead, strip and needs-you-now', () => {
  it('lead matches the mockup and drops zero parts', () => {
    expect(text(leadParts(MOCK))).toBe('NPR 2,45,000 held in 5 active wallets · NPR 40,000 to collect to activate 1 membership');
    expect(text(leadParts(MOCK.filter((m) => m.id !== 'bikash')))).toBe('NPR 2,45,000 held in 5 active wallets');
    expect(text(leadParts([byId.bikash]))).toBe('NPR 40,000 to collect to activate 1 membership');
    expect(text(leadParts([byId.prakash]))).toBe('No wallets to look after right now.');
  });
  it('strip matches the mockup', () => {
    const s = stripStats(MOCK, TODAY);
    expect(s.active).toEqual({ count: 5, sub: 'NPR 2,45,000 in wallets' });
    expect(s.pending).toEqual({ count: 1, sub: 'NPR 40,000 to collect' });
    expect(s.low.count).toBe(1);
    expect(s.ending).toEqual({ count: 1, sub: 'NPR 31,500 unused' });
    expect(s.ended.count).toBe(2);
    const ids = (seg) => MOCK.filter((m) => SEGMENTS.find((x) => x.id === seg).test(m, TODAY)).map((m) => m.id);
    expect(ids('ended')).toEqual(['prakash', 'asha']);
    expect(ids('active')).toContain('anjali'); // overlap is intended
  });
  it('needs-you-now', () => {
    const items = needsItems(MOCK, TODAY);
    expect(items.map((i) => i.text)).toEqual(['Bikash S. needs NPR 40,000 to activate', 'Rohan T. ends in 17 days', "Sita G.'s birthday is Thu · gift unused"]);
    expect(items.map((i) => i.member?.id)).toEqual(['bikash', 'rohan', 'sita']);
    const two = needsItems([byId.bikash, { ...byId.bikash, id: 'b2', customerName: 'Other Person' }], TODAY);
    expect(two[0]).toMatchObject({ text: '2 need NPR 80,000 to activate', member: null });
    expect(needsItems([byId.maya], TODAY)).toEqual([]);
  });
});

describe('sort and search', () => {
  it('needs attention: pending, ends soon, low, active by expiry, then ended', () => {
    expect(sortMembers(MOCK, 'attention', TODAY).map((m) => m.id)).toEqual(['bikash', 'rohan', 'anjali', 'kiran', 'sita', 'maya', 'asha', 'prakash']);
  });
  it('other sorts', () => {
    expect(sortMembers(MOCK, 'balance', TODAY)[0].id).toBe('kiran');
    expect(sortMembers(MOCK, 'name', TODAY)[0].id).toBe('anjali');
    expect(sortMembers(MOCK, 'ends', TODAY).slice(-2).map((m) => m.id)).toEqual(['asha', 'prakash']);
    expect(sortMembers(MOCK, 'ends', TODAY)[0].id).toBe('rohan');
  });
  it('search by name, card or phone in any format', () => {
    expect(matchesMemberSearch(byId.sita, 'sita')).toBe(true);
    expect(matchesMemberSearch(byId.sita, 'pc-0011')).toBe(true);
    expect(matchesMemberSearch(byId.sita, '9811110111')).toBe(true);
    expect(matchesMemberSearch(byId.sita, '+977 981-111-0111')).toBe(true);
    expect(matchesMemberSearch(byId.sita, 'maya')).toBe(false);
  });
});

describe('tiers and discounts', () => {
  const RULES = { spa: 45, salon: 25, package: 10, body_scrub: 30 };
  it('chips sorted by %, pretty labels, headline', () => {
    expect(discountChips(RULES).map((c) => `${c.label} ${c.pct}%`)).toEqual(['Spa 45%', 'Body scrub 30%', 'Salon 25%', 'Packages 10%']);
    expect(headlineDiscount(RULES)).toBe('45% off spa');
    expect(headlineDiscount({})).toBe('');
    expect(discountChips({ spa: 0, salon: 'x' })).toEqual([]);
  });
  it('gold tier is the one with the highest deposit', () => {
    expect(goldTierId([{ id: 'd', advance_amount: 50000 }, { id: 'p', advance_amount: '100000' }])).toBe('p');
    expect(goldTierId([])).toBeNull();
  });
  it('per-tier members and money', () => {
    const s = tierStats(MOCK);
    expect(s.p).toEqual({ active: 3, total: 5, held: 60000 + 12400 + 64200 + 88900 + 7200, collected: 60000 + 4 * 100000 });
    expect(s.d).toEqual({ active: 2, total: 3, held: 31500 + 48000, collected: 150000 });
  });
});

describe('wallet activity', () => {
  it('totals: deposits added, deductions spent, adjustments neither', () => {
    expect(activityTotals([{ kind: 'deposit', amount: 60000 }, { kind: 'deduction', amount: -5500 }, { kind: 'adjustment', amount: 1200 }, { kind: 'birthday_perk', amount: 0 }]))
      .toEqual({ added: 60000, spent: 5500 });
  });
  it('ranges', () => {
    expect(rangeFor('month', TODAY)).toEqual({ from: '2026-10-01', to: TODAY });
    expect(rangeFor('last-month', TODAY)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(rangeFor('last-month', '2026-01-10')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(rangeFor('7d', TODAY)).toEqual({ from: '2026-10-13', to: TODAY });
    expect(rangeFor('year', TODAY)).toEqual({ from: '2026-01-01', to: TODAY });
    expect(rangeLabel('month', '2026-10-01', TODAY)).toBe('This month · Oct 2026');
    expect(rangeLabel('custom', '2026-10-01', '2026-10-12')).toBe('1–12 Oct 2026');
    expect(rangeLead('month', '2026-10-01', TODAY)).toBe('October so far');
    expect(rangeLead('last-month', '2026-09-01', '2026-09-30')).toBe('September');
  });
  it('when labels in Nepal time', () => {
    expect(whenLabel('2026-10-19T08:29:00Z', TODAY)).toMatchObject({ day: 'Today', time: '2:14pm' });
    expect(whenLabel('2026-10-18T19:00:00Z', TODAY).day).toBe('Today'); // 00:45 on the 19th in Nepal
    expect(whenLabel('2026-10-18T12:55:00Z', TODAY)).toMatchObject({ day: 'Yesterday', time: '6:40pm' });
    expect(whenLabel('2026-10-16T11:45:00Z', TODAY).day).toBe('16 Oct');
    expect(whenLabel('2025-10-16T11:45:00Z', TODAY).day).toBe('16 Oct 2025');
  });
  it('reminder text', () => {
    expect(reminderText(byId.rohan, TODAY, 'Nuad Thai Spa')).toBe('Hi Rohan, a friendly reminder from Nuad Thai Spa: your Deluxe Club ends in 17 days with NPR 31,500 still in your wallet. Reply here to book a visit and use it.');
  });
});

describe('extension note', () => {
  it('turns the RPC note into a date', async () => {
    const { extensionNote } = await import('./membershipsView');
    expect(extensionNote('Membership reactivated -- validity extended to 2027-10-19, balance preserved.')).toBe('Valid until 19 Oct 2027');
    expect(extensionNote('Manual note')).toBe('Manual note');
    expect(extensionNote(null)).toBe('');
  });
});
