import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getCalendarStatic, setCalendarStatic, clearCalendarStatic } from './calendarStaticCache';
import { refreshLight } from '../pages/branch-manager-dashboard/components/calendar/refreshLight';

describe('calendar static cache', () => {
  beforeEach(() => { clearCalendarStatic(); vi.useRealTimers(); });
  it('returns what was saved for the same key and nothing for another key', () => {
    setCalendarStatic('b1|2026-11-20|2026-11-20|u1', { rooms: [1] });
    expect(getCalendarStatic('b1|2026-11-20|2026-11-20|u1')).toEqual({ rooms: [1] });
    expect(getCalendarStatic('b2|2026-11-20|2026-11-20|u1')).toBeNull(); // other branch
    expect(getCalendarStatic('b1|2026-11-21|2026-11-21|u1')).toBeNull(); // other range
    expect(getCalendarStatic('b1|2026-11-20|2026-11-20|u2')).toBeNull(); // other user / visibility
  });
  it('is dropped by clear (sign-out) and expires after ten minutes', () => {
    vi.useFakeTimers();
    setCalendarStatic('k', { a: 1 });
    vi.advanceTimersByTime(9 * 60 * 1000);
    expect(getCalendarStatic('k')).toEqual({ a: 1 });
    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(getCalendarStatic('k')).toBeNull();
    setCalendarStatic('k2', { a: 2 });
    clearCalendarStatic();
    expect(getCalendarStatic('k2')).toBeNull();
  });
  it('refreshLight uses the light refresh when there is one, else the normal one', () => {
    const light = vi.fn(); const full = Object.assign(vi.fn(), { light });
    refreshLight(full); expect(light).toHaveBeenCalledTimes(1); expect(full).not.toHaveBeenCalled();
    const plain = vi.fn(); refreshLight(plain); expect(plain).toHaveBeenCalledTimes(1);
    expect(() => refreshLight(undefined)).not.toThrow();
  });
});
