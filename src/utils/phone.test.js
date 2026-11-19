import { describe, it, expect } from 'vitest';
import { isValidPhoneForCountry } from './phone';

describe('isValidPhoneForCountry', () => {
  it('rejects empty/blank/missing input regardless of country', () => {
    expect(isValidPhoneForCountry('', '+977')).toBe(false);
    expect(isValidPhoneForCountry('   ', '+977')).toBe(false);
    expect(isValidPhoneForCountry(null, '+977')).toBe(false);
    expect(isValidPhoneForCountry(undefined, '+977')).toBe(false);
  });

  it('requires exactly 10 digits for Nepal (+977)', () => {
    expect(isValidPhoneForCountry('9841234567', '+977')).toBe(true);
    expect(isValidPhoneForCountry('984123456', '+977')).toBe(false); // 9 digits
    expect(isValidPhoneForCountry('98412345678', '+977')).toBe(false); // 11 digits
  });

  it('defaults to Nepal rules when no dial code is given', () => {
    expect(isValidPhoneForCountry('9841234567')).toBe(true);
    expect(isValidPhoneForCountry('12345')).toBe(false);
  });

  it('strips separators before checking rather than rejecting them', () => {
    expect(isValidPhoneForCountry('984-123-4567', '+977')).toBe(true);
    expect(isValidPhoneForCountry('984 123 4567', '+977')).toBe(true);
    expect(isValidPhoneForCountry('(984) 123-4567', '+977')).toBe(true);
  });

  it('rejects non-digit junk that strips down to nothing', () => {
    expect(isValidPhoneForCountry('abc', '+977')).toBe(false);
    expect(isValidPhoneForCountry('----', '+977')).toBe(false);
  });

  it('applies a loose 6-15 digit sanity range for non-Nepal countries, not the Nepal shape', () => {
    expect(isValidPhoneForCountry('5551234567', '+1')).toBe(true); // 10 digits, non-Nepal
    expect(isValidPhoneForCountry('123456', '+1')).toBe(true); // 6 digits, lower bound
    expect(isValidPhoneForCountry('123456789012345', '+1')).toBe(true); // 15 digits, upper bound
    expect(isValidPhoneForCountry('12345', '+1')).toBe(false); // 5 digits, below minimum
    expect(isValidPhoneForCountry('1234567890123456', '+1')).toBe(false); // 16 digits, above maximum
  });

  it('does not reject a real international number for not matching the Nepal-only 10-digit shape', () => {
    // An Australian mobile is 9 digits national -- would fail Nepal's exact-10 rule, but
    // must pass under its own country's loose range rather than being rejected outright.
    expect(isValidPhoneForCountry('412345678', '+61')).toBe(true);
  });
});
