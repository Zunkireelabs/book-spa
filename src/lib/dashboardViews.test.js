import { describe, it, expect, beforeEach } from 'vitest';
import { availableViews, defaultView, hasOwnBookingsToday, dayPhase, rememberView, readRememberedView } from './dashboardViews';

describe('availableViews', () => {
  it('lists views per role', () => {
    expect(availableViews({ role: 'admin', branchCount: 3 })).toEqual(['business', 'branch', 'frontdesk', 'myday']);
    expect(availableViews({ role: 'manager', branchCount: 3 })).toEqual(['branch', 'frontdesk', 'myday']);
    expect(availableViews({ role: 'staff', branchCount: 3 })).toEqual(['frontdesk', 'myday']);
    expect(availableViews({ role: 'admin_viewer', branchCount: 3 })).toEqual(['business', 'branch']);
  });
  it('hides Business for a one-branch tenant', () => {
    expect(availableViews({ role: 'admin', branchCount: 1 })).toEqual(['branch', 'frontdesk', 'myday']);
    expect(availableViews({ role: 'admin_viewer', branchCount: 1 })).toEqual(['branch']);
  });
});

describe('defaultView', () => {
  it('admin on All branches opens Business; one branch opens Branch', () => {
    expect(defaultView({ role: 'admin', branchCount: 3, isOverall: true })).toBe('business');
    expect(defaultView({ role: 'admin', branchCount: 3, isOverall: false })).toBe('branch');
    expect(defaultView({ role: 'admin', branchCount: 1, isOverall: true })).toBe('branch');
  });
  it('admin_viewer on All branches opens Business like admin', () => {
    expect(defaultView({ role: 'admin_viewer', branchCount: 3, isOverall: true })).toBe('business');
    expect(defaultView({ role: 'admin_viewer', branchCount: 3, isOverall: false })).toBe('branch');
  });
  it('manager opens Branch', () => {
    expect(defaultView({ role: 'manager', branchCount: 2 })).toBe('branch');
  });
  it('staff opens My day only with bookings today', () => {
    expect(defaultView({ role: 'staff', hasBookingsToday: true })).toBe('myday');
    expect(defaultView({ role: 'staff', hasBookingsToday: false })).toBe('frontdesk');
  });
  it('on Overall, admin and admin_viewer always see Business, even with a remembered pick', () => {
    expect(defaultView({ role: 'admin', branchCount: 3, isOverall: true, remembered: 'frontdesk' })).toBe('business');
  });
  it('on a concrete branch Business is never the view', () => {
    expect(defaultView({ role: 'admin', branchCount: 3, isOverall: false, remembered: 'business' })).toBe('branch');
  });
  it('a remembered view wins while available', () => {
    expect(defaultView({ role: 'manager', remembered: 'frontdesk' })).toBe('frontdesk');
    expect(defaultView({ role: 'manager', remembered: 'business' })).toBe('branch');
  });
});

describe('dayPhase', () => {
  const hours = { open: '09:00:00', close: '21:00:00' };
  it('splits the day into prep, live and close', () => {
    expect(dayPhase('08:00', hours)).toBe('prep');
    expect(dayPhase('09:59', hours)).toBe('prep');
    expect(dayPhase('10:00', hours)).toBe('live');
    expect(dayPhase('19:59', hours)).toBe('live');
    expect(dayPhase('20:00', hours)).toBe('close');
    expect(dayPhase('23:00', hours)).toBe('close');
  });
  it('falls back to live without usable hours', () => {
    expect(dayPhase('08:00')).toBe('live');
    expect(dayPhase('08:00', { open: null, close: null })).toBe('live');
    expect(dayPhase('08:00', { open: '21:00', close: '09:00' })).toBe('live');
  });
});

describe('remembered view storage', () => {
  beforeEach(() => { try { window.localStorage.clear(); } catch { /* jsdom/node without storage */ } });
  it('never throws and returns null for no user', () => {
    expect(readRememberedView(null)).toBeNull();
    expect(() => rememberView('u1', 'branch')).not.toThrow();
  });
});

describe('hasOwnBookingsToday', () => {
  const bookings = [{ therapists: [{ name: 'Sita  Rai' }] }, { therapist: { name: 'Hari' } }, { therapists: [] }];
  it('matches the user by assigned therapist name, ignoring case and spacing', () => {
    expect(hasOwnBookingsToday(bookings, 'sita rai')).toBe(true);
    expect(hasOwnBookingsToday(bookings, 'Hari')).toBe(true);
  });
  it('is false for other people, no name, or no bookings', () => {
    expect(hasOwnBookingsToday(bookings, 'Maya')).toBe(false);
    expect(hasOwnBookingsToday(bookings, '')).toBe(false);
    expect(hasOwnBookingsToday(null, 'Hari')).toBe(false);
  });
});
