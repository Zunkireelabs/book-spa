import { describe, it, expect } from 'vitest';
import { futureBookingMessage, nepalToday } from './bookingTransformers';
import { friendlyError } from '../utils/friendlyError';

const now = new Date('2026-11-20T10:00:00Z'); // 15:45 in Nepal, Fri 20 Nov
describe('futureBookingMessage (ZNLY-275)', () => {
  it('tomorrow is blocked with the plain sentence', () => {
    expect(futureBookingMessage('2026-11-21', 'start', now)).toBe('This booking is for Sat 21 Nov. Move it to today to start it now.');
  });
  it('verbs follow the action', () => {
    expect(futureBookingMessage('2026-12-01', 'complete', now)).toContain('complete it now');
    expect(futureBookingMessage('2026-12-01', 'noshow', now)).toContain('mark it as no-show');
  });
  it('today and the past are allowed', () => {
    expect(futureBookingMessage('2026-11-20', 'start', now)).toBeNull();
    expect(futureBookingMessage('2026-11-19', 'complete', now)).toBeNull();
    expect(futureBookingMessage(undefined, 'start', now)).toBeNull();
  });
  it('uses Nepal time: 19:00 UTC is already the next Nepal day', () => {
    const late = new Date('2026-11-20T19:00:00Z');
    expect(nepalToday(late)).toBe('2026-11-21');
    expect(futureBookingMessage('2026-11-21', 'start', late)).toBeNull();
  });
});
describe('friendlyError maps the DB error to the same sentence', () => {
  it('raw trigger error', () => {
    const e = { code: 'P0275', message: 'FUTURE_BOOKING: This booking is for Sat 21 Nov. Move it to today to start it now.' };
    expect(friendlyError(e)).toBe('This booking is for Sat 21 Nov. Move it to today to start it now.');
  });
});
