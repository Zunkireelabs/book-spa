import { describe, it, expect } from 'vitest';
import {
  weekDatesOf, groupBookingsByTherapist, bookingSummary, serviceAccess, buildTherapistsOverview, stripStats, needsYouNow, segmentOf, inSegment,
  sortTherapists, matchesSearch, addDaysStr,
} from './therapistsOverview';

const DATE = '2026-10-26'; // a Monday

const mkRaw = (over = {}) => ({
  therapists: [
    { id: 't1', name: 'Rojina Tamang', gender: 'Female', position: 'Senior therapist', is_service_staff: true, is_active: true, branch_id: 'b', phone: '9841203311' },
    { id: 't2', name: 'Sita Gurung', gender: 'Female', position: 'Therapist', is_service_staff: true, is_active: true, branch_id: 'b', phone: '9802214410' },
    { id: 't3', name: 'Kabita Thapa', gender: 'Female', position: 'Therapist', is_service_staff: true, is_active: true, branch_id: 'b', phone: '' },
    { id: 't4', name: 'Front Desk', gender: 'Male', position: 'Receptionist', is_service_staff: false, is_active: true, branch_id: 'b', phone: '' },
  ],
  hoursRows: [
    { therapist_id: 't1', day_of_week: 0, start_time: '10:00:00', end_time: '19:00:00', is_day_off: false, therapist_working_hours_breaks: [{ name: 'Lunch', start_time: '13:00', end_time: '14:00', sort_order: 0 }] },
    { therapist_id: 't2', day_of_week: 0, start_time: '10:00:00', end_time: '19:00:00', is_day_off: false, therapist_working_hours_breaks: [] },
    { therapist_id: 't3', day_of_week: 0, start_time: '10:00:00', end_time: '19:00:00', is_day_off: true, therapist_working_hours_breaks: [] },
    { therapist_id: 't3', day_of_week: 1, start_time: '10:00:00', end_time: '19:00:00', is_day_off: false, therapist_working_hours_breaks: [] },
  ],
  overrideRows: [],
  attendanceRows: [{ therapist_id: 't1', status: 'Present', check_in_time: '2026-10-26T04:07:00Z', check_out_time: null }],
  bookingRows: [
    { id: 'b1', therapist_id: 't1', status: 'Completed', start_time: '10:15:00', end_time: '11:15:00', customer_name: 'A', service_name_snapshot: 'Deep tissue' },
    { id: 'b2', therapist_id: 't1', status: 'Confirmed', start_time: '15:00:00', end_time: '16:00:00', customer_name: 'B', service_name_snapshot: 'Swedish' },
    { id: 'b3', therapist_id: 't2', status: 'Confirmed', start_time: '14:00:00', end_time: '15:00:00', customer_name: 'C', service_name_snapshot: 'Swedish' },
    { id: 'b4', therapist_id: 't2', status: 'Cancelled', start_time: '12:00:00', end_time: '13:00:00', customer_name: 'D', service_name_snapshot: 'Swedish' },
  ],
  links: [{ service_id: 's2', therapist_id: 't1' }],
  services: [
    { id: 's1', name: 'Swedish', is_active: true, requires_therapist: true },
    { id: 's2', name: 'Hot stone', is_active: true, requires_therapist: true },
    { id: 's3', name: 'Sauna', is_active: true, requires_therapist: false },
    { id: 's4', name: 'Retired', is_active: false, requires_therapist: true },
  ],
  compRows: [{ therapist_id: 't1', monthly_salary: '28000', commission_rate: '12', product_commission_rate: '5' }],
  ...over,
});

describe('weekDatesOf', () => {
  it('runs Monday..Sunday around the date', () => {
    expect(weekDatesOf('2026-10-26')[0]).toBe('2026-10-26');
    expect(weekDatesOf('2026-10-26')[6]).toBe('2026-11-01');
    expect(weekDatesOf('2026-10-25')[0]).toBe('2026-10-19'); // a Sunday belongs to the week that started the Monday before
  });
  it('adds days across a month end', () => expect(addDaysStr('2026-10-31', 1)).toBe('2026-11-01'));
});

describe('groupBookingsByTherapist', () => {
  it('leaves out Cancelled / No Show and sorts by start', () => {
    const m = groupBookingsByTherapist(mkRaw().bookingRows);
    expect(m.get('t2').map((e) => e.bookingId)).toEqual(['b3']);
    expect(m.get('t1').map((e) => e.start)).toEqual(['10:15', '15:00']);
  });
  it('gives a combo component to its own therapist and a shared booking to each', () => {
    const m = groupBookingsByTherapist([
      { id: 'c', therapist_id: 'x', status: 'Confirmed', start_time: '10:00', end_time: '12:00', booking_combo_items: [
        { therapist_id: 'a', start_time: '10:00', end_time: '11:00', service: { name: 'One' } }, { therapist_id: 'b', start_time: '11:00', end_time: '12:00', service: { name: 'Two' } }] },
      { id: 's', therapist_id: 'a', status: 'Confirmed', start_time: '13:00', end_time: '14:00', booking_therapists: [{ therapist_id: 'a' }, { therapist_id: 'b' }] },
    ]);
    expect(m.get('a').map((e) => e.service)).toEqual(['One', '']);
    expect(m.get('b').map((e) => e.start)).toEqual(['11:00', '13:00']);
    expect(m.has('x')).toBe(false);
  });
});

describe('bookingSummary', () => {
  const e = (start, status) => ({ bookingId: start, start, status });
  it('says "first" before anything has started and "next" after', () => {
    expect(bookingSummary([e('11:30', 'Confirmed')], '09:00').firstOrNext).toEqual({ kind: 'first', time: '11:30' });
    expect(bookingSummary([e('10:00', 'Completed'), e('12:30', 'Confirmed')], '11:00').firstOrNext).toEqual({ kind: 'next', time: '12:30' });
  });
  it('has no next when the rest of the day is done', () => expect(bookingSummary([e('10:00', 'Completed')], '17:00').firstOrNext).toBeNull());
  it('counts distinct bookings and gives dots', () => {
    const s = bookingSummary([e('10:00', 'Completed'), e('12:00', 'In-Progress'), e('15:00', 'Confirmed')], '12:10');
    expect(s.count).toBe(3);
    expect(s.dots).toEqual(['done', 'now', 'todo']);
  });
});

describe('serviceAccess', () => {
  it('open services count for everyone, restricted ones only for the linked, never inactive / no-therapist ones', () => {
    const a = serviceAccess({ services: mkRaw().services, links: mkRaw().links });
    expect(a.total).toBe(2);
    expect(a.namesFor('t1')).toEqual(['Hot stone', 'Swedish']);
    expect(a.namesFor('t2')).toEqual(['Swedish']);
  });
});

describe('buildTherapistsOverview', () => {
  const ov = buildTherapistsOverview(mkRaw(), { date: DATE, nowTime: '12:00', canSeeRates: true });
  const by = (id) => ov.therapists.find((t) => t.id === id);
  it('statuses: checked in / not checked in / weekly day off / support', () => {
    expect(by('t1').status.key).toBe('checked-in');
    expect(by('t1').status.checkedInAt).toBe('09:52'); // 04:07Z = 09:52 Nepal
    expect(by('t2').status.key).toBe('not-checked-in');
    expect(by('t3').status.key).toBe('off');
    expect(by('t3').worksTomorrow).toBe(true);
  });
  it('week minutes take breaks off', () => expect(by('t1').weekMinutes).toBe(480)); // Monday 9h - 1h lunch
  it('counts only real bookings today and the services each can do', () => {
    expect(ov.bookingsToday).toBe(3);
    expect(by('t1').bookings.count).toBe(2);
    expect(by('t2').serviceCount).toBe(1);
    expect(ov.totalServices).toBe(2);
  });
  it('rates only when the caller may see them', () => {
    expect(by('t1').rates).toEqual({ monthlySalary: 28000, servicePct: 12, productPct: 5 });
    const hidden = buildTherapistsOverview(mkRaw(), { date: DATE, nowTime: '12:00', canSeeRates: false });
    expect(hidden.therapists.every((t) => t.rates === null)).toBe(true);
  });
  it('flags unreadable rates for a caller who sees no compensation rows at all', () => {
    expect(buildTherapistsOverview(mkRaw({ compRows: [] }), { date: DATE, nowTime: '12:00', canSeeRates: true }).ratesReadable).toBe(false);
    expect(ov.ratesReadable).toBe(true);
  });
  it('a roster override for the day beats the weekly row', () => {
    const o = buildTherapistsOverview(mkRaw({ overrideRows: [{ therapist_id: 't2', override_date: DATE, start_time: '16:00', end_time: '20:00', is_day_off: false }] }), { date: DATE, nowTime: '12:00' });
    expect(o.therapists.find((t) => t.id === 't2').status.key).toBe('upcoming');
  });
});

describe('strip + needs you now', () => {
  const ov = buildTherapistsOverview(mkRaw(), { date: DATE, nowTime: '12:00', canSeeRates: true });
  const active = ov.therapists;
  it('segments', () => {
    expect(active.map(segmentOf)).toEqual(['working', 'working', 'off', 'support']);
    expect(inSegment(active[1], 'notin')).toBe(true);
    expect(inSegment(active[0], 'notin')).toBe(false);
    expect(inSegment(active[3], 'support')).toBe(true);
    expect(inSegment(active[0], '')).toBe(true);
  });
  it('stats', () => {
    const s = stripStats(active, { nowTime: '12:00' });
    expect(s.working).toMatchObject({ count: 2, sub: 'of 3 service staff', hint: '1 checked in · 1 not yet' });
    expect(s.notin.count).toBe(1);
    expect(s.notin.hint).toBe('Oldest: 10:00, 2 h 0 m ago');
    expect(s.off).toMatchObject({ count: 1, hint: 'Back tomorrow: 1' });
    expect(s.support.count).toBe(1);
  });
  it('needs you now only with upcoming bookings', () => {
    const n = needsYouNow(active, { nowTime: '12:00' });
    expect(n.ids).toEqual(['t2']);
    expect(n.text).toBe("Sita hasn't checked in · 1 booking still to come");
    expect(needsYouNow(active, { nowTime: '15:30' })).toBeNull(); // nothing left to come for Sita
  });
});

describe('sort + search', () => {
  const ov = buildTherapistsOverview(mkRaw(), { date: DATE, nowTime: '12:00' });
  it('sorts', () => {
    expect(sortTherapists(ov.therapists, 'calendar').map((t) => t.id)).toEqual(['t1', 't2', 't3', 't4']);
    expect(sortTherapists(ov.therapists, 'name').map((t) => t.name)[0]).toBe('Front Desk');
    expect(sortTherapists(ov.therapists, 'busiest').map((t) => t.id).slice(0, 2)).toEqual(['t1', 't2']);
  });
  it('searches name, position and phone digits', () => {
    expect(matchesSearch(ov.therapists[0], 'roji')).toBe(true);
    expect(matchesSearch(ov.therapists[0], '984 120')).toBe(true);
    expect(matchesSearch(ov.therapists[3], 'reception')).toBe(true);
    expect(matchesSearch(ov.therapists[1], 'zzz')).toBe(false);
  });
});
