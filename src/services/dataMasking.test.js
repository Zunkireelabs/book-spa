import { describe, it, expect } from 'vitest';
import { maskCustomerName, maskPhone } from './api';

// Owner decision 2026-11-17 (ZNLY-235): "Sadin S." and "98•••••094", never stars. SQL twins: mask_person_name / mask_phone_digits.
describe('maskCustomerName', () => {
  it('first name + last initial', () => {
    expect(maskCustomerName('Anisha Thakuri')).toBe('Anisha T.');
    expect(maskCustomerName('Sneha Prasai')).toBe('Sneha P.');
  });
  it('single name stays; three names use first + last initial', () => {
    expect(maskCustomerName('Kokwah')).toBe('Kokwah');
    expect(maskCustomerName('Ashmi Thing Tamang')).toBe('Ashmi T.');
  });
  it('never returns a full surname', () => {
    expect(maskCustomerName('Sadin Shrestha')).not.toMatch(/hrestha/);
  });
  it('passes through empty values untouched', () => {
    expect(maskCustomerName('')).toBe('');
    expect(maskCustomerName(null)).toBe(null);
  });
});

describe('maskPhone', () => {
  it('first 2 + 5 dots + last 3, same width every time, no country code', () => {
    expect(maskPhone('+9779818088655')).toBe('98•••••655');
    expect(maskPhone('9818088655')).toBe('98•••••655');
    expect(maskPhone('+977 98-1808-8655')).toBe('98•••••655');
  });
  it('a too-short number is all dots, never exposed', () => {
    expect(maskPhone('12')).toBe('••••••••••');
  });
  it('passes through empty values untouched', () => {
    expect(maskPhone(null)).toBe(null);
  });
});
