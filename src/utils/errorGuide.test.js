import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const capture = vi.fn();
vi.mock('../lib/analytics', () => ({ capture: (...a) => capture(...a) }));
import { describeError, ERROR_CATALOG, SYSTEM_MESSAGE, makeRef, reportSystemError } from './errorGuide';
import { NETWORK_CHECK_CALENDAR_COPY } from './friendlyError';
import { directDiscountPercent } from '../services/discountLimits';


describe('describeError', () => {
  const ctx = { startTime: '12:00', endTime: '14:00', serviceName: 'ENERGISE BODY', staffName: 'Susan Nagarkoti', nextFreeTimes: ['13:30', '14:00'], freeStaff: [{ id: 's2', name: 'Aksa Rasaili Sunar' }], roomName: 'HUA HIN', otherFreeRooms: 3, hasRooms: true };
  it('rooms full: bold fact, time buttons that only fill, a room picker', () => {
    const c = describeError({ code: 'ROOMS_FULL' }, ctx);
    expect(c.kind).toBe('fix'); expect(c.field).toBe('time');
    expect(c.lead).toBe('Every room is taken 12:00pm–2:00pm.');
    expect(c.actions.map((a) => a.label)).toEqual(['Book at 1:30pm', 'Book at 2:00pm', 'Pick a room']);
    expect(c.actions[0]).toMatchObject({ intent: 'set-time', value: '13:30' });
  });
  it('availability refusal: the server sentence always ends with a full stop before the how', () => {
    const c = describeError({ code: 'OVERLAP', message: 'Rojina K already has a booking 14:00–14:30' }, ctx);
    expect(c.lead).toBe('Rojina K already has a booking 14:00–14:30.');
    expect(`${c.lead} ${c.how}`).toBe('Rojina K already has a booking 14:00–14:30. They already have a booking then. Pick another time, or someone else.');
  });
  it('staff busy: offers the free person', () => {
    const c = describeError({ code: 'THERAPIST_CONFLICT' }, ctx);
    expect(c.field).toBe('staff'); expect(c.how).toBe('Free then: Aksa.');
    expect(c.actions.map((a) => a.label)).toContain('Give it to Aksa');
  });
  it('chosen room full', () => {
    const c = describeError({ code: 'ROOM_FULL' }, ctx);
    expect(c.lead).toBe('HUA HIN is full 12:00pm–2:00pm.'); expect(c.how).toBe('3 other rooms are free then.');
    expect(c.actions.map((a) => a.intent)).toEqual(['set-room-any', 'open-room']);
  });
  it('discount over the limit (scene 6)', () => {
    const c = describeError({ code: 'DISCOUNT_LIMIT_EXCEEDED' }, { limitPercent: 50 });
    expect(c.lead).toBe('Your discount limit is 50%.'); expect(c.how).toBe('Managers and admins can give up to 100%.');
    expect(c.actions.map((a) => a.label)).toEqual(['Set to 50%', 'Ask a manager']);
    expect(c.actions[0]).toMatchObject({ intent: 'set-discount-percent', value: 50 }); expect(c.why).toBeTruthy();
  });
  it('locked booking: admin, not manager', () => {
    const c = describeError({ code: 'BOOKING_IMMUTABLE' }, { status: 'Completed' });
    expect(c.lead).toBe("This booking is completed, so it can't be edited."); expect(c.how).toMatch(/admin/); expect(c.actions[0].label).toBe('Ask an admin');
  });
  it('availability codes reuse the guard message', () => {
    const c = describeError({ code: 'ON_BREAK', message: 'Susan is on a break 1:00pm–2:00pm' }, ctx);
    expect(c.lead).toBe('Susan is on a break 1:00pm–2:00pm.'); expect(c.field).toBe('staff');
  });
  it('a code only named in the text still resolves', () => {
    expect(describeError({ message: 'ROOM_AT_CAPACITY: full' }, ctx).code).toBe('ROOM_AT_CAPACITY');
  });
  it.each(['DAY_LOCKED', 'ROOM_AT_CAPACITY', 'THERAPIST_ABSENT', 'FUTURE_BOOKING', 'BOOKING_IMMUTABLE'])('trigger code %s survives plainError (code P0001, prefix only in rawMessage)', (code) => {
    const c = describeError({ code: 'P0001', message: 'Something plain.', rawMessage: `${code}: raw text`, plain: true }, ctx);
    expect(c.code).toBe(code); expect(c.kind).toBe('fix');
  });
  it('23P01 exclusion -> staff clash, or room clash when the constraint names a room', () => {
    expect(describeError({ code: '23P01', rawMessage: 'conflicting key value violates exclusion constraint "excl_therapist_overlap"' }, ctx).code).toBe('THERAPIST_CONFLICT');
    expect(describeError({ code: '23P01', rawMessage: 'violates exclusion constraint "excl_room_overlap"' }, ctx).code).toBe('ROOM_CONFLICT');
  });
  it('a visit_* server refusal with no catalog entry shows its own sentence, not the generic system card (ZNLY-402)', () => {
    const c = describeError({ code: 'NOTHING_TO_CHANGE', message: 'Nothing was changed.', plain: true, refusal: true });
    expect(c).toMatchObject({ kind: 'fix', code: 'NOTHING_TO_CHANGE', lead: 'Nothing was changed.' });
    expect(describeError({ code: 'NOTHING_TO_CHANGE', message: 'Nothing was changed.', plain: true }).kind).toBe('system'); // not flagged = still generic
  });
  it('23505 unique -> DUPLICATE with no technical text; other Postgres codes stay system', () => {
    const c = describeError({ code: '23505', rawMessage: 'duplicate key value violates unique constraint "services_name_key"' });
    expect(c).toMatchObject({ kind: 'fix', code: 'DUPLICATE', lead: 'That already exists.' });
    expect(JSON.stringify(c)).not.toMatch(/services_name_key|violates/);
    expect(describeError({ code: '42501', message: 'permission denied for table bookings' }).kind).toBe('system');
  });
  it('DAY_LOCKED: Book for tomorrow only when creating; no reopen promise', () => {
    const create = describeError({ code: 'DAY_LOCKED' }, { creating: true });
    expect(create.actions.map((a) => a.label)).toEqual(['Book for tomorrow']);
    expect(describeError({ code: 'DAY_LOCKED' }).actions).toEqual([]);
    expect(create.how).toBe('Once a day is closed, its bookings and money are locked.'); expect(JSON.stringify(create)).not.toMatch(/reopen/i);
  });
  it('server message used in a lead goes through friendlyError, never raw', () => {
    const c = describeError({ code: 'INVALID_THERAPIST', message: 'enforce_booking_therapist_guards violated' }, { staffName: 'Susan' });
    expect(c.lead).toBe('Susan is not at this branch at that time.');
  });
  it('group partial tells staff to check the calendar, not call the branch', () => {
    const c = describeError({ code: 'BOOKING_GROUP_PARTIAL' });
    expect(c.how).toBe('Check the calendar and cancel any extra bookings before booking again.'); expect(c.actions[0].label).toBe('Show on calendar');
  });
  it('beauty-style org: its own staff word, and never any room wording', () => {
    const b = { startTime: '12:00', endTime: '13:00', staffName: '', staffLabel: 'Stylist', staffLabelPlural: 'Stylists', hasRooms: false, nextFreeTimes: ['13:00'] };
    const c = describeError({ code: 'THERAPIST_NOT_ELIGIBLE' }, { ...b, serviceName: 'Haircut', eligibleCount: 4 });
    expect(c.lead).toBe("This stylist doesn't do Haircut."); expect(c.how).toBe('4 stylists do.');
    expect(c.actions.map((a) => a.label)).toEqual(['Pick stylist']);
    const clash = describeError({ code: 'SCHEDULING_CONFLICT' }, b);
    expect(clash.how).toBe('Pick another time or person.');
    const rooms = describeError({ code: 'ROOM_FULL' }, b);
    expect(rooms.actions).toEqual([]);
    for (const code of ['THERAPIST_CONFLICT', 'THERAPIST_ABSENT', 'THERAPIST_CHECKED_OUT', 'THERAPIST_INACTIVE', 'BRANCH_ONLINE_CAPACITY', 'SCHEDULING_CONFLICT']) {
      const x = describeError({ code }, b);
      expect(JSON.stringify(x)).not.toMatch(/team member|room/i);
    }
  });
  it('no staff word given: falls back to "team member"', () => {
    const c = describeError({ code: 'THERAPIST_NOT_ELIGIBLE' }, { serviceName: 'Haircut', eligibleCount: 4 });
    expect(c.lead).toBe("This team member doesn't do Haircut."); expect(c.actions.map((a) => a.label)).toEqual(['Pick staff']);
  });
  it('unknown code: system message, Try again, ref, never the raw text', () => {
    const c = describeError({ code: 'XX999', message: 'duplicate key value violates unique constraint "bookings_pkey"' });
    expect(c.kind).toBe('system'); expect(`${c.lead} ${c.how}`).toBe(SYSTEM_MESSAGE);
    expect(c.canRetry).toBe(true); expect(c.actions.map((a) => a.label)).toEqual(['Try again']);
    expect(JSON.stringify(c)).not.toMatch(/bookings_pkey|duplicate key/); expect(c.ref).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{2}$/);
  });
  it('catalog system entries (BOOKING_NOT_FOUND) get no steps', () => {
    const c = describeError({ code: 'BOOKING_NOT_FOUND' });
    expect(c.kind).toBe('system'); expect(c.lead).toBe("This couldn't be saved.");
  });
  it('network error: connection lost, may have saved, Show on calendar, no Try again, never "nothing was changed"', () => {
    const c = describeError(new TypeError('Failed to fetch'));
    expect(c.kind).toBe('system'); expect(c.lead).toBe('Connection lost.'); expect(c.networkLost).toBe(true); expect(c.canRetry).toBe(false);
    expect(c.how).toBe('The booking may have saved. Check the calendar before trying again.');
    expect(c.actions.map((a) => a.label)).toEqual(['Show on calendar']);
    expect(JSON.stringify(c)).not.toMatch(/nothing was changed|we've been told/i);
    expect(NETWORK_CHECK_CALENDAR_COPY).toBe('Connection lost. The booking may have saved. Check the calendar before trying again.');
  });
  it('makeRef is stable in shape and has no look-alike characters', () => {
    for (let i = 0; i < 50; i++) expect(makeRef()).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{2}$/);
  });
});

describe('describeError: review fixes', () => {
  it('BOOKING_IMMUTABLE stays neutral when the status is unknown, and names paid / the real status when known', () => {
    expect(describeError({ code: 'BOOKING_IMMUTABLE' }).lead).toBe("This booking can't be changed any more.");
    expect(describeError({ code: 'BOOKING_IMMUTABLE' }, { isPaid: true }).lead).toBe("This booking is paid, so it can't be edited.");
    expect(describeError({ code: 'BOOKING_IMMUTABLE' }, { status: 'Cancelled' }).lead).toBe("This booking is cancelled, so it can't be edited.");
  });
  it('FUTURE_BOOKING does not say "Move it to today" twice', () => {
    const c = describeError({ code: 'FUTURE_BOOKING', message: 'This booking is for 23 Nov. Move it to today to start it.' });
    expect(`${c.lead} ${c.how}`.match(/Move it to today/gi)).toHaveLength(1);
    expect(describeError({ code: 'FUTURE_BOOKING' }).how).toMatch(/Move it to today/);
  });
  it('BOOKING_NOT_FOUND / SERVICE_NOT_FOUND: system card, no Try again, "may have been removed"', () => {
    for (const code of ['BOOKING_NOT_FOUND', 'SERVICE_NOT_FOUND']) {
      const c = describeError({ code });
      expect(c).toMatchObject({ kind: 'system', canRetry: false, actions: [] });
      expect(c.how).toBe('It may have been removed. Close and reopen the calendar.');
    }
  });
  it('a part-created group leads with N of M, offers only Show on calendar and never a retry', () => {
    const fixCard = describeError({ code: 'ROOMS_FULL' }, { partial: { created: 2, total: 3 }, hasRooms: true, nextFreeTimes: ['14:00'] });
    expect(fixCard).toMatchObject({ kind: 'fix', lead: '2 of 3 bookings were already created.' });
    expect(fixCard.actions.map((a) => a.intent)).toEqual(['show-calendar']);
    const sys = describeError({ code: 'XX1' }, { partial: { created: 1, total: 4 } });
    expect(sys).toMatchObject({ kind: 'system', lead: '1 of 4 bookings were already created.', canRetry: false });
    expect(sys.actions.map((a) => a.intent)).toEqual(['show-calendar']);
    expect(describeError({ code: 'ROOMS_FULL' }, { partial: { created: 0, total: 3 } }).lead).not.toMatch(/already created/);
  });
  it('the discount text is built from DISCOUNT_LIMITS (no hard-coded numbers)', () => {
    const c = describeError({ code: 'DISCOUNT_LIMIT_EXCEEDED' });
    expect(c.lead).toBe(`Your discount limit is ${directDiscountPercent('staff')}%.`);
    expect(c.how).toBe(`Managers and admins can give up to ${directDiscountPercent('manager')}%.`);
    expect(c.why).toContain(`staff ${directDiscountPercent('staff')}%, manager ${directDiscountPercent('manager')}%, admin ${directDiscountPercent('admin')}%`);
  });
});

describe('reportSystemError', () => {
  it('sends only ref, code and area for a system error; ignores fix cards', () => {
    capture.mockClear();
    const sys = describeError({ code: 'XX999', message: 'Sahil 9841000000' });
    reportSystemError(sys, 'create-booking');
    expect(capture).toHaveBeenCalledWith('app_error', { ref: sys.ref, code: 'XX999', area: 'create-booking' });
    reportSystemError(describeError({ code: 'ROOMS_FULL' }), 'create-booking');
    expect(capture).toHaveBeenCalledTimes(1);
  });
});

// Every error code a booking function can return must have guidance, or the card would fall back to the system message.
describe('api.js booking error codes all have a catalog entry', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../services/api.js'), 'utf8');
  const fnBody = (name) => {
    const start = src.search(new RegExp(`export async function ${name}\\(`));
    expect(start, `${name} exists`).toBeGreaterThan(-1);
    const rest = src.slice(start + 10);
    const next = rest.search(/\nexport (?:async )?function /);
    return src.slice(start, next === -1 ? undefined : start + 10 + next);
  };
  const FUNCS = ['createBooking', 'createBookingGroup', 'updateBookingStatus', 'updateBookingDetails', 'applyDiscount', 'rescheduleBooking'];
  const header = src.slice(src.indexOf('function validateBookingMutation'), src.indexOf('// Read-only queries'));
  const codesIn = (text) => [...text.matchAll(/code: '([A-Z][A-Z0-9_]+)'/g)].map((m) => m[1]);
  const found = new Set([...FUNCS.flatMap((f) => codesIn(fnBody(f))), ...codesIn(header)]);
  const NOT_BOOKING_ERRORS = new Set(['23P01', 'P0006']);   // raw database codes, mapped inside the functions
  it('scanned a sensible number of codes', () => expect(found.size).toBeGreaterThan(25));
  it.each([...found].filter((c) => !NOT_BOOKING_ERRORS.has(c)))('%s has guidance', (code) => expect(ERROR_CATALOG[code], code).toBeTruthy());
  it('no booking function returns an error without a code', () => {
    expect(fnBody('createBooking')).not.toMatch(/error: \{ message: /);
  });
});
