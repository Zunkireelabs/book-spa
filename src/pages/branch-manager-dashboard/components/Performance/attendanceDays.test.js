import { describe, it, expect } from 'vitest';
import { attendanceDays, busyMinutesInSpans, netShiftMinutes, rangesText, dayChips, attendanceCsvRows } from './therapistInnerView';

// 2026-10-xx 09:28 Nepal = 03:43 UTC. Helper builds an ISO for a Nepal wall-clock time.
const npt = (date, hhmm) => new Date(`${date}T${hhmm}:00+05:45`).toISOString();
const shift = (date, o = {}) => ({ shift_date: date, works: true, start_time: '09:00:00', end_time: '18:00:00', source: 'weekly', breaks: [], off: [], ...o });
const NOW = new Date('2026-11-01T10:00:00+05:45').getTime();
const run = (shifts, rows, from = '2026-10-01', to = '2026-10-31', extra = {}) => attendanceDays({ shifts, rows, from, to, now: NOW, branchHours: { open: '09:00:00', close: '21:00:00' }, settings: { expectCheckIn: true }, ...extra });
const row = (date, status, inT, outT, o = {}) => ({ date, status, check_in_time: inT ? npt(date, inT) : null, check_out_time: outT ? npt(date, outT) : null, ...o });
const day = (att, d) => att.days.find((x) => x.date === d);

describe('netShiftMinutes', () => {
  it('end − start − breaks − off, same as migration 339', () => {
    expect(netShiftMinutes(shift('2026-10-15', { off: [{ start_min: 600, end_min: 660 }] }))).toBe(480);
    expect(netShiftMinutes(shift('2026-10-15', { breaks: [{ start_min: 780, end_min: 840 }], off: [{ start_min: 600, end_min: 630 }] }))).toBe(450);
    expect(netShiftMinutes(shift('2026-10-15', { end_time: '23:59:59' }))).toBe(900); // 24:00 end
  });
  it('0 when not working, no times, or source none', () => {
    expect(netShiftMinutes(shift('x', { works: false }))).toBe(0);
    expect(netShiftMinutes(shift('x', { start_time: null }))).toBe(0);
    expect(netShiftMinutes(shift('x', { source: 'none' }))).toBe(0);
    expect(netShiftMinutes(shift('x', { off: [{ start_min: 0, end_min: 1440 }] }))).toBe(0);
  });
});

describe('attendanceDays: roster and not rostered', () => {
  const dates = ['2026-10-05', '2026-10-06', '2026-10-07'];
  const att = run([shift('2026-10-05', { off: [{ start_min: 540, end_min: 1080, label: 'test closed' }] }), shift('2026-10-06', { works: false }), shift('2026-10-07')], [], '2026-10-05', '2026-10-07');
  it('blocked all day shows the block label, no shift says so', () => {
    expect(dates.map((d) => day(att, d).kind)).toEqual(['notRostered', 'notRostered', 'notMarked']);
    expect(day(att, '2026-10-05').reason).toBe('test closed');
    expect(day(att, '2026-10-06').reason).toBe('no shift');
  });
  it('totals: rostered days + minutes, not marked ranges', () => {
    expect(att.totals.rosteredDays).toBe(1);
    expect(att.totals.rosteredMin).toBe(540);
    expect(att.totals.notMarked).toBe(1);
    expect(att.totals.notMarkedText).toBe('7 Oct');
  });
});

describe('attendanceDays: worked, late, early, stayed', () => {
  const S = [shift('2026-10-26'), shift('2026-10-27'), shift('2026-10-28'), shift('2026-10-29'), shift('2026-10-30')];
  it('worked only when BOTH times exist; whole minutes; judged vs own shift (not branch 21:00)', () => {
    const a = run(S, [row('2026-10-26', 'Present', '09:28', '11:00'), row('2026-10-27', 'Present', null, null)]);
    const d = day(a, '2026-10-26');
    expect(d.workedMin).toBe(92);
    expect(d.lateMin).toBe(28);
    expect(d.earlyMin).toBe(420); // 18:00 − 11:00, not vs 21:00
    expect(day(a, '2026-10-27').workedMin).toBeNull();
    expect(a.totals.clockedMin).toBe(92);
    expect(a.totals.clockDays).toBe(1);
    expect(a.totals.onTime).toBe(0);
    expect(a.totals.noTimeDates).toEqual(['2026-10-27']);
  });
  it('grace edge: exactly 10 min is on time, 11 is late; same for leaving', () => {
    const a = run(S, [row('2026-10-26', 'Present', '09:10', '17:50'), row('2026-10-27', 'Present', '09:11', '17:49'), row('2026-10-28', 'Present', '09:00', '18:11')]);
    expect(day(a, '2026-10-26').lateMin).toBeNull(); expect(day(a, '2026-10-26').earlyMin).toBeNull();
    expect(day(a, '2026-10-27').lateMin).toBe(11); expect(day(a, '2026-10-27').earlyMin).toBe(11);
    expect(day(a, '2026-10-28').longerMin).toBe(11);
    expect(a.totals.onTime).toBe(2); // 26 and 28
  });
  it('check-in only: late judged, worked null, no early', () => {
    const a = run(S, [row('2026-10-26', 'Present', '09:30', null)]);
    const d = day(a, '2026-10-26');
    expect(d.lateMin).toBe(30); expect(d.earlyMin).toBeNull(); expect(d.workedMin).toBeNull();
    expect(a.totals.clockDays).toBe(0);
    expect(dayChips(d).note).toBe('no check-out recorded');
  });
  it('half day is not judged but its real worked time counts', () => {
    const a = run(S, [row('2026-10-26', '1st-Half Day', '09:45', '12:00')]);
    const d = day(a, '2026-10-26');
    expect(d.kind).toBe('half'); expect(d.half).toBe('morning');
    expect(d.lateMin).toBeNull(); expect(d.workedMin).toBe(135);
  });
});

describe('attendanceDays: statuses, extra, today, future, no roster', () => {
  it('excused leave and absent are marked but never late; unmarked is not absent', () => {
    const a = run([shift('2026-10-26'), shift('2026-10-27'), shift('2026-10-28')], [row('2026-10-26', 'Sick Leave'), row('2026-10-27', 'Absent')], '2026-10-26', '2026-10-28');
    expect(day(a, '2026-10-26')).toMatchObject({ kind: 'leave', label: 'Sick Leave' });
    expect(day(a, '2026-10-27').kind).toBe('absent');
    expect(day(a, '2026-10-28').kind).toBe('notMarked');
    expect(a.totals.markedRostered).toBe(2);
  });
  it('extra day: present with no shift, judged against branch hours, says so', () => {
    const a = run([shift('2026-10-26', { works: false })], [row('2026-10-26', 'Present', '09:00', '15:00')], '2026-10-26', '2026-10-26');
    const d = day(a, '2026-10-26');
    expect(d.kind).toBe('extra'); expect(d.branchHoursUsed).toBe(true);
    expect(d.earlyMin).toBe(360); // 21:00 − 15:00
    expect(a.totals.extraDays).toBe(1); expect(a.totals.rosteredDays).toBe(0);
    expect(dayChips(d).note).toBe('no roster, branch hours used');
  });
  it('today unmarked is "today", future is "future"; neither counts as not marked', () => {
    const a = run([shift('2026-10-31'), shift('2026-11-01'), shift('2026-11-02')], [], '2026-10-31', '2026-11-02');
    expect(a.days.map((d) => d.kind)).toEqual(['notMarked', 'today', 'future']);
    expect(a.totals.notMarked).toBe(1); expect(a.totals.todayUnmarked).toBe(true);
  });
});

describe('rangesText + csv', () => {
  it('joins calendar-adjacent days', () => {
    expect(rangesText(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-07', '2026-10-28', '2026-10-29', '2026-10-30'])).toBe('1–4, 7 and 28–30 Oct');
    expect(rangesText(['2026-10-31', '2026-11-01'])).toBe('31 Oct–1 Nov');
  });
  it('one CSV row per day with the agreed columns', () => {
    const a = run([shift('2026-10-05', { works: false, off: [{ label: 'test closed', start_min: 0, end_min: 1440 }] }), shift('2026-10-26')], [row('2026-10-26', 'Present', '09:28', '11:00')], '2026-10-05', '2026-10-26');
    const rows = attendanceCsvRows(a);
    expect(rows).toHaveLength(1 + 22);
    expect(rows[0]).toEqual(['Date', 'Status', 'Shift start', 'Shift end', 'Rostered minutes', 'In', 'Out', 'Worked minutes', 'Late minutes', 'Left early minutes', 'Note']);
    expect(rows[1]).toEqual(['2026-10-05', 'Not rostered', '', '', 0, '', '', '', '', '', 'test closed']);
    expect(rows[22]).toEqual(['2026-10-26', 'Present', '09:00', '18:00', 540, '09:28', '11:00', 92, 28, 420, '']);
  });
});

describe('busyMinutesInSpans', () => {
  const span = [{ inMs: Date.parse(npt('2026-10-26', '09:28')), outMs: Date.parse(npt('2026-10-26', '11:00')) }];
  const bk = (from, to, status = 'Completed') => ({ status, start_datetime: npt('2026-10-26', from), end_datetime: npt('2026-10-26', to) });
  it('a booking inside the span counts in full; Govinda 75 of 92', () => {
    expect(busyMinutesInSpans([bk('09:30', '10:45')], span)).toBe(75);
  });
  it('after clock-out adds 0; half inside adds the inside half', () => {
    expect(busyMinutesInSpans([bk('15:00', '16:00')], span)).toBe(0);
    expect(busyMinutesInSpans([bk('10:30', '11:30')], span)).toBe(30);
  });
  it('ignores non-Completed and bookings on other days', () => {
    expect(busyMinutesInSpans([bk('09:30', '10:45', 'Pending'), { status: 'Completed', start_datetime: npt('2026-10-25', '09:30'), end_datetime: npt('2026-10-25', '10:45') }], span)).toBe(0);
  });
});

describe('rostered so far', () => {
  const S = [shift('2026-10-30'), shift('2026-10-31'), shift('2026-11-01'), shift('2026-11-02')]; // NOW = 1 Nov
  it('today unmarked is outside the count; marked + not marked = rostered so far', () => {
    const t = run(S, [row('2026-10-30', 'Present', '09:00', '18:00')], '2026-10-30', '2026-11-02').totals;
    expect(t.rosteredDays).toBe(4); expect(t.rosteredSoFar).toBe(2);
    expect(t.markedRostered + t.notMarked).toBe(t.rosteredSoFar);
    expect(t.includesToday).toBe(true);
  });
  it('today marked joins the count', () => {
    const t = run(S, [row('2026-10-30', 'Present'), row('2026-11-01', 'Present')], '2026-10-30', '2026-11-02').totals;
    expect(t.rosteredSoFar).toBe(3);
    expect(t.markedRostered + t.notMarked).toBe(3);
  });
  it('a finished period counts every rostered day', () => {
    const t = run(S, [], '2026-10-30', '2026-10-31').totals;
    expect(t.includesToday).toBe(false); expect(t.rosteredSoFar).toBe(2); expect(t.notMarked).toBe(2);
  });
});

describe('Expect check-in switch (ZNLY-183)', () => {
  const S = [shift('2026-10-26'), shift('2026-10-27'), shift('2026-10-28'), shift('2026-10-29')];
  const rows = [row('2026-10-26', 'Present', '09:28', '11:00'), row('2026-10-27', 'Absent')];
  const go = (expectCheckIn) => run(S, rows, '2026-10-26', '2026-10-29', { settings: { expectCheckIn } }).totals;
  it('OFF: rostered past days with no record are "No check-in" and count present', () => {
    const t = go(false);
    expect(t.noCheckin).toBe(2); expect(t.notMarked).toBe(0);
    expect(t.knownDays).toBe(4); expect(t.presentDays).toBe(3); // present + 2 no check-in; Absent known, not present
    expect(t.noCheckinText).toBe('28–29 Oct');
  });
  it('ON: same days are Not marked, unknown, left out of the %', () => {
    const t = go(true);
    expect(t.noCheckin).toBe(0); expect(t.notMarked).toBe(2);
    expect(t.knownDays).toBe(2); expect(t.presentDays).toBe(1);
  });
  it('Govinda-like: 2 marked present + the rest no check-in = 27 of 27 when OFF, 2 of 2 when ON', () => {
    const days = Array.from({ length: 27 }, (_, i) => shift(`2026-10-${String(i + 1).padStart(2, '0')}`));
    const r = [row('2026-10-26', 'Present', '09:28', '11:00'), row('2026-10-27', 'Present')];
    const off = run(days, r, '2026-10-01', '2026-10-27', { settings: { expectCheckIn: false } }).totals;
    const on = run(days, r, '2026-10-01', '2026-10-27', { settings: { expectCheckIn: true } }).totals;
    expect([off.presentDays, off.knownDays, off.noCheckin]).toEqual([27, 27, 25]);
    expect([on.presentDays, on.knownDays, on.notMarked]).toEqual([2, 2, 25]);
    expect(off.clockedMin).toBe(on.clockedMin); // times unchanged by the switch
  });
  it('grace comes from the branch: 15 min late is on time at grace 20, late at grace 10', () => {
    const r = [row('2026-10-26', 'Present', '09:15', '18:00')];
    const at = (g) => day(run(S, r, '2026-10-26', '2026-10-26', { settings: { expectCheckIn: true, lateGraceMinutes: g } }), '2026-10-26').lateMin;
    expect(at(20)).toBeNull(); expect(at(10)).toBe(15);
  });
  it('CSV marks no-check-in days', () => {
    const rowsCsv = attendanceCsvRows(run(S, [], '2026-10-26', '2026-10-26', { settings: { expectCheckIn: false } }));
    expect(rowsCsv[1][1]).toBe('No check-in'); expect(rowsCsv[1][10]).toBe('counted present, no check-in');
  });
});
