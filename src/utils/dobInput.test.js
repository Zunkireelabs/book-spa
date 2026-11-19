import { describe, it, expect } from 'vitest';
import { maskDob, parseDob } from './dobInput';

const today = new Date(2026, 9, 15); // 15 Oct 2026

describe('maskDob', () => {
  it('keeps digits only and inserts the slashes', () => {
    expect(maskDob('15031990')).toBe('15/03/1990');
    expect(maskDob('1503')).toBe('15/03');
    expect(maskDob('15')).toBe('15');
    expect(maskDob('ab1c5-03/19x90999')).toBe('15/03/1990');
    expect(maskDob(null)).toBe('');
  });
});

describe('parseDob', () => {
  it('treats empty as no value', () => {
    expect(parseDob('', today)).toEqual({ iso: '', error: null });
  });

  it('stores a valid date as YYYY-MM-DD', () => {
    expect(parseDob('15/03/1990', today)).toEqual({ iso: '1990-03-15', error: null });
    expect(parseDob('29/02/2000', today).iso).toBe('2000-02-29');
  });

  it('rejects incomplete and impossible dates', () => {
    expect(parseDob('15/03', today).error).toBe('Enter the date as DD/MM/YYYY.');
    expect(parseDob('31/02/1990', today).error).toBe("That date doesn't exist.");
    expect(parseDob('29/02/2001', today).error).toBe("That date doesn't exist.");
    expect(parseDob('00/10/1990', today).error).toBe("That date doesn't exist.");
  });

  it('rejects the future and more than 120 years ago', () => {
    expect(parseDob('16/10/2026', today).error).toBe("Date of birth can't be in the future.");
    expect(parseDob('15/10/2026', today).iso).toBe('2026-10-15');
    expect(parseDob('14/10/1906', today).error).toMatch(/more than 120 years/);
    expect(parseDob('15/10/1906', today).iso).toBe('1906-10-15');
  });
});
