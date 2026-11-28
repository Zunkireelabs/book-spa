import { describe, it, expect } from 'vitest';
import { earlierBalanceKey, ownsEarlierBalance, oneOwner, isCheckoutSibling } from './earlierBalance';

describe('earlier balance key', () => {
  it('customer id wins over phone', () => {
    const k = earlierBalanceKey({ customerId: 'c1', phone: '+9779800000000' });
    expect(k).toEqual({ customerId: 'c1' });
    expect(ownsEarlierBalance(k, { customer_id: 'c1', phone: '+9779811111111' })).toBe(true);
    expect(ownsEarlierBalance(k, { customer_id: 'c2', phone: '+9779800000000' })).toBe(false);
  });
  it('no customer: the full normalised phone, rows without a customer', () => {
    const k = earlierBalanceKey({ phone: '+9779800000000' });
    expect(ownsEarlierBalance(k, { phone: '+9779800000000' })).toBe(true);
  });
  it('phone key ignores a row with a customer_id', () => {
    const k = earlierBalanceKey({ phone: '+9779800000000' });
    expect(ownsEarlierBalance(k, { customer_id: 'c9', phone: '+9779800000000' })).toBe(false);
    expect(ownsEarlierBalance(k, { customer_id: null, phone: '+9779800000000' })).toBe(true);
  });
  it('a stray fragment or nothing: no key, nothing matches', () => {
    expect(earlierBalanceKey({ phone: '980000' })).toBeNull();
    expect(ownsEarlierBalance(null, { phone: 'x' })).toBe(false);
  });
});

describe('phone search owner check', () => {
  it('one owner: same customer on every row, or no customer on any', () => {
    expect(oneOwner([{ customerId: 'c1' }, { customerId: 'c1' }])).toBe(true);
    expect(oneOwner([{ customerId: null }, { customerId: null }])).toBe(true);
    expect(oneOwner([])).toBe(true);
  });
  it('more than one owner (two customers, or a customer and a walk-in): not pre-ticked', () => {
    expect(oneOwner([{ customerId: 'c1' }, { customerId: 'c2' }])).toBe(false);
    expect(oneOwner([{ customerId: 'c1' }, { customerId: null }])).toBe(false);
  });
});

describe('checkout sibling = not an earlier balance (chip and checkout agree)', () => {
  const b = { booking_group_id: 'g1', customer_name: 'Ram', date: '2026-11-20' };
  it('a group booking: the same group counts, even with a different name; another group or name+date does not', () => {
    expect(isCheckoutSibling(b, { booking_group_id: 'g1', customer_name: 'Sita', date: '2026-11-20' }, 0)).toBe(true);
    expect(isCheckoutSibling(b, { booking_group_id: 'g2', customer_name: 'Ram', date: '2026-11-20' }, 0)).toBe(false);
    expect(isCheckoutSibling(b, { booking_group_id: null, customer_name: 'Ram', date: '2026-11-20' }, 0)).toBe(false);
  });
  it('no group: same name + date', () => {
    const solo = { booking_group_id: null, customer_name: 'Ram', date: '2026-11-20' };
    expect(isCheckoutSibling(solo, { customer_name: 'Ram', date: '2026-11-20' }, 0)).toBe(true);
    expect(isCheckoutSibling(solo, { customer_name: 'Ram', date: '2026-11-19' }, 0)).toBe(false);
  });
  it('something already paid on it is never a sibling (the checkout only bundles unpaid ones)', () => {
    expect(isCheckoutSibling(b, { booking_group_id: 'g1' }, 100)).toBe(false);
  });
});
