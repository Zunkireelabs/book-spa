import { describe, it, expect } from 'vitest';
import { transferHoursWarning, spanText } from './transferHoursWarning';

// 2026-10-27 is a Tuesday (DB dow 1). Weekdays 09:00-18:00, Saturday off.
const weekly = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: d === 5 ? null : '09:00:00', endTime: d === 5 ? null : '18:00:00', isDayOff: d === 5 }));
const sanepa = { name: 'Sanepa', openTime: '09:00:00', closeTime: '21:00:00' };
const win = (d1, t1, d2, t2) => ({ windowStart: { date: d1, time: t1 }, windowEnd: { date: d2, time: t2 } });

describe('spanText', () => {
  it('shares am/pm when both ends agree', () => { expect(spanText(415 + 480 - 480, 1195)).toBe('6:55am–7:55pm'); expect(spanText(1135, 1195)).toBe('6:55–7:55pm'); });
  it('24h', () => expect(spanText(1135, 1195, true)).toBe('18:55–19:55'));
});

describe('transferHoursWarning', () => {
  it('window after the usual hours, inside branch hours', () => {
    expect(transferHoursWarning({ name: 'Govind', ...win('2026-10-27', '18:55', '2026-10-27', '20:55'), weeklyRows: weekly, branch: sanepa }))
      .toBe("Outside Govind's usual hours (9:00am–6:00pm). Govind will be bookable at Sanepa 6:55–8:55pm.");
  });
  it('window past the branch closing time', () => {
    expect(transferHoursWarning({ name: 'Govind', ...win('2026-10-27', '19:55', '2026-10-27', '22:30'), weeklyRows: weekly, branch: sanepa }))
      .toBe("Outside Sanepa's opening hours (9:00am–9:00pm). Govind will only be bookable there 7:55–9:00pm.");
  });
  it('a day off at home', () => {
    expect(transferHoursWarning({ name: 'Govind', ...win('2026-10-31', '10:00', '2026-10-31', '12:00'), weeklyRows: weekly, branch: sanepa }))
      .toContain("Outside Govind's usual hours (a day off).");
  });
  it('fully inside both: no warning', () => {
    expect(transferHoursWarning({ name: 'Govind', ...win('2026-10-27', '10:00', '2026-10-27', '15:00'), weeklyRows: weekly, branch: sanepa })).toBeNull();
  });
  it('no hours set: only branch hours matter; incomplete input: null', () => {
    expect(transferHoursWarning({ name: 'G', ...win('2026-10-27', '19:00', '2026-10-27', '20:00'), weeklyRows: [], branch: sanepa })).toBeNull();
    expect(transferHoursWarning({ name: 'G', windowStart: null, windowEnd: null, weeklyRows: weekly, branch: sanepa })).toBeNull();
  });
});
