import { describe, it, expect } from 'vitest';
import { closeDayBlock, unpaidCloseWarning, isUnfinished } from './closeDay';
import { cardModeNames, bucketForMode, DEFAULT_PAYMENT_METHODS } from '../services/paymentMethods';

describe('Close Day is refused while a booking is unfinished (ZNLY-234)', () => {
  const row = (n, status) => ({ bookingId: `id${n}`, bookingNumber: `BK-${n}`, customerName: `C${n}`, status });

  it('blocks on Pending / Confirmed / In-Progress and lists them', () => {
    const r = closeDayBlock([row(1, 'Confirmed'), row(2, 'Completed'), row(3, 'Pending'), row(4, 'In-Progress'), row(5, 'Cancelled'), row(6, 'No Show')]);
    expect(r.blocked).toBe(true);
    expect(r.count).toBe(3);
    expect(r.rows.map((x) => x.bookingNumber)).toEqual(['BK-1', 'BK-3', 'BK-4']);
    expect(r.message).toMatch(/3 bookings are still Pending, Confirmed or In-Progress/);
  });
  it('singular wording for one booking', () => {
    expect(closeDayBlock([row(1, 'Confirmed')]).message).toMatch(/^1 booking is still/);
  });
  it('a day of finished bookings (even with balances) is not blocked', () => {
    expect(closeDayBlock([row(1, 'Completed'), row(2, 'Cancelled'), row(3, 'No Show')]).blocked).toBe(false);
    expect(closeDayBlock([]).blocked).toBe(false);
    expect(closeDayBlock(null).blocked).toBe(false);
  });
  it('knows the three unfinished states', () => {
    ['Pending', 'Confirmed', 'In-Progress'].forEach((s) => expect(isUnfinished(s)).toBe(true));
    ['Completed', 'Cancelled', 'No Show'].forEach((s) => expect(isUnfinished(s)).toBe(false));
  });
  it('the unpaid warning says in plain words that the balance can still be collected', () => {
    expect(unpaidCloseWarning(2)).toMatch(/2 bookings are not fully paid/);
    expect(unpaidCloseWarning(1)).toMatch(/can be collected later/);
    expect(unpaidCloseWarning(0)).toBe('');
  });
});

describe('card brands go to the card bucket, not fonepay (ZNLY-234)', () => {
  const names = cardModeNames(DEFAULT_PAYMENT_METHODS);
  it('samis 17 Nov: Mastercard 500 + Visa 300 are card, MobileBanking 500 is digital, cash stays cash', () => {
    const day = { Cash: 24750, Mastercard: 500, Visa: 300, MobileBanking: 500 };
    const b = { cash: 0, card: 0, fonepay: 0 };
    for (const [m, v] of Object.entries(day)) b[bucketForMode(m, names)] += v;
    expect(b).toEqual({ cash: 24750, card: 800, fonepay: 500 });
  });
  it('sub-methods of any card group the org configured, and brands named in the method itself', () => {
    const custom = cardModeNames([{ name: 'Bank Cards', subMethods: ['Himalayan'] }, 'Nabil Card', { name: 'Digital Wallet', subMethods: ['Khalti', 'eSewa'] }]);
    expect(bucketForMode('Himalayan', custom)).toBe('card');
    expect(bucketForMode('Nabil Card', custom)).toBe('card');
    expect(bucketForMode('Khalti', custom)).toBe('fonepay');
    expect(bucketForMode('Esewa', custom)).toBe('fonepay');
    expect(bucketForMode('cash', custom)).toBe('cash');
  });
});
