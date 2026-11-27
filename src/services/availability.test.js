import { describe, it, expect, vi } from 'vitest';
import {
  parseAvailabilityError, formatAvailabilityMessage, evaluateAvailability, nextFreeStarts, firstOtherFreeTherapist, isOverridableCode, createEnforcementCache,
} from './availability';

// The refusal text follows the saved 12h/24h choice (utils/clockPref); tests flip it here.
let mock24h = true;
vi.mock('../utils/clockPref', () => ({ readUse24h: () => mock24h }));

const pgError = (code, detail, text = 'x') => ({
  code: 'P0006', message: `${code}: ${text}`, details: JSON.stringify(detail),
});

describe('refusal ranges follow the 12h/24h choice', () => {
  const d = { therapist_name: 'Rojina', reason: 'booking', range_start: '14:00', range_end: '14:30' };
  it.each([
    [false, 'OVERLAP', d, 'Rojina already has a booking 2:00–2:30pm'],
    [true, 'OVERLAP', d, 'Rojina already has a booking 14:00–14:30'],
    [false, 'ON_BREAK', { ...d, range_start: '11:30', range_end: '12:15' }, 'Rojina is on a break 11:30am–12:15pm'],
    [false, 'BLOCKED', { ...d, range_start: '15:00', range_end: '16:00', label: 'training' }, 'Rojina is blocked 3:00–4:00pm (training)'],
    [false, 'ON_LEAVE', { reason: 'leave_half', therapist_name: 'Rojina', range_start: '09:00', range_end: '13:00' }, 'Rojina is off 9:00am–1:00pm'],
    [false, 'OFF_SHIFT', { reason: 'before_shift', therapist_name: 'Rojina', range_start: '00:00', range_end: '11:00' }, 'Rojina is off until 11:00am'],
    [false, 'OFF_SHIFT', { reason: 'after_shift', therapist_name: 'Rojina', range_start: '18:00', range_end: '24:00' }, "Rojina's shift ends at 6:00pm"],
  ])('use24h=%s %s', (use24h, code, detail, message) => {
    mock24h = use24h;
    try { expect(formatAvailabilityMessage(code, detail)).toBe(message); } finally { mock24h = true; }
  });
});

describe('parseAvailabilityError', () => {
  it('maps the guard error to { code, message, overridable, detail }', () => {
    const e = parseAvailabilityError(pgError('ON_BREAK', {
      code: 'ON_BREAK', reason: 'break', therapist_name: 'Rojina', range_start: '14:00', range_end: '14:30',
    }));
    expect(e).toMatchObject({ code: 'ON_BREAK', message: 'Rojina is on a break 14:00–14:30', overridable: true });
    expect(e.detail.range_start).toBe('14:00');
  });

  it.each([
    ['OFF_SHIFT', { reason: 'before_shift', range_start: '00:00', range_end: '11:00' }, 'Rojina is off until 11:00', true],
    ['OFF_SHIFT', { reason: 'after_shift', range_start: '18:00', range_end: '24:00' }, "Rojina's shift ends at 18:00", true],
    ['OFF_SHIFT', { reason: 'day_off', range_start: '00:00', range_end: '24:00' }, 'Rojina is not working on this date', true],
    ['ON_LEAVE', { reason: 'leave_full', range_start: '00:00', range_end: '24:00' }, 'Rojina is on leave on this date', false],
    ['ON_LEAVE', { reason: 'leave_half', range_start: '09:00', range_end: '13:00' }, 'Rojina is off 09:00–13:00', false],
    ['BLOCKED', { reason: 'block', range_start: '15:00', range_end: '16:00', label: 'training' }, 'Rojina is blocked 15:00–16:00 (training)', true],
    ['OTHER_BRANCH', { reason: 'other_branch', range_start: '13:00', range_end: '16:00', label: 'Thamel' }, 'Rojina is at Thamel at this time', true],
    ['OVERLAP', { reason: 'booking', range_start: '14:00', range_end: '15:00' }, 'Rojina already has a booking 14:00–15:00', false],
  ])('%s %j', (code, d, message, overridable) => {
    const e = parseAvailabilityError(pgError(code, { therapist_name: 'Rojina', ...d }));
    expect(e.message).toBe(message);
    expect(e.overridable).toBe(overridable);
    expect(e.code).toBe(code);
  });

  it('OVERRIDE_NOT_ALLOWED is not overridable and has a plain message', () => {
    const e = parseAvailabilityError({ code: 'P0006', message: 'OVERRIDE_NOT_ALLOWED: nope' });
    expect(e.code).toBe('OVERRIDE_NOT_ALLOWED');
    expect(e.overridable).toBe(false);
    expect(e.message).toMatch(/manager or admin/);
  });

  it('falls back to the server text when DETAIL is missing, and ignores unrelated errors', () => {
    expect(parseAvailabilityError({ code: 'P0006', message: 'ON_BREAK: Rojina is on a break 14:00–14:30' }).message).toBe('Rojina is on a break 14:00–14:30');
    expect(parseAvailabilityError({ code: '23P01', message: 'conflict' })).toBeNull();
    expect(parseAvailabilityError({ code: 'P0006', message: 'THERAPIST_ABSENT: x' })).toBeNull();
    expect(parseAvailabilityError(null)).toBeNull();
  });

  it('uses the industry label when the name is missing', () => {
    expect(formatAvailabilityMessage('ON_LEAVE', { reason: 'leave_full' }, { staffLabel: 'doctor' })).toBe('This doctor is on leave on this date');
  });

  it('isOverridableCode', () => {
    expect(['OFF_SHIFT', 'ON_BREAK', 'BLOCKED', 'OTHER_BRANCH'].every(isOverridableCode)).toBe(true);
    expect(['ON_LEAVE', 'OVERLAP', 'OVERRIDE_NOT_ALLOWED'].some(isOverridableCode)).toBe(false);
  });
});

// Rojina's Monday: 10:00-20:00, break 14:00-14:30, booked 13:00-14:00 (mockup panel E)
const rojina = {
  works: true, start_time: '10:00:00', end_time: '20:00:00', source: 'weekly',
  breaks: [{ start_min: 840, end_min: 870, name: 'Lunch' }], off: [],
};
const booked = [{ startMin: 780, endMin: 840, number: 'BK-1' }];

describe('evaluateAvailability (mirrors the guard)', () => {
  const at = (s, e) => evaluateAvailability({ shiftDay: rojina, bookings: booked, startMin: s, endMin: e, therapistName: 'Rojina' });

  it('is free inside the shift', () => expect(at(15 * 60, 16 * 60)).toBeNull());
  it('edges: ends exactly at break start / starts exactly at break end are free', () => {
    expect(evaluateAvailability({ shiftDay: rojina, bookings: [], startMin: 13 * 60, endMin: 14 * 60 })).toBeNull();
    expect(at(14 * 60 + 30, 15 * 60 + 30)).toBeNull();
  });
  it('break edges: 13:59 start and 14:01 end both hit the break', () => {
    expect(evaluateAvailability({ shiftDay: rojina, bookings: [], startMin: 13 * 60 + 59, endMin: 14 * 60 + 59 }).code).toBe('ON_BREAK');
    expect(evaluateAvailability({ shiftDay: rojina, bookings: [], startMin: 13 * 60, endMin: 14 * 60 + 1 }).code).toBe('ON_BREAK');
  });
  it('OVERLAP wins over a break (never overridable)', () => {
    const r = at(13 * 60 + 30, 14 * 60 + 30);
    expect(r.code).toBe('OVERLAP');
    expect(r.overridable).toBe(false);
  });
  it('before / after shift', () => {
    expect(at(9 * 60, 10 * 60 + 30).message).toBe('Rojina is off until 10:00');
    expect(at(19 * 60 + 30, 20 * 60 + 30).message).toBe("Rojina's shift ends at 20:00");
  });
  it('ends exactly at shift end is free; RPC 23:59:59 means 24:00', () => {
    expect(evaluateAvailability({ shiftDay: rojina, bookings: [], startMin: 19 * 60, endMin: 20 * 60 })).toBeNull();
    const late = { ...rojina, end_time: '23:59:59' };
    expect(evaluateAvailability({ shiftDay: late, bookings: [], startMin: 22 * 60, endMin: 23 * 60 })).toBeNull();
  });
  it('day off, leave, blocks and transfers come from the range rows', () => {
    expect(evaluateAvailability({ shiftDay: { ...rojina, works: false }, startMin: 700, endMin: 760 }).detail.reason).toBe('day_off');
    const off = (code, reason, label) => ({ ...rojina, off: [{ code, reason, label, start_min: 900, end_min: 960 }] });
    expect(evaluateAvailability({ shiftDay: off('ON_LEAVE', 'leave_half'), startMin: 900, endMin: 930 }).overridable).toBe(false);
    expect(evaluateAvailability({ shiftDay: off('BLOCKED', 'block', 'training'), startMin: 900, endMin: 930 }).message).toContain('(training)');
    expect(evaluateAvailability({ shiftDay: off('OTHER_BRANCH', 'other_branch', 'Thamel'), startMin: 900, endMin: 930 }).code).toBe('OTHER_BRANCH');
  });
  it('no shift data = only overlaps matter; therapists with source none and branch hours behave like a shift', () => {
    expect(evaluateAvailability({ shiftDay: null, bookings: [], startMin: 60, endMin: 120 })).toBeNull();
    expect(evaluateAvailability({ shiftDay: null, bookings: booked, startMin: 790, endMin: 850 }).code).toBe('OVERLAP');
  });
  it('priority: leave beats overlap beats block beats break beats shift', () => {
    const shift = { ...rojina, off: [{ code: 'BLOCKED', reason: 'block', start_min: 840, end_min: 900 }, { code: 'ON_LEAVE', reason: 'leave_half', start_min: 840, end_min: 900 }] };
    expect(evaluateAvailability({ shiftDay: shift, bookings: booked, startMin: 835, endMin: 845 }).code).toBe('ON_LEAVE');
  });
});

describe('nextFreeStarts', () => {
  it('lists the next 3 free starts a duration apart (mockup: 14:30, 15:30, 16:30)', () => {
    expect(nextFreeStarts({ shiftDay: rojina, bookings: booked, durationMin: 60, fromMin: 14 * 60 })).toEqual(['14:30', '15:30', '16:30']);
  });
  it('skips booked time and stops at the shift end', () => {
    expect(nextFreeStarts({ shiftDay: rojina, bookings: [], durationMin: 60, fromMin: 18 * 60 + 30, count: 3 })).toEqual(['18:30']);
  });
  it('returns [] when the therapist has no more time', () => {
    expect(nextFreeStarts({ shiftDay: { ...rojina, works: false }, durationMin: 60, fromMin: 600 })).toEqual([]);
  });
});

describe('firstOtherFreeTherapist', () => {
  it('returns the first other therapist free at the chosen time', () => {
    const vina = { id: 'v', name: 'Vina', shiftDay: rojina, bookings: [{ startMin: 900, endMin: 960 }] };
    const asha = { id: 'a', name: 'Asha', shiftDay: rojina, bookings: [] };
    const r = { id: 'r', name: 'Rojina', shiftDay: rojina, bookings: [] };
    expect(firstOtherFreeTherapist({ candidates: [r, vina, asha], excludeId: 'r', startMin: 900, endMin: 960 }).id).toBe('a');
    expect(firstOtherFreeTherapist({ candidates: [r, vina], excludeId: 'r', startMin: 900, endMin: 960 })).toBeNull();
  });
});

describe('createEnforcementCache (JS pre-checks defer to the DB guard when the switch is ON)', () => {
  it('reports the tenant flag, caches it per branch, and refetches after the ttl', async () => {
    let t = 0;
    const fetchFlag = vi.fn(async () => true);
    const cache = createEnforcementCache(fetchFlag, { ttlMs: 1000, now: () => t });
    expect(await cache.get('b1')).toBe(true);
    expect(await cache.get('b1')).toBe(true);
    expect(fetchFlag).toHaveBeenCalledTimes(1);
    await cache.get('b2');
    expect(fetchFlag).toHaveBeenCalledTimes(2);
    t = 1500;
    await cache.get('b1');
    expect(fetchFlag).toHaveBeenCalledTimes(3);
  });
  it('switch OFF (false / null / undefined) keeps the old pre-checks', async () => {
    for (const v of [false, null, undefined, 'true']) {
      expect(await createEnforcementCache(async () => v).get('b1')).toBe(false);
    }
  });
  it('fails safe to OFF when the flag cannot be read, and without a branch', async () => {
    expect(await createEnforcementCache(async () => { throw new Error('rls'); }).get('b1')).toBe(false);
    expect(await createEnforcementCache(async () => true).get(null)).toBe(false);
  });
});

describe('THERAPIST_NOT_ELIGIBLE (ZNLY-418)', () => {
  it('is overridable and reads as a plain sentence built from the detail, never the SQL text', () => {
    const r = parseAvailabilityError({ message: 'THERAPIST_NOT_ELIGIBLE: Jayanti R. is not on the staff list for Brows.', details: JSON.stringify({ code: 'THERAPIST_NOT_ELIGIBLE', therapist_name: 'Jayanti R.', service_name: 'Brows Shaping' }) });
    expect(r.code).toBe('THERAPIST_NOT_ELIGIBLE');
    expect(r.overridable).toBe(true);
    expect(r.message).toBe("Jayanti R. is not on Brows Shaping's staff list");
  });
  it('staff + reason: OVERRIDE_NOT_ALLOWED names the staff list', () => {
    const r = parseAvailabilityError({ message: 'OVERRIDE_NOT_ALLOWED: x', details: JSON.stringify({ not_listed: true }) });
    expect(r.overridable).toBe(false);
    expect(r.message).toMatch(/staff list/);
  });
});
