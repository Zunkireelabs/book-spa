import { describe, it, expect } from 'vitest';
import {
  categoryOf, groupNotifications, groupUnread, badgeText, isWithinOpeningHours, canPlaySound, evaluateLiveEvent,
  isBurst, categoriesForRole, DEFAULT_PREFS, heardBranch, buildInboxFilter, escapeSearch, dayGroupLabel, groupByDayLabel, inboxHeadline,
} from './notificationRules';

const at = (min) => new Date(Date.UTC(2026, 9, 28, 6, 0, 0) - min * 60000).toISOString();
const online = (id, minAgo, branchId = 'L', read = false) => ({ id, type: 'new_online_booking', branchId, read, createdAt: at(minAgo) });

describe('categoryOf', () => {
  it.each([
    ['new_online_booking', 'bookings'], ['discount_approved', 'approvals'], ['discount_declined', 'approvals'],
    ['transferred_staff_reminder', 'team'], ['low_stock', 'stock'], ['outreach_review_pending', 'guests'],
    ['discount_big_fyi', 'approvals'], ['attendance_gaps', 'team'], ['attendance_gap', 'team'],
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
  it('actor gate: only the actor is skipped, others still hear it', () => {
    expect(evaluateLiveEvent({ ...base, row: row({ actorId: 'u2' }) })).toEqual({ popup: true, sound: true });
    expect(evaluateLiveEvent({ ...base, row: row({ actorId: null }) })).toEqual({ popup: true, sound: true });
  });
  it('per-type override: big-discount FYI is bell/Inbox only even though Approvals pops up', () => {
    expect(evaluateLiveEvent({ ...base, row: row({ category: 'approvals', type: 'discount_request' }) })).toEqual({ popup: true, sound: true });
    expect(evaluateLiveEvent({ ...base, row: row({ category: 'approvals', type: 'discount_big_fyi' }) })).toEqual({ popup: false, sound: false });
    // an explicit pref cannot turn the FYI into a pop-up
    expect(evaluateLiveEvent({ ...base, prefs: { approvals: { popup: true, sound: true } }, row: row({ category: 'approvals', type: 'discount_big_fyi' }) })).toEqual({ popup: false, sound: false });
  });
  it('per-type override: attendance gaps pop up with no sound', () => {
    const prefs = { team: { popup: true, sound: true } };
    expect(evaluateLiveEvent({ ...base, row: row({ category: 'team', type: 'attendance_gaps' }) })).toEqual({ popup: true, sound: false });
    expect(evaluateLiveEvent({ ...base, prefs, row: row({ category: 'team', type: 'attendance_gaps' }) })).toEqual({ popup: true, sound: false });
    expect(evaluateLiveEvent({ ...base, prefs: { team: { popup: false, sound: false } }, row: row({ category: 'team', type: 'attendance_gaps' }) }).popup).toBe(false);
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

describe('branches I hear from', () => {
  it('null / empty list = every branch; unscoped items always pass', () => {
    expect(heardBranch(null, 'L')).toBe(true);
    expect(heardBranch([], 'L')).toBe(true);
    expect(heardBranch(['S'], null)).toBe(true);
  });
  it('a list filters by branch', () => {
    expect(heardBranch(['S'], 'L')).toBe(false);
    expect(heardBranch(['S', 'L'], 'L')).toBe(true);
  });
  it('silences pop-up and sound for other branches, never for the chosen one', () => {
    const row = { category: 'bookings', branchId: 'L', read: false };
    const base = { row, userId: 'u', prefs: {}, branch: null, now: new Date() };
    expect(evaluateLiveEvent({ ...base, settings: { heard_branch_ids: ['S'], quiet_outside_hours: false } })).toEqual({ popup: false, sound: false });
    expect(evaluateLiveEvent({ ...base, settings: { heard_branch_ids: ['L'], quiet_outside_hours: false } })).toEqual({ popup: true, sound: true });
  });
});

describe('buildInboxFilter', () => {
  const now = new Date('2026-10-28T06:00:00Z');
  it('defaults to unread, every allowed category, a 90-day window', () => {
    const f = buildInboxFilter({ allowed: ['bookings', 'approvals'], now });
    expect(f.unreadOnly).toBe(true);
    expect(f.categories).toEqual(['bookings', 'approvals']);
    expect(f.since).toBe(new Date('2026-07-30T06:00:00Z').toISOString());
  });
  it('one category from ?c=, ignoring one the role cannot receive', () => {
    expect(buildInboxFilter({ category: 'approvals', now }).categories).toEqual(['approvals']);
    expect(buildInboxFilter({ category: 'stock', allowed: ['bookings', 'approvals'], now }).categories).toEqual(['bookings', 'approvals']);
  });
  it('carries branch, cursor and a sanitised search', () => {
    const f = buildInboxFilter({ branchId: 'L', before: '2026-10-28T05:00:00Z', search: ' Sita,(G)% ', unreadOnly: false, now });
    expect(f).toMatchObject({ branchId: 'L', before: '2026-10-28T05:00:00Z', search: 'Sita G', unreadOnly: false });
  });
  it('escapeSearch strips filter syntax', () => expect(escapeSearch('a,b)(c_%')).toBe('a b c'));
});

describe('inbox day groups + headline', () => {
  const now = new Date('2026-10-28T10:00:00Z'); // 15:45 in Nepal
  it('labels Today / Yesterday / a date by Nepal day', () => {
    expect(dayGroupLabel('2026-10-28T09:00:00Z', now)).toBe('Today');
    expect(dayGroupLabel('2026-10-27T10:00:00Z', now)).toBe('Yesterday');
    expect(dayGroupLabel('2026-10-20T10:00:00Z', now)).toBe('Tue 20 Oct');
    // 19:00Z on the 27th is already 00:45 on the 28th in Nepal
    expect(dayGroupLabel('2026-10-27T19:00:00Z', now)).toBe('Today');
  });
  it('never merges items', () => {
    const items = [{ id: 1, createdAt: '2026-10-28T09:00:00Z' }, { id: 2, createdAt: '2026-10-28T08:59:00Z' }, { id: 3, createdAt: '2026-10-27T09:00:00Z' }];
    const g = groupByDayLabel(items, now);
    expect(g.map((x) => [x.label, x.items.length])).toEqual([['Today', 2], ['Yesterday', 1]]);
  });
  it('headline mentions approvals only for approvers', () => {
    expect(inboxHeadline(12, 2, true)).toBe('12 unread · 2 need your approval');
    expect(inboxHeadline(12, 2, false)).toBe('12 unread');
    expect(inboxHeadline(0, 0, true)).toBe('0 unread');
  });
});
