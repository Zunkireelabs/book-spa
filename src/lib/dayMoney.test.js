import { describe, it, expect } from 'vitest';
import { foldDayMoney, addTender, isTendered, methodLabel, canonicalMode, dayMoneyView } from './dayMoney';

// Same fixture as supabase/tests/znly-232.sql (the SQL rule, get_dashboard): the Nuad Smoke case, cash was shown as 100 while the drawer held 900.
//   booking: Cash 100 (+ Cash 70 on a booking dated ANOTHER day, paid today: counts today), Khalti 300, Membership 200 (wallet) | products: Cash 800, Esewa 100, Membership 50 (wallet) | refunds 40 + 150
const FIXTURE_TENDERS = [['Cash', 100], ['Cash', 70], ['Khalti', 300], ['Membership', 200], ['Cash', 800], ['Esewa', 100], ['Membership', 50], ['SessionPackage', 70]];
const REFUNDS = 40 + 150;

describe('dayMoney: the one money-today rule (ZNLY-232)', () => {
  const byMode = {};
  FIXTURE_TENDERS.forEach(([m, a]) => addTender(byMode, m, a));
  const day = foldDayMoney({ byMode, refunds: REFUNDS });

  it('matches the SQL test numbers', () => {
    expect(Object.fromEntries(day.byMethod.map((r) => [r.method, r.amount]))).toEqual({ Cash: 970, Khalti: 300, Esewa: 100 });
    expect(day.moneyIn).toBe(1370);
    expect(day.refunds).toBe(190);
    expect(day.taken).toBe(1180);
    expect(day.cashExpected).toBe(780);
  });

  it('the rows add up: methods - refunds = taken', () => {
    expect(day.byMethod.reduce((s, r) => s + r.amount, 0) - day.refunds).toBe(day.taken);
  });

  it('dashboard (SQL by_method shape), Close card and Daily Reconciliation agree on the same day', () => {
    const sqlShape = { Cash: 970, Khalti: 300, Esewa: 100 };                       // get_dashboard money.by_method
    const closeCard = foldDayMoney({ byMode: sqlShape, refunds: 190 });             // BranchView Close card
    const reconciliation = foldDayMoney({ byMode: { ...byMode }, refunds: 190 });   // getDailySummary.byMode (wallet modes can never get in)
    for (const f of ['taken', 'cashExpected', 'refunds', 'moneyIn']) expect(closeCard[f]).toBe(reconciliation[f]);
    expect(closeCard.byMethod).toEqual(reconciliation.byMethod);
  });

  it('wallet / voucher-balance / package tenders are never money in', () => {
    ['Membership', 'ReferralWallet', 'VoucherWallet', 'ReferralVoucher', 'SessionPackage', '', null].forEach((m) => expect(isTendered(m)).toBe(false));
    ['Cash', 'Card', 'Khalti', 'Nabil Card'].forEach((m) => expect(isTendered(m)).toBe(true));
    expect(foldDayMoney({ byMode: { Membership: 500 } }).moneyIn).toBe(0);
  });

  it('shows real method names, no Fonepay / bank hardcoding', () => {
    expect(methodLabel('Khalti')).toBe('Khalti');
    expect(methodLabel('Nabil Card')).toBe('Nabil Card');
    expect(methodLabel('MobileBanking')).toBe('Mobile banking');
    expect(day.byMethod.map((r) => r.label)).toEqual(['Cash', 'Khalti', 'eSewa']);
  });

  it('refunds with no sales: cash expected goes negative rather than hiding the hand-back', () => {
    const d = foldDayMoney({ byMode: {}, refunds: 100 });
    expect(d.taken).toBe(-100);
    expect(d.cashExpected).toBe(-100);
  });

  it('Nuad Smoke 17 Nov: Cash 4,900 + Khalti 1,500 - refunds 3,000 = taken 3,400, cash expected 1,900 (refund taken once)', () => {
    const m = {};
    [['Cash', 3000], ['Cash', 100], ['Cash', 1000], ['Khalti', 1500], ['Cash', 800]].forEach(([k, a]) => addTender(m, k, a));  // 3 booking cash + khalti + product cash
    const d = foldDayMoney({ byMode: m, refunds: 3000 });
    expect(Object.fromEntries(d.byMethod.map((r) => [r.method, r.amount]))).toEqual({ Cash: 4900, Khalti: 1500 });
    expect(d.refunds).toBe(3000);
    expect(d.taken).toBe(3400);
    expect(d.cashExpected).toBe(1900);
  });

  it('mixed-case modes fold into one row (seed wrote lowercase "cash")', () => {
    expect(canonicalMode('cash')).toBe('Cash');
    expect(canonicalMode('Nabil Card')).toBe('Nabil Card');
    const d = foldDayMoney({ byMode: { Cash: 25750, cash: 1500, Khalti: 100 }, refunds: 2500 });
    expect(d.byMethod.map((r) => r.method)).toEqual(['Cash', 'Khalti']);
    expect(d.cashExpected).toBe(24750);
    expect(foldDayMoney({ byMode: { membership: 9 } }).moneyIn).toBe(0);
  });

  it('ZNLY-248: cash, "CASH ", eSewa/Esewa and membership/Membership each fold to one canonical mode', () => {
    ['cash', 'CASH ', 'Cash'].forEach((m) => expect(canonicalMode(m)).toBe('Cash'));
    ['eSewa', 'Esewa', 'ESEWA'].forEach((m) => expect(canonicalMode(m)).toBe('Esewa'));
    ['membership', 'Membership'].forEach((m) => expect(canonicalMode(m)).toBe('Membership'));
    const d = foldDayMoney({ byMode: { eSewa: 76628, Esewa: 23400, membership: 4200, Membership: 100 } });
    expect(d.byMethod).toEqual([{ method: 'Esewa', label: 'eSewa', amount: 100028 }]);
  });
});

describe('closed day: at close / after close / now never mix (ZNLY-234, Nuad 17 Nov)', () => {
  // closed at 5:56 pm with Cash 11,300 + Khalti 2,700 - refunds 3,000; then 2,000 cash collected after close
  const closedDay = {
    isClosed: true,
    byMode: { Cash: 13300, Khalti: 2700 }, refunds: 3000,               // LIVE (cash-day) figures
    afterClose: { amount: 2000, cash: 2000 },
    atClose: { byMode: { Cash: 11300, Khalti: 2700 }, refunds: 3000, closedAt: '2026-11-17T12:11:00Z' },
  };
  it('the cards and rows at close add up: Taken 11,000, cash expected 8,300', () => {
    const v = dayMoneyView(closedDay);
    expect(v.closed).toBe(true);
    expect(v.headline.moneyIn).toBe(14000);
    expect(v.at.refunds).toBe(3000);
    expect(v.at.taken).toBe(11000);
    expect(v.at.cashExpected).toBe(8300);
    expect(v.at.byMethod.reduce((s, r) => s + r.amount, 0) - v.at.refunds).toBe(v.headline.taken);
  });
  it('after close: +2,000 (cash 2,000); now: taken 13,000, cash in the drawer 10,300; now = at close + after', () => {
    const v = dayMoneyView(closedDay);
    expect(v.after).toEqual({ amount: 2000, cash: 2000 });
    expect(v.now.taken).toBe(13000);
    expect(v.now.cashExpected).toBe(10300);
    expect(v.now.taken).toBe(v.at.taken + v.after.amount);
    expect(v.now.cashExpected).toBe(v.at.cashExpected + v.after.cash);
  });
  it('an open day (or a closed day without at-close rows) is one set of live figures', () => {
    const open = dayMoneyView({ isClosed: false, byMode: { Cash: 100 }, refunds: 10 });
    expect(open.closed).toBe(false);
    expect(open.headline.taken).toBe(90);
    expect(dayMoneyView({ isClosed: true, atClose: null, byMode: { Cash: 5 }, refunds: 0 }).closed).toBe(false);
  });
});
