import { describe, it, expect } from 'vitest';
import { grantableRolesFor } from './api';
import {
  canViewAccess, canEditAccess, branchSummary, initialAccessForm, branchIdsToSave, showsHideOptions, validateAccessForm,
  saveErrorCopy, conflictSentence, canLinkNow, LINKABLE_REASONS,
} from './staffAccessRules';
import { SETTINGS, getSettingByView } from '../pages/branch-manager-dashboard/components/Settings/settingsRegistry';

const BR = [{ id: 'b1', name: 'Panipokhari' }, { id: 'b2', name: 'Jhamsikhel' }];

describe('who may see and edit access', () => {
  it('shows the section to manager, admin, admin viewer only', () => {
    expect(['staff', 'manager', 'admin', 'admin_viewer', undefined].map(canViewAccess)).toEqual([false, true, true, true, false]);
  });
  it('admin viewer is read-only; staff never edits', () => {
    expect(canEditAccess({ viewerRole: 'admin_viewer', viewerUserId: 'v', target: { role: 'staff', userId: 'u' } })).toBe(false);
    expect(canEditAccess({ viewerRole: 'staff', viewerUserId: 'v', target: null })).toBe(false);
  });
  it('manager edits Staff-role people at branches they manage, never manager / admin / admin viewer, never other branches, never self (ZNLY-215)', () => {
    const m = (role, userId = 'u', targetBranchId = 'b1') => canEditAccess({ viewerRole: 'manager', viewerUserId: 'me', target: { role, userId }, viewerBranchIds: ['b1', 'b2'], targetBranchId });
    expect([m('staff'), m('manager'), m('admin'), m('admin_viewer'), m('staff', 'me'), m('staff', 'u', 'b9'), m('staff', 'u', 'b2')]).toEqual([true, false, false, false, false, false, true]);
    // no login yet: open to a manager only when the person's home branch is one they manage
    expect(canEditAccess({ viewerRole: 'manager', viewerUserId: 'me', target: null, viewerBranchIds: ['b1'], targetBranchId: 'b1' })).toBe(true);
    expect(canEditAccess({ viewerRole: 'manager', viewerUserId: 'me', target: null, viewerBranchIds: ['b1'], targetBranchId: 'b9' })).toBe(false);
    expect(canEditAccess({ viewerRole: 'manager', viewerUserId: 'me', target: null })).toBe(false);
  });
  it('admin edits anyone but themselves', () => {
    expect(canEditAccess({ viewerRole: 'admin', viewerUserId: 'me', target: { role: 'admin', userId: 'u' } })).toBe(true);
    expect(canEditAccess({ viewerRole: 'admin', viewerUserId: 'me', target: { role: 'admin', userId: 'me' } })).toBe(false);
  });
  it('a manager is offered the Staff role only (the one list the API enforces)', () => {
    expect(grantableRolesFor('manager')).toEqual(['staff']);
    expect(grantableRolesFor('admin')).toEqual(['staff', 'manager', 'admin', 'admin_viewer']);
    expect(grantableRolesFor('staff')).toEqual([]);
  });
});

describe('form <-> save', () => {
  it('a new login starts at own calendar, nothing hidden, home branch only', () => {
    const f = initialAccessForm({ user: null, branches: BR, grantedIds: [], homeBranchId: 'b1' });
    expect(f).toMatchObject({ loginOn: true, calendar: 'own', hideClientDetails: false, hidePrices: false, branchMode: 'selected', role: 'staff' });
    expect(branchIdsToSave({ form: f, branches: BR, homeBranchId: 'b1' })).toEqual(['b1']);
  });
  it('the home branch is always saved, and "all" saves every branch', () => {
    const f = { branchMode: 'selected', branchIds: ['b2'] };
    expect(branchIdsToSave({ form: f, branches: BR, homeBranchId: 'b1' }).sort()).toEqual(['b1', 'b2']);
    expect(branchIdsToSave({ form: { branchMode: 'all' }, branches: BR, homeBranchId: 'b1' })).toEqual(['b1', 'b2']);
  });
  it('reads an existing login: off, hidden prices, all branches', () => {
    const f = initialAccessForm({ user: { login_access: 'none', role: 'manager', calendar_visibility: 'all', can_view_customer_details: true, can_view_prices: false, email: 'a@b.c' }, branches: BR, grantedIds: ['b2'], homeBranchId: 'b1' });
    expect(f).toMatchObject({ loginOn: false, role: 'manager', hidePrices: true, hideClientDetails: false, branchMode: 'all' });
  });
  it('hide options exist for the Staff role only', () => {
    expect(['staff', 'manager', 'admin', 'admin_viewer'].map(showsHideOptions)).toEqual([true, false, false, false]);
  });
  it('validates PIN and email', () => {
    expect(validateAccessForm({ form: { pin: '12', email: '' }, isNewLogin: false })).toMatch(/4 digits/);
    expect(validateAccessForm({ form: { pin: '', email: '' }, isNewLogin: true })).toMatch(/email/);
    expect(validateAccessForm({ form: { pin: '1234', email: 'x@y.zz', loginOn: true }, isNewLogin: true })).toBeNull();
    expect(validateAccessForm({ form: { pin: '', password: 'secret1', email: 'x@y.zz', loginOn: true }, isNewLogin: true })).toBeNull();
    expect(validateAccessForm({ form: { pin: '', password: '', email: 'x@y.zz', loginOn: true }, isNewLogin: true })).toBe('Give them a password or a PIN so they can sign in.');
    expect(validateAccessForm({ form: { pin: '', password: '', email: 'x@y.zz', loginOn: false }, isNewLogin: true })).toBeNull();
    expect(validateAccessForm({ form: { pin: '', email: '' }, isNewLogin: false })).toBeNull();
  });
  it('turns the duplicate-login error into the board copy with the tenant word', () => {
    expect(saveErrorCopy({ code: 'ACCOUNT_ALREADY_LINKED' }, 'Therapist')).toBe('That email already has a login for another therapist. Open that profile or use a different email.');
    expect(saveErrorCopy({ code: 'X' })).toBeNull();
  });
  it('summarises branches', () => {
    expect(branchSummary({ branches: BR, grantedIds: [], homeBranchId: 'b1' })).toBe('Panipokhari (home)');
    expect(branchSummary({ branches: BR, grantedIds: ['b2'], homeBranchId: 'b1' })).toBe('All branches');
    expect(branchSummary({ branches: [BR[0]], grantedIds: [], homeBranchId: 'b1' })).toBe('Panipokhari (home)');
  });
});

describe('link needs review', () => {
  it('has one plain sentence per reason, in the tenant words, never saying spa', () => {
    for (const reason of ['therapist_already_linked_to_another_login', 'login_already_linked_to_another_therapist', 'therapist_row_missing', 'org_mismatch']) {
      const s = conflictSentence({ reason, userEmail: 'm@x.y', therapistName: 'Meena G', currentEmail: 'o@x.y' }, 'Team member');
      expect(s).toMatch(/Nothing was changed\.$/);
      expect(s.toLowerCase()).not.toContain('spa');
    }
    expect(conflictSentence({ reason: 'therapist_row_missing', userEmail: 'm@x.y' }, 'Therapist')).toMatch(/therapist that no longer exists/);
  });
  it('says the person is free when they have no login now', () => {
    expect(conflictSentence({ reason: 'therapist_already_linked_to_another_login', userEmail: 'm@x.y', therapistName: 'Meena G', therapistUserId: null })).toMatch(/Meena G has no login now; you can link it/);
  });
  it('offers the link only when it can work now', () => {
    const base = { reason: LINKABLE_REASONS[0], userId: 'u', therapistName: 'T', therapistUserId: null, loginLinkedElsewhere: false };
    expect(canLinkNow(base)).toBe(true);
    expect(canLinkNow({ ...base, therapistUserId: 'other' })).toBe(false);
    expect(canLinkNow({ ...base, loginLinkedElsewhere: true })).toBe(false);
    expect(canLinkNow({ ...base, reason: 'org_mismatch' })).toBe(false);
    expect(canLinkNow({ ...base, reason: 'therapist_row_missing', therapistName: null })).toBe(false);
  });
});

describe('Settings -> Staff access is gone', () => {
  it('has no registry entry', () => {
    expect(SETTINGS.some((s) => s.id === 'staff-access' || s.view === 'staff-access')).toBe(false);
    expect(getSettingByView('staff-access')).toBeNull();
  });
});
