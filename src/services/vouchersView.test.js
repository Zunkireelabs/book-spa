import { describe, it, expect } from 'vitest';
import {
  statusOf, isReady, stripStats, visibleSegments, leadParts, monthTotals, needsItems, sortVouchers, matchesVoucherSearch, normCode, forPhone,
  buyerPhoneOf, reminderText, remindedHint, remindedRecently, validLine, usedBy, extendBase, EXTEND_CHIPS, VALID_CHIPS, typeStats, handedOutSub,
  buildActivity, activityTotals, activityWhen, freeReasonLabel, SEGMENTS,
} from './vouchersView';

const TODAY = '2026-10-19'; // a Monday
const v = (o) => ({
  id: o.id, voucherCode: o.code || `NT 4326-${o.id}`, guestName: o.name || 'Guest', guestInfo: o.info ?? null, customerId: o.cid || null,
  customerPhone: o.cphone || null, buyerName: o.buyer || null, buyerPhone: o.bphone || null, buyerCustomerId: null, buyerCustomerPhone: o.bcphone || null,
  voucherTypeId: o.type || 't-oil', voucherTypeName: o.typeName || 'Full Body Oil Massage · 60 min', branchId: o.branch || 'b1', branchName: 'Lazimpat',
  issuedDate: o.issued || '2026-07-01', createdAt: `${o.issued || '2026-07-01'}T08:00:00Z`, expiryDate: o.expiry || '2027-01-18',
  totalAmountIssued: o.value ?? 4200, remainingBalance: o.left ?? (o.value ?? 4200), totalClaimed: o.claimed ?? 0, amountPaid: o.paid ?? (o.value ?? 4200),
  issueKind: o.kind || 'sold', freeReason: o.reason || null, percentOff: o.pct ?? null, couponUsed: !!o.couponUsed, needsCheck: !!o.check,
  lastRemindedAt: o.reminded || null, discountPercent: o.disc || 0,
});

// The mockup's list rows (temp_ss/mockups/vouchers-v3.html ?s=list).
const MOCK = [
  v({ id: 'hari', name: 'Hari Adhikari', buyer: 'Sunita Adhikari', bphone: '+977 984-771-0420', value: 5000, left: 1900, claimed: 3100, paid: 4500, disc: 10, expiry: '2026-10-28' }),
  v({ id: 'nisha', name: 'Nisha Karki', info: '+977 984-120-3311', value: 5800, expiry: '2026-11-02', reminded: '2026-10-17T06:00:00Z' }),
  v({ id: 'bikram', name: 'Bikram Thapa', info: '+977 980-221-4410', value: 2000, kind: 'free', paid: 0, check: true, expiry: '2026-11-30' }),
  v({ id: 'gita', name: 'Gita Maharjan', info: '+977 981-404-1180', value: 2000, left: 1200, claimed: 800, expiry: '2026-10-03' }),
  v({ id: 'anita', name: 'Anita Gurung', info: '+977 986-112-7781', value: 0, left: 0, paid: 0, kind: 'free', pct: 25, expiry: '2026-12-15', typeName: '25% Discount Voucher', type: 't-25' }),
  v({ id: 'pooja', name: 'Pooja Shrestha', info: '+977 980-555-0187', value: 10000, left: 6500, claimed: 3500, expiry: '2027-03-14' }),
  v({ id: 'sabina', name: 'Sabina Lama', info: 'Corporate · Himal Bank', value: 4200, kind: 'free', paid: 0, reason: 'corporate', expiry: '2027-01-18', issued: '2026-10-18' }),
  v({ id: 'ramesh', name: 'Ramesh Bhandari', info: '+977 985-101-2290', value: 2400, paid: 2040, disc: 15, expiry: '2027-01-10', issued: '2026-10-12' }),
  v({ id: 'suman', name: 'Suman Thapa', value: 4200, left: 0, claimed: 4200, expiry: '2026-12-01' }),
];
const byId = Object.fromEntries(MOCK.map((x) => [x.id, x]));
const text = (parts) => parts.map((p) => p.strong || p.text).join('');

describe('status', () => {
  it('matches the mockup rows, in priority order', () => {
    expect(MOCK.map((x) => statusOf(x, TODAY))).toEqual(['soon', 'soon', 'check', 'expired', 'unused', 'part', 'unused', 'unused', 'usedUp']);
  });
  it('needs a check wins over everything; valid through the expiry date', () => {
    expect(statusOf({ ...byId.gita, needsCheck: true }, TODAY)).toBe('check');
    expect(statusOf({ ...byId.pooja, expiryDate: TODAY }, TODAY)).toBe('soon');
    expect(statusOf({ ...byId.pooja, expiryDate: '2026-10-18' }, TODAY)).toBe('expired');
    expect(statusOf({ ...byId.pooja, expiryDate: '2026-11-18' }, TODAY)).toBe('soon'); // 30 days, inclusive
    expect(statusOf({ ...byId.pooja, expiryDate: '2026-11-19' }, TODAY)).toBe('part');
  });
  it('coupons: used / expired / expiring / not used yet', () => {
    expect(statusOf({ ...byId.anita, couponUsed: true }, TODAY)).toBe('used');
    expect(statusOf({ ...byId.anita, expiryDate: '2026-10-01' }, TODAY)).toBe('expired');
    expect(statusOf({ ...byId.anita, expiryDate: '2026-10-30' }, TODAY)).toBe('soon');
    expect(statusOf({ ...byId.suman, left: 0 }, TODAY)).toBe('usedUp'); // used up beats expiry for value vouchers
    expect(statusOf({ ...byId.suman, expiryDate: '2026-01-01' }, TODAY)).toBe('usedUp');
  });
  it('ready = not expired, not needing a check, something left', () => {
    expect(MOCK.filter((x) => isReady(x, TODAY)).map((x) => x.id)).toEqual(['hari', 'nisha', 'anita', 'pooja', 'sabina', 'ramesh']);
    expect(isReady({ ...byId.anita, couponUsed: true }, TODAY)).toBe(false);
  });
});

describe('strip and lead', () => {
  it('strip counts and sub-lines', () => {
    const s = stripStats(MOCK, TODAY);
    expect(s.ready).toEqual({ count: 6, sub: 'NPR 20,800 + 1 coupon' }); // 1,900 + 5,800 + 6,500 + 4,200 + 2,400
    expect(s.expiring).toEqual({ count: 2, sub: 'NPR 7,700' });
    expect(s.check.count).toBe(1);
    expect(s.expired).toEqual({ count: 1, sub: 'NPR 1,200' });
    expect(s.usedUp.count).toBe(1);
  });
  it('the Needs a check segment hides at 0', () => {
    expect(visibleSegments(MOCK).map((x) => x.id)).toEqual(SEGMENTS.map((x) => x.id));
    expect(visibleSegments(MOCK.filter((x) => !x.needsCheck)).map((x) => x.id)).not.toContain('check');
  });
  it('lead: owed on N vouchers and M coupons · this month sold (paid) and given free (value)', () => {
    expect(monthTotals(MOCK, TODAY)).toEqual({ sold: 2040, free: 4200 });
    expect(text(leadParts(MOCK, TODAY))).toBe('NPR 20,800 still owed to guests on 5 vouchers and 1 coupon · this month NPR 2,040 sold, NPR 4,200 given free');
  });
  it('lead drops parts that are 0', () => {
    const noMonth = MOCK.map((x) => ({ ...x, issuedDate: '2026-07-01' }));
    expect(text(leadParts(noMonth, TODAY))).toBe('NPR 20,800 still owed to guests on 5 vouchers and 1 coupon');
    expect(text(leadParts([byId.anita], TODAY))).toBe('1 coupon ready to use');
    expect(text(leadParts([byId.suman], TODAY))).toBe('No vouchers to look after right now.');
    expect(text(leadParts([{ ...byId.sabina, expiryDate: '2026-01-01' }], TODAY))).toBe('This month NPR 4,200 given free');
  });
});

describe('needs you now', () => {
  const matches = new Map([['gita', { customerId: 'c1', customerName: 'Gita Maharjan' }]]);
  it('check → remind (not reminded in 7 days) → extend (admin) → link, max 3', () => {
    const items = needsItems(MOCK, TODAY, { isAdmin: true, matches });
    expect(items.map((i) => i.id)).toEqual(['check', 'remind', 'extend']);
    expect(items[0].text).toBe('1 free voucher from before the update');
    expect(items[1].text).toBe('Hari A. · NPR 1,900 · 9 days left'); // Nisha was reminded 2 days ago
    expect(items[1].voucher.id).toBe('hari');
    expect(items[2].text).toBe('Gita M. · NPR 1,200 expired 3 Oct');
  });
  it('managers do not see Extend; Link fills the slot', () => {
    const items = needsItems(MOCK, TODAY, { isAdmin: false, matches });
    expect(items.map((i) => i.id)).toEqual(['check', 'remind', 'match']);
    expect(items[2].text).toBe("Gita M.'s phone matches Gita Maharjan");
  });
  it('several vouchers → a filter item; a reminder older than 7 days counts again', () => {
    const list = [byId.hari, { ...byId.nisha, lastRemindedAt: '2026-10-12T06:00:00Z' }];
    const it = needsItems(list, TODAY)[0];
    expect(it).toMatchObject({ id: 'remind', voucher: null, text: '2 expire within 14 days · NPR 7,700' });
  });
  it('unused coupons are reminded and extended like vouchers; used coupons and needs-check vouchers never are', () => {
    const soon = { ...byId.anita, expiryDate: '2026-10-25' };
    expect(needsItems([soon], TODAY)).toMatchObject([{ id: 'remind', voucher: soon, text: 'Anita G. · 25% off · 6 days left' }]);
    expect(needsItems([soon, byId.hari], TODAY)[0].text).toBe('2 expire within 14 days · NPR 1,900 + 1 coupon');
    expect(needsItems([{ ...soon, couponUsed: true }], TODAY)).toEqual([]);
    const lapsed = { ...byId.anita, expiryDate: '2026-10-10' };
    expect(needsItems([lapsed], TODAY, { isAdmin: true })).toMatchObject([{ id: 'extend', text: 'Anita G. · 25% off expired 10 Oct' }]);
    expect(needsItems([{ ...lapsed, couponUsed: true }], TODAY, { isAdmin: true })).toEqual([]);
    expect(needsItems([{ ...byId.gita, needsCheck: true }], TODAY, { isAdmin: true }).map((i) => i.id)).toEqual(['check']);
  });
});

describe('sort and search', () => {
  it('needs attention: expiring, check, recently expired, live by expiry, older expired, used', () => {
    const old = v({ id: 'old', value: 2000, expiry: '2026-06-01' });
    const list = [...MOCK, old];
    expect(sortVouchers(list, 'attention', TODAY).map((x) => x.id)).toEqual(['hari', 'nisha', 'bikram', 'gita', 'anita', 'ramesh', 'sabina', 'pooja', 'old', 'suman']);
  });
  it('other sorts', () => {
    expect(sortVouchers(MOCK, 'value', TODAY)[0].id).toBe('pooja');
    expect(sortVouchers(MOCK, 'latest', TODAY)[0].id).toBe('sabina');
    expect(sortVouchers(MOCK, 'name', TODAY)[0].id).toBe('anita');
    const exp = sortVouchers(MOCK, 'expiring', TODAY).map((x) => x.id);
    expect(exp.slice(0, 2)).toEqual(['hari', 'nisha']);
    expect(exp.slice(-2).sort()).toEqual(['gita', 'suman']); // ended last
  });
  it('search: code ignoring case/spaces/dashes/brackets, names, phone (+977), type', () => {
    const hari = { ...byId.hari, voucherCode: 'NTWV(5K) 4326-0031' };
    expect(normCode('NTWV(5K) 4326-0031')).toBe('ntwv5k43260031');
    expect(matchesVoucherSearch(hari, 'ntwv5k 43260031')).toBe(true);
    expect(matchesVoucherSearch(hari, '4326-0031')).toBe(true);
    expect(matchesVoucherSearch(hari, 'sunita')).toBe(true);
    expect(matchesVoucherSearch(hari, '9847710420')).toBe(true);
    expect(matchesVoucherSearch(byId.nisha, '+977-984-120')).toBe(true);
    expect(matchesVoucherSearch(byId.anita, '25% discount')).toBe(true);
    expect(matchesVoucherSearch(byId.nisha, 'sunita')).toBe(false);
  });
});

describe('reminders', () => {
  it('phone: linked customer → stored phone (≥ 10 digits) → none', () => {
    expect(forPhone(byId.nisha)).toBe('+977 984-120-3311');
    expect(forPhone({ ...byId.nisha, customerPhone: '+9779800000001' })).toBe('+9779800000001');
    expect(forPhone(byId.sabina)).toBe(null); // company text, not a phone
    expect(forPhone(byId.hari)).toBe(null);
    expect(buyerPhoneOf(byId.hari)).toBe('+977 984-771-0420');
  });
  it('one template for For and Bought by', () => {
    const opts = { orgName: 'Nuad Thai Spa', bookUrl: 'https://app.zennly.io/nuad-thai-spa/book' };
    const hari = { ...byId.hari, voucherCode: 'NTWV(5K) 4326-0031' };
    expect(reminderText(hari, opts)).toBe('Hi Hari, your Nuad Thai Spa voucher NTWV(5K) 4326-0031 has NPR 1,900 left and is valid until 28 Oct 2026. Book here: https://app.zennly.io/nuad-thai-spa/book');
    expect(reminderText(hari, { ...opts, to: 'buyer' })).toBe('Hi Sunita, the Nuad Thai Spa voucher you gave Hari Adhikari (NTWV(5K) 4326-0031) has NPR 1,900 left and is valid until 28 Oct 2026. Book here: https://app.zennly.io/nuad-thai-spa/book');
    expect(reminderText(byId.anita, opts)).toContain('has 25% off one visit and is valid until 15 Dec 2026');
  });
  it('reminded hint for 7 days (Nepal dates)', () => {
    expect(remindedHint(byId.nisha, TODAY)).toBe('reminded Sat');
    expect(remindedHint({ ...byId.nisha, lastRemindedAt: '2026-10-19T03:00:00Z' }, TODAY)).toBe('reminded today');
    expect(remindedHint({ ...byId.nisha, lastRemindedAt: '2026-10-11T06:00:00Z' }, TODAY)).toBe('');
    expect(remindedRecently({ ...byId.nisha, lastRemindedAt: '2026-10-12T20:00:00Z' }, TODAY)).toBe(true); // 13 Oct in Nepal
  });
});

describe('panel bits', () => {
  it('valid line tone', () => {
    expect(validLine(byId.hari, TODAY)).toEqual({ text: 'Valid until 28 Oct · 9 days', tone: 'amber' });
    expect(validLine(byId.gita, TODAY)).toEqual({ text: 'Expired 3 Oct', tone: 'red' });
    expect(validLine(byId.pooja, TODAY)).toEqual({ text: 'Valid until 14 Mar 2027', tone: '' });
  });
  it('used by: distinct names with visits, legacy closes left out', () => {
    expect(usedBy([
      { guest_name_used_by: 'Hari', redeemed_date: '2026-10-17' },
      { guest_name_used_by: 'hari ', redeemed_date: '2026-09-01' },
      { guest_name_used_by: 'Sunita', redeemed_date: '2026-08-01' },
      { guest_name_used_by: 'Old', redeemed_date: '2026-10-18', is_legacy: true },
    ])).toEqual([{ name: 'Hari', visits: 2, last: '2026-10-17' }, { name: 'Sunita', visits: 1, last: '2026-08-01' }]);
  });
  it('extend chips count from today, or from a future expiry', () => {
    expect(extendBase(byId.gita, TODAY)).toBe(TODAY);
    expect(EXTEND_CHIPS.find((c) => c.id === '30d').next(extendBase(byId.gita, TODAY))).toBe('2026-11-18');
    expect(extendBase(byId.hari, TODAY)).toBe('2026-10-28');
    expect(EXTEND_CHIPS.find((c) => c.id === '6m').next('2026-08-31')).toBe('2027-02-28');
    expect(VALID_CHIPS.find((c) => c.id === '90').next(TODAY)).toBe('2027-01-17');
  });
  it('free reason label', () => {
    expect(freeReasonLabel('corporate')).toBe('Corporate gift');
    expect(freeReasonLabel(null)).toBe('reason not recorded');
  });
});

describe('types', () => {
  it('handed out and still owed per type', () => {
    const s = typeStats(MOCK, TODAY);
    expect(s['t-oil']).toEqual({ total: 8, sold: 6, free: 2, owed: 20800, openCoupons: 0 });
    expect(s['t-25']).toEqual({ total: 1, sold: 0, free: 1, owed: 0, openCoupons: 1 });
    expect(handedOutSub(s['t-oil'])).toBe('6 sold · 2 free');
    expect(handedOutSub(undefined)).toBe('none yet');
  });
});

describe('activity', () => {
  const vouchers = [
    { ...byId.ramesh, issuedById: 'u1', issuedByName: 'Ritu M', paymentModes: ['Card'], createdAt: '2026-10-12T05:35:00Z' },
    { ...byId.sabina, issuedById: 'u1', issuedByName: 'Ritu M', freeNote: 'Himal Bank', createdAt: '2026-10-18T11:30:00Z' },
  ];
  const claims = [
    { id: 'c1', voucherId: 'pooja', guestName: 'Pooja', code: 'X', redeemedDate: '2026-10-19', createdAt: '2026-10-19T08:55:00Z', amountClaimed: 3500, service: 'Hot Stone Therapy', bookingNumber: 'BK-1', atCheckout: true },
    { id: 'c2', voucherId: 'old', guestName: 'Sarita', code: 'Y', redeemedDate: '2026-10-14', createdAt: '2026-10-14T10:33:00Z', amountClaimed: 4200, isLegacy: true },
    { id: 'c3', voucherId: 'old2', guestName: 'Ram', code: 'Z', redeemedDate: '2026-10-10', createdAt: '2026-10-13T10:00:00Z', amountClaimed: 500 },
  ];
  const events = [
    { id: 'e1', kind: 'extended', voucherId: 'pooja', createdAt: '2026-10-05T04:25:00Z', newExpiry: '2027-03-14', oldExpiry: '2026-12-14', note: 'guest was abroad' },
    { id: 'e2', kind: 'legacy_checked_valid', voucherId: 'prabin', createdAt: '2026-10-14T10:35:00Z' },
    { id: 'e3', kind: 'legacy_checked_valid', voucherId: 'undone', createdAt: '2026-10-14T10:36:00Z' },
    { id: 'e4', kind: 'legacy_check_undone', voucherId: 'undone', createdAt: '2026-10-14T10:40:00Z' },
    { id: 'e5', kind: 'coupon_used', voucherId: 'anita', percentOff: 25, bookingNumber: 'BK-9', createdAt: '2026-10-09T09:25:00Z' },
    { id: 'e6', kind: 'reminded', voucherId: 'hari', createdAt: '2026-10-09T09:25:00Z' },
  ];
  const corrections = [{ id: 'a1', voucherId: 'pooja', changedAt: '2026-10-02T04:00:00Z', oldTotal: 10000, newTotal: 9000, reason: 'typo at sale' }];
  const rows = buildActivity({ vouchers, claims, events, corrections });

  it('every kind, newest first; undone checks and reminders are left out', () => {
    expect(rows.map((r) => r.kind)).toEqual(['redeemed', 'free', 'checked', 'checked', 'sold', 'redeemed', 'coupon', 'extended', 'corrected']);
    expect(rows.find((r) => r.id === 'c:c1')).toMatchObject({ amount: -3500, detail: 'Hot Stone Therapy · BK-1 · at checkout' });
    expect(rows.find((r) => r.id === 'c:c2')).toMatchObject({ kind: 'checked', amount: -4200, detail: 'Already used · closed for NPR 4,200' });
    expect(rows.find((r) => r.kind === 'sold')).toMatchObject({ amount: 2400, paid: 2040, detail: 'Paid NPR 2,040 by Card · 15% off' });
    expect(rows.find((r) => r.kind === 'free')).toMatchObject({ amount: 4200, paid: 0, detail: 'Corporate gift · Himal Bank' });
    expect(rows.find((r) => r.kind === 'extended').detail).toBe('Valid until 14 Mar 2027 (was 14 Dec) · "guest was abroad"');
    expect(rows.find((r) => r.kind === 'coupon').detail).toBe('25% off · marked used by hand · BK-9');
    expect(rows.find((r) => r.kind === 'corrected')).toMatchObject({ amount: -1000, detail: 'Value NPR 10,000 → NPR 9,000 · "typo at sale"' });
  });
  it('totals: money sold, value given free, value redeemed (legacy is not redeemed)', () => {
    expect(activityTotals(rows)).toEqual({ sold: 2040, free: 4200, redeemed: 4000 });
  });
  it('time shows only when the timestamp falls on the row date', () => {
    expect(activityWhen(rows[0], TODAY)).toEqual({ day: 'Today', time: '2:40pm' });
    expect(activityWhen(rows.find((r) => r.id === 'c:c3'), TODAY)).toEqual({ day: '10 Oct', time: '' }); // claim entered 3 days later
    expect(activityWhen(rows.find((r) => r.kind === 'free'), TODAY)).toEqual({ day: 'Yesterday', time: '5:15pm' });
  });
});
