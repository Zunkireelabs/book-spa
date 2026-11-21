import { describe, it, expect } from 'vitest';
import { score, matchLocal, buildActions } from './sources';

describe('score', () => {
  it('matches everything for an empty query', () => {
    expect(score('', 'Calendar')).toBeGreaterThan(0);
    expect(score('   ', 'Calendar')).toBeGreaterThan(0);
  });

  it('is case-insensitive and returns 0 when any word is missing', () => {
    expect(score('CALEN', 'Calendar schedule')).toBeGreaterThan(0);
    expect(score('calendar billing', 'Calendar schedule')).toBe(0);
  });

  it('ranks the start of a word above the middle of one, and earlier above later', () => {
    expect(score('rev', 'Service Revenue')).toBeGreaterThan(score('ven', 'Service Revenue'));
    expect(score('ser', 'Service Revenue')).toBeGreaterThan(score('rev', 'Service Revenue'));
  });
});

const base = { staffLabelPlural: 'Therapists', enableRooms: true, locationLabelPlural: 'Rooms', basePath: '/org/dashboard' };

describe('buildActions', () => {
  it('offers New booking outside Overall, never inside it', () => {
    expect(buildActions({ ...base, role: 'manager', isOverall: false }).map((a) => a.view)).toContain('new-booking');
    expect(buildActions({ ...base, role: 'admin', isOverall: true }).map((a) => a.view)).not.toContain('new-booking');
  });

  it('offers Collect payment to staff, manager and admin on a concrete branch (not admin_viewer, not Overall)', () => {
    const views = (o) => buildActions({ ...base, ...o }).map((a) => a.view);
    ['staff', 'manager', 'admin'].forEach((role) => expect(views({ role, isOverall: false })).toContain('collect-payment'));
    expect(views({ role: 'admin', isOverall: true })).not.toContain('collect-payment');
    expect(views({ role: 'admin_viewer', isOverall: false })).not.toContain('collect-payment');
  });
});

describe('matchLocal (role / Overall filtering of pages)', () => {
  const labels = (role, isOverall, q) => matchLocal(q, { ...base, role, isOverall }).pages.map((p) => p.label);

  it('gives staff no Reports or Settings pages', () => {
    expect(labels('staff', false, 'report')).toEqual([]);
    expect(labels('staff', false, 'settings')).toEqual([]);
  });

  it('hides admin-only settings from a manager and Reward Catalog from a viewer', () => {
    expect(labels('manager', false, 'payment methods')).toEqual([]);
    expect(labels('admin_viewer', false, 'reward')).toEqual([]);
  });

  it('labels the rooms page with the industry location label', () => {
    expect(labels('manager', false, 'rooms')).toContain('Rooms');
  });

  it('hides Overall-hidden pages in Overall', () => {
    expect(labels('admin', true, 'rooms')).not.toContain('Rooms');
    expect(labels('admin', false, 'rooms')).toContain('Rooms');
  });
});
