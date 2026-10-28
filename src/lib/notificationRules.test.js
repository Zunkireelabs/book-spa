import { describe, it, expect } from 'vitest';
import {
  categoryOf, groupNotifications, groupUnread, badgeText, isWithinOpeningHours, canPlaySound, evaluateLiveEvent,
  isBurst, categoriesForRole, DEFAULT_PREFS,
} from './notificationRules';

const at = (min) => new Date(Date.UTC(2026, 9, 28, 6, 0, 0) - min * 60000).toISOString();
const online = (id, minAgo, branchId = 'L', read = false) => ({ id, type: 'new_online_booking', branchId, read, createdAt: at(minAgo) });

describe('categoryOf', () => {
  it.each([
    ['new_online_booking', 'bookings'], ['discount_approved', 'approvals'], ['discount_declined', 'approvals'],
    ['transferred_staff_reminder', 'team'], ['low_stock', 'stock'], ['outreach_review_pending', 'guests'],
    ['something_new', 'bookings'],
  ])('%s -> %s', (t, c) => expect(categoryOf(t)).toBe(c));
});

describe('groupNotifications', () => {
  it('groups online bookings of one branch within 10 minutes', () => {
    const g = groupNotifications([online('a', 0), online('b', 3), online('c', 9)]);
    expect(g).toHaveLength(1);
    expect(g[0].kind).toBe('group');
    expect(g[0].items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
  it('does not group across branches or beyond 10 minutes', () => {
    const g = groupNotifications([online('a', 0, 'L'), online('b', 2, 'S'), online('c', 15, 'L')]);
    expect(g.every((e) => e.kind === 'single')).toBe(true);
  });
  it('caps a group at 5', () => {
    const g = groupNotifications([0, 1, 2, 3, 4, 5, 6].map((m) => online(`n${m}`, m)));
    expect(g[0].items).toHaveLength(5);
    expect(g[1].items).toHaveLength(2);
  });
  it('never groups anything else', () => {
    const d = (id, m) => ({ id, type: 'discount_approved', branchId: 'L', read: false, createdAt: at(m) });
    expect(groupNotifications([d('x', 0), d('y', 1)]).every((e) => e.kind === 'single')).toBe(true);
  });
  it('counts unread per item inside a group', () => {
    const g = groupNotifications([online('a', 0), online('b', 1, 'L', true), online('c', 2)]);
    expect(groupUnread(g[0])).toBe(2);
  });
});

describe('badgeText', () => {
  it('caps at 99+', () => { expect(badgeText(99)).toBe('99'); expect(badgeText(100)).toBe('99+'); });
});

describe('opening hours (Nepal time)', () => {
  const br = { open_time: '09:00:00', close_time: '21:00:00', timezone: 'Asia/Kathmandu' };
  it('inside / outside', () => {
    expect(isWithinOpeningHours(br, new Date('2026-10-28T06:00:00Z'))).toBe(true); // 11:45 NPT
    expect(isWithinOpeningHours(br, new Date('2026-10-28T17:00:00Z'))).toBe(false); // 22:45 NPT
  });
  it('unknown branch is open', () => expect(isWithinOpeningHours(null)).toBe(true));
});

describe('evaluateLiveEvent gate', () => {
  const base = { userId: 'u1', prefs: {}, settings: {}, branch: null, now: new Date('2026-10-28T06:00:00Z') };
  const row = (o = {}) => ({ category: 'bookings', read: false, ...o });
  it('uses the defaults with no prefs row', () => {
    expect(evaluateLiveEvent({ ...base, row: row() })).toEqual({ popup: true, sound: true });
    expect(evaluateLiveEvent({ ...base, row: row({ category: 'team' }) })).toEqual({ popup: true, sound: false });
    expect(evaluateLiveEvent({ ...base, row: row({ category: 'stock' }) })).toEqual({ popup: false, sound: false });
  });
  it('respects an explicit pref', () => {
    const prefs = { bookings: { popup: false, sound: true } };
    expect(evaluateLiveEvent({ ...base, prefs, row: row() })).toEqual({ popup: false, sound: true });
  });
  it('global sound switch silences the chime only', () => {
    expect(evaluateLiveEvent({ ...base, settings: { sound_enabled: false }, row: row() })).toEqual({ popup: true, sound: false });
  });
  it("ignores the user's own action and already-read rows", () => {
    expect(evaluateLiveEvent({ ...base, row: row({ actorId: 'u1' }) })).toEqual({ popup: false, sound: false });
    expect(evaluateLiveEvent({ ...base, row: row({ read: true }) })).toEqual({ popup: false, sound: false });
  });
  it('is quiet outside opening hours unless switched off', () => {
    const branch = { open_time: '09:00', close_time: '21:00' };
    const night = new Date('2026-10-28T17:00:00Z');
    expect(evaluateLiveEvent({ ...base, branch, now: night, row: row() })).toEqual({ popup: false, sound: false });
    expect(evaluateLiveEvent({ ...base, branch, now: night, settings: { quiet_outside_hours: false }, row: row() }).popup).toBe(true);
  });
});

describe('rate limit + burst + roles', () => {
  it('sound at most once per 10 s', () => {
    expect(canPlaySound(null, 1000)).toBe(true);
    expect(canPlaySound(1000, 5000)).toBe(false);
    expect(canPlaySound(1000, 11000)).toBe(true);
  });
  it('5 arrivals in a minute is a burst', () => {
    const now = 100000;
    expect(isBurst([now - 50000, now - 40000, now - 30000, now - 20000], now)).toBe(false);
    expect(isBurst([now - 50000, now - 40000, now - 30000, now - 20000, now - 1000], now)).toBe(true);
    expect(isBurst([now - 90000, now - 80000, now - 70000, now - 65000, now - 1000], now)).toBe(false);
  });
  it('front desk sees bookings + approvals tabs only', () => {
    expect(categoriesForRole('staff')).toEqual(['bookings', 'approvals']);
    expect(categoriesForRole('manager')).toHaveLength(5);
    expect(DEFAULT_PREFS.approvals.sound).toBe(true);
  });
});
