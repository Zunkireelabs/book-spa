import { describe, it, expect } from 'vitest';
import { isCustomerInfoValid } from './customerInfoValid';

function validCustomerInfo(overrides = {}) {
  return {
    firstName: 'Ana',
    lastName: '',
    email: '',
    phone: '9841234567',
    phoneCountryCode: '+977',
    gender: '',
    agreeToTerms: true,
    ...overrides,
  };
}

describe('isCustomerInfoValid', () => {
  it('blocks when agreeToTerms is false, even with everything else valid -- the regression this exists to pin', () => {
    expect(isCustomerInfoValid(validCustomerInfo({ agreeToTerms: false }))).toBe(false);
  });

  it('passes when agreeToTerms is true and everything else is valid', () => {
    expect(isCustomerInfoValid(validCustomerInfo())).toBe(true);
  });

  it('blocks when firstName is missing', () => {
    expect(isCustomerInfoValid(validCustomerInfo({ firstName: '' }))).toBe(false);
  });

  it('blocks when firstName is whitespace only (it trims)', () => {
    expect(isCustomerInfoValid(validCustomerInfo({ firstName: '   ' }))).toBe(false);
  });

  it('blocks on an invalid phone', () => {
    expect(isCustomerInfoValid(validCustomerInfo({ phone: '123' }))).toBe(false);
  });

  it('passes on a valid Nepali +977 10-digit phone', () => {
    expect(isCustomerInfoValid(validCustomerInfo({ phone: '9841234567', phoneCountryCode: '+977' }))).toBe(true);
  });

  it('passes on a valid non-Nepali phone under its own looser 6-15 digit range', () => {
    // 9-digit Australian mobile -- would fail Nepal's exact-10 shape, must still pass
    // under +61's own range.
    expect(isCustomerInfoValid(validCustomerInfo({ phone: '412345678', phoneCountryCode: '+61' }))).toBe(true);
  });

  it('passes with an empty email -- it is optional', () => {
    expect(isCustomerInfoValid(validCustomerInfo({ email: '' }))).toBe(true);
  });

  it('blocks on a malformed, non-empty email', () => {
    expect(isCustomerInfoValid(validCustomerInfo({ email: 'not-an-email' }))).toBe(false);
  });

  it('passes with a well-formed email', () => {
    expect(isCustomerInfoValid(validCustomerInfo({ email: 'ana@example.com' }))).toBe(true);
  });

  it('passes with lastName absent -- deliberately optional, do not reinstate the deleted validateAllFields rule', () => {
    expect(isCustomerInfoValid(validCustomerInfo({ lastName: '' }))).toBe(true);
  });

  it('passes with gender absent -- deliberately optional, do not reinstate the deleted validateAllFields rule', () => {
    expect(isCustomerInfoValid(validCustomerInfo({ gender: '' }))).toBe(true);
  });
});
