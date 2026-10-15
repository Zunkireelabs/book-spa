import { describe, it, expect } from 'vitest';
import { friendlyError, NETWORK_ERROR_COPY } from './friendlyError';

describe('friendlyError', () => {
  it('strips the SQL function prefix and capitalises', () => {
    expect(friendlyError({ message: 'reschedule_booking: slot no longer available' })).toBe('Slot no longer available');
    expect(friendlyError({ message: 'issue_voucher: voucher code NT 4326-1 is already in use' })).toBe('Voucher code NT 4326-1 is already in use');
  });

  it('maps network failures to one sentence', () => {
    expect(friendlyError(new TypeError('Failed to fetch'))).toBe(NETWORK_ERROR_COPY);
    expect(friendlyError({ message: 'NetworkError when attempting to fetch resource.' })).toBe(NETWORK_ERROR_COPY);
    expect(friendlyError({ message: 'Load failed' })).toBe(NETWORK_ERROR_COPY);
  });

  it('leaves ordinary messages alone', () => {
    expect(friendlyError({ message: 'Only an admin may do that.' })).toBe('Only an admin may do that.');
    expect(friendlyError('Enter a valid amount: 3')).toBe('Enter a valid amount: 3');
  });

  it('falls back when there is no message', () => {
    expect(friendlyError(null)).toBe('Something went wrong. Please try again.');
    expect(friendlyError({}, 'Custom fallback')).toBe('Custom fallback');
    expect(friendlyError({ message: '  ' })).toBe('Something went wrong. Please try again.');
  });
});
