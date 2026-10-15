import { describe, it, expect } from 'vitest';
import { friendlyError, isNetworkError, NETWORK_ERROR_COPY } from './friendlyError';

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

  it('does not promise that nothing was changed', () => {
    expect(NETWORK_ERROR_COPY).toBe("Couldn't reach the server. Check your connection and try again.");
    expect(NETWORK_ERROR_COPY).not.toMatch(/nothing was changed/i);
  });

  it('does not treat other TypeErrors as network problems', () => {
    expect(friendlyError(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe('Something went wrong. Please try again.');
    expect(friendlyError(new TypeError('x is not a function'), 'Custom fallback')).toBe('Custom fallback');
  });

  it('isNetworkError matches by message only', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkError({ message: 'reschedule_booking: slot no longer available' })).toBe(false);
    expect(isNetworkError(new TypeError('x is not a function'))).toBe(false);
    expect(isNetworkError(null)).toBe(false);
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
