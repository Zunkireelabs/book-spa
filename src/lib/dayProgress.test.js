import { describe, it, expect } from 'vitest';
import { dayProgress, dayProgressOf, dayProgressText } from './dayProgress';

describe('dayProgress (ZNLY-276)', () => {
  it('the Nuad case: 50 completed + 1 no-show of 54 = 51 finished, 3 open', () => {
    const p = dayProgress({ bookings: 54, completed: 50, no_show: 1 });
    expect(p).toEqual({ total: 54, finished: 51, noShow: 1, open: 3 });
    expect(dayProgressText(p)).toBe('51 of 54 finished · 1 no-show');
  });
  it('no no-show: no suffix', () => { expect(dayProgressText(dayProgress({ bookings: 5, completed: 4 }))).toBe('4 of 5 finished'); });
  it('zero day', () => { expect(dayProgress({})).toEqual({ total: 0, finished: 0, noShow: 0, open: 0 }); expect(dayProgressText(dayProgress())).toBe('0 of 0 finished'); });
  it('from a list: cancelled is excluded, no-show is finished', () => {
    const p = dayProgressOf([{ status: 'Completed' }, { status: 'No Show' }, { status: 'Cancelled' }, { status: 'Confirmed' }, { status: 'In-Progress' }]);
    expect(p).toEqual({ total: 4, finished: 2, noShow: 1, open: 2 });
  });
  it('never more finished than total', () => { expect(dayProgress({ bookings: 2, completed: 5, no_show: 1 }).open).toBe(0); });
});
