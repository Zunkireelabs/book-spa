import { describe, it, expect } from 'vitest';
import { parseCsv, readTable } from './csv.js';
import { parseDuration, toPaisa, parseDateTime, parseStamp, normRef, normName, normalizePhone, uuid5, mapStatus } from './parse.js';

describe('csv', () => {
  it('handles quotes, multiline cells, CRLF, BOM and blank rows', () => {
    const t = readTable('﻿A,B\r\n"x, y","line1\nline2"\r\n,\r\n"q""q",z\r\n');
    expect(t.headers).toEqual(['A', 'B']);
    expect(t.rows).toEqual([{ A: 'x, y', B: 'line1\nline2' }, { A: 'q"q', B: 'z' }]);
    expect(t.empty).toBe(1);
  });
  it('keeps a final row with no newline', () => { expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]); });
});

describe('parse', () => {
  it('durations', () => {
    expect(parseDuration('1h 30m')).toBe(90); expect(parseDuration('45m')).toBe(45);
    expect(parseDuration('3h')).toBe(180); expect(parseDuration('15')).toBe(15);
    expect(() => parseDuration('soon')).toThrow(); expect(() => parseDuration('')).toThrow();
  });
  it('money in paisa', () => { expect(toPaisa('1,245.50')).toBe(124550); expect(toPaisa('')).toBe(0); expect(toPaisa('0.10') + toPaisa('0.20')).toBe(30); });
  it('date/time', () => {
    expect(parseDateTime('2026-11-22', '6:30 pm')).toEqual({ date: '2026-11-22', time: '18:30:00' });
    expect(parseDateTime('2026-11-22', '12:05 am').time).toBe('00:05:00');
    expect(parseDateTime('2026-11-22', '12:05 pm').time).toBe('12:05:00');
    expect(parseStamp('2026-11-22 7:11 PM')).toEqual({ date: '2026-11-22', time: '19:11:00' });
  });
  it('refs and names', () => { expect(normRef('#C8BFE7D9')).toBe('c8bfe7d9'); expect(normName('  Asha   Rai ')).toBe('asha rai'); });
  it('phones use the real dialling code, never forced +977', () => {
    expect(normalizePhone('+61 412 345 678')).toEqual({ phone: '+61412345678', country: 'Australia' });
    expect(normalizePhone('+44 7700 900123').country).toBe('United Kingdom');
    expect(normalizePhone('9801234567')).toEqual({ phone: '+9779801234567', country: 'Nepal' });
    expect(normalizePhone('+977-9801234567').phone).toBe('+9779801234567');
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('123').phone).toBeNull();
  });
  it('uuid5 is deterministic and v5-shaped', () => {
    expect(uuid5('a')).toBe(uuid5('a')); expect(uuid5('a')).not.toBe(uuid5('b'));
    expect(uuid5('a')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('statuses', () => {
    expect(mapStatus('Canceled')).toBe('Cancelled'); expect(mapStatus('Did not show')).toBe('No Show');
    expect(mapStatus('Booked')).toBe('Confirmed'); expect(() => mapStatus('Weird')).toThrow();
  });
});
