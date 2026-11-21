import { describe, it, expect } from 'vitest';
import { formatPhoneGrouped, formatPhoneDisplay } from './phone';

describe('formatPhoneGrouped', () => {
  it('groups a Nepal mobile number 3-3-4 however it is stored', () => {
    expect(formatPhoneGrouped('+9779800000026')).toBe('+977 980-000-0026');
    expect(formatPhoneGrouped('9800000026')).toBe('+977 980-000-0026');
    expect(formatPhoneGrouped('+977 980-000-0026')).toBe('+977 980-000-0026');
    expect(formatPhoneGrouped('977 9841120921')).toBe('+977 984-112-0921');
  });
  it('leaves other numbers in the plain format', () => {
    expect(formatPhoneGrouped('+15551234567')).toBe('+1 5551234567');
    expect(formatPhoneGrouped('+977 98000900001')).toBe(formatPhoneDisplay('+977 98000900001'));
  });
  it('returns an empty string for nothing', () => {
    expect(formatPhoneGrouped('')).toBe('');
    expect(formatPhoneGrouped(null)).toBe('');
  });
});

import { isValidPhone, phoneProblem, phoneEditProblem, phoneToSave } from './phone';
describe('isValidPhone / phoneProblem (ZNLY-327)', () => {
  it('accepts real numbers: NP mobile (98/97 + 8 digits), NP landline, US, UK', () => {
    expect(isValidPhone('+977', '9841221840')).toBe(true);
    expect(isValidPhone('+977', '9712345678')).toBe(true);
    expect(isValidPhone('+977', '14567890')).toBe(true);
    expect(isValidPhone('+1', '2025550123')).toBe(true);
    expect(isValidPhone('+44', '2071838750')).toBe(true);
  });
  it('rejects too short, too long, all-zero, all-same and sequences', () => {
    expect(isValidPhone('+977', '97000')).toBe(false);
    expect(isValidPhone('+977', '123456')).toBe(false);
    expect(isValidPhone('+977', '0000000000')).toBe(false);
    expect(isValidPhone('+977', '9999999999')).toBe(false);
    expect(isValidPhone('+977', '1234567890')).toBe(false);
    expect(isValidPhone('+977', '9876543210')).toBe(false);
    expect(isValidPhone('+977', '')).toBe(false);
  });
  it('phoneProblem: plain reason naming the country; empty or valid = ""', () => {
    expect(phoneProblem('+977', '97000')).toBe("This number isn't valid for Nepal. Use Walk-in if the customer has no number.");
    expect(phoneProblem('+44', '1')).toMatch(/United Kingdom/);
    expect(phoneProblem('+977', '')).toBe('');
    expect(phoneProblem('+977', '9841221840')).toBe('');
  });
  it('an untouched (even invalid) stored number still saves as stored', () => {
    const form = { dial: '+977', national: '97000', initialDial: '+977', initialNational: '97000', original: '+97797000' };
    expect(phoneEditProblem(form)).toBe('');
    expect(phoneToSave(form)).toBe('+97797000');
    expect(phoneEditProblem({ ...form, national: '970001' })).toMatch(/isn't valid for Nepal/); // touched: checked
    expect(phoneEditProblem({ ...form, dial: '+44' })).toMatch(/United Kingdom/);
  });
});
