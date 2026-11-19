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

import { parseDobParts, daysUntilBirthday, birthdaySoonLabel, formatBirthdayShort } from './dobInput';

describe('parseDobParts', () => {
  it('empty is no value; partial is an error', () => {
    expect(parseDobParts({ month: '', day: '', year: '' }, today)).toEqual({ iso: '', error: null });
    expect(parseDobParts({ month: 3, day: '', year: '' }, today).error).toBe('Pick the month, day and year.');
  });
  it('accepts a real date', () => {
    expect(parseDobParts({ month: 3, day: '5', year: '1994' }, today)).toEqual({ iso: '1994-03-05', error: null });
  });
  it('rejects impossible, future and bad years in plain words', () => {
    expect(parseDobParts({ month: 2, day: '31', year: '1994' }, today).error).toBe("That date doesn't exist.");
    expect(parseDobParts({ month: 2, day: '29', year: '2023' }, today).error).toBe("That date doesn't exist.");
    expect(parseDobParts({ month: 12, day: '1', year: '2030' }, today).error).toBe("Date of birth can't be in the future.");
    expect(parseDobParts({ month: 1, day: '1', year: '94' }, today).error).toBe('Check the year.');
    expect(parseDobParts({ month: 1, day: '1', year: '1800' }, today).error).toBe('Check the year.');
  });
});

describe('birthday soon (Nepal date passed in)', () => {
  it('counts days to the next birthday', () => {
    expect(daysUntilBirthday('1994-11-22', '2026-11-19')).toBe(3);
    expect(daysUntilBirthday('1994-11-19', '2026-11-19')).toBe(0);
    expect(daysUntilBirthday('1994-11-18', '2026-11-19')).toBe(364);
    expect(daysUntilBirthday('1994-01-02', '2026-12-30')).toBe(3); // wraps the year
    expect(daysUntilBirthday('', '2026-11-19')).toBeNull();
  });
  it('29 Feb falls on 1 Mar in a non-leap year', () => {
    expect(daysUntilBirthday('1996-02-29', '2027-02-27')).toBe(2);
    expect(daysUntilBirthday('1996-02-29', '2028-02-27')).toBe(2);
  });
  it('labels today, tomorrow, within 7 days; nothing beyond', () => {
    expect(birthdaySoonLabel('1994-11-19', '2026-11-19')).toBe('Birthday today');
    expect(birthdaySoonLabel('1994-11-20', '2026-11-19')).toBe('Birthday tomorrow');
    expect(birthdaySoonLabel('1994-11-22', '2026-11-19')).toBe('Birthday in 3 days');
    expect(birthdaySoonLabel('1994-11-26', '2026-11-19')).toBe('Birthday in 7 days');
    expect(birthdaySoonLabel('1994-11-27', '2026-11-19')).toBe('');
  });
  it('formats short', () => { expect(formatBirthdayShort('1994-03-12')).toBe('12 Mar'); });
});
