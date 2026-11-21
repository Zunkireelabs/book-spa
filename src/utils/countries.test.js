import { describe, it, expect } from 'vitest';
import { COUNTRIES, DIAL_CODES, DIAL_OWNER, countryByDial, countryFor, searchCountries } from './countries';
import { splitE164, formatPhoneDisplay } from './phone';
import { parsePhone } from '../components/ui/CountryCodeSelect';

describe('country list', () => {
  it('has every country, unique ISO, Nepal first, valid dial format', () => {
    expect(COUNTRIES.length).toBeGreaterThan(230);
    expect(new Set(COUNTRIES.map((c) => c.iso)).size).toBe(COUNTRIES.length);
    expect(COUNTRIES[0]).toMatchObject({ iso: 'NP', dial: '+977' });
    COUNTRIES.forEach((c) => {
      expect(c.iso).toMatch(/^[A-Z]{2}$/);
      expect(c.dial).toMatch(/^\+[1-9]\d{0,3}$/);
      expect(c.name.length).toBeGreaterThan(1);
    });
  });
  it('shared dial codes resolve to one stable default', () => {
    expect(countryByDial('+1').iso).toBe('US');
    expect(countryByDial('+7').iso).toBe('RU');
    expect(countryByDial('+44').iso).toBe('GB');
    expect(countryByDial('+000').iso).toBe('NP');
  });
  it('dial codes are sorted longest first', () => {
    const lens = DIAL_CODES.map((d) => d.length);
    expect(lens).toEqual([...lens].sort((a, b) => b - a));
  });
});

describe('parsing: longest prefix wins', () => {
  it('+1 vs +1242', () => {
    expect(splitE164('+15551234567')).toEqual({ dial: '+1', national: '5551234567' });
    expect(splitE164('+12425551234')).toEqual({ dial: '+1242', national: '5551234' });
    expect(parsePhone('+1 555 123 4567')).toEqual({ dial: '+1', national: '5551234567' });
  });
  it('+977, +44, +7, bare numbers', () => {
    expect(splitE164('+9779841234567')).toEqual({ dial: '+977', national: '9841234567' });
    expect(parsePhone('9779841234567')).toEqual({ dial: '+977', national: '9841234567' });
    expect(splitE164('+447911123456')).toEqual({ dial: '+44', national: '7911123456' });
    expect(splitE164('+79123456789')).toEqual({ dial: '+7', national: '9123456789' });
    expect(parsePhone('9841234567')).toEqual({ dial: '+977', national: '9841234567' });
    expect(formatPhoneDisplay('9841234567')).toBe('+977 9841234567');
  });
  it('a newly added country parses', () => {
    expect(splitE164('+23057123456')).toEqual({ dial: '+230', national: '57123456' });
  });
});

describe('search', () => {
  it('by name, ISO and dial code with or without +', () => {
    expect(searchCountries('nep')[0].iso).toBe('NP');
    expect(searchCountries('FR').some((c) => c.iso === 'FR')).toBe(true);
    expect(searchCountries('+977')[0].iso).toBe('NP');
    expect(searchCountries('977')[0].iso).toBe('NP');
    expect(searchCountries('44').some((c) => c.iso === 'GB')).toBe(true);
    expect(searchCountries('')).toHaveLength(COUNTRIES.length);
    expect(searchCountries('zzzz')).toHaveLength(0);
  });
});

describe('display order and shared codes', () => {
  it('Nepal first, then strictly A–Z by name', () => {
    const rest = COUNTRIES.slice(1).map((c) => c.name);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b, 'en')));
    expect(COUNTRIES[1].name).toBe('Afghanistan');
    expect(searchCountries('+9')[0].iso).toBe('NP');
  });
  it('every shared dial code has an owner that exists and uses that code', () => {
    const byDial = {};
    COUNTRIES.forEach((c) => { (byDial[c.dial] ||= []).push(c); });
    Object.entries(byDial).filter(([, l]) => l.length > 1).forEach(([dial, l]) => {
      expect(DIAL_OWNER[dial], dial).toBeTruthy();
      expect(l.map((c) => c.iso)).toContain(DIAL_OWNER[dial]);
    });
    Object.entries(DIAL_OWNER).forEach(([dial, iso]) => {
      expect(COUNTRIES.find((c) => c.iso === iso)?.dial).toBe(dial);
      expect(countryByDial(dial).iso).toBe(iso);
    });
  });
  it('remembered pick wins only while its dial matches', () => {
    expect(countryFor('+1', 'CA').iso).toBe('CA');
    expect(countryFor('+7', 'KZ').iso).toBe('KZ');
    expect(countryFor('+44', 'JE').iso).toBe('JE');
    expect(countryFor('+1', null).iso).toBe('US');
    expect(countryFor('+91', 'CA').iso).toBe('IN');
  });
});
