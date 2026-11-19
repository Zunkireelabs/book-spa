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
