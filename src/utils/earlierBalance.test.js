import { describe, it, expect } from 'vitest';
import { earlierBalanceKey, ownsEarlierBalance } from './earlierBalance';

describe('earlier balance key', () => {
  it('customer id wins over phone', () => {
    const k = earlierBalanceKey({ customerId: 'c1', phone: '+9779800000000' });
    expect(k).toEqual({ customerId: 'c1' });
    expect(ownsEarlierBalance(k, { customer_id: 'c1', phone: '+9779811111111' })).toBe(true);
    expect(ownsEarlierBalance(k, { customer_id: 'c2', phone: '+9779800000000' })).toBe(false);
  });
  it('no customer: the full normalised phone, any owner', () => {
    const k = earlierBalanceKey({ phone: '+9779800000000' });
    expect(ownsEarlierBalance(k, { customer_id: 'c9', phone: '+9779800000000' })).toBe(true);
  });
  it('a stray fragment or nothing: no key, nothing matches', () => {
    expect(earlierBalanceKey({ phone: '980000' })).toBeNull();
    expect(ownsEarlierBalance(null, { phone: 'x' })).toBe(false);
  });
});
