import { describe, it, expect } from 'vitest';
import { teamFilterLabel, isTeamFilterActive, teamAllLabel, staffInitials, toggleStaff, isLastTicked, isTicked } from './calendarFilter';

const U = [{ id: 'a', name: 'Asha Smoke' }, { id: 'b', name: 'Bikash Smoke' }, { id: 'c', name: 'Chhori Smoke' }];
const base = { universe: U, allLabel: 'All stylists', plural: 'stylists' };
describe('state 1: not narrowed', () => {
  it('all ticked, label All', () => {
    expect(teamFilterLabel({ ...base })).toBe('All stylists');
    expect(U.every((p) => isTicked([], p.id))).toBe(true);
    expect(isTeamFilterActive({ universe: U })).toBe(false);
  });
  it('all-label is plural for every industry', () => { expect(teamAllLabel('Therapist', 'Therapists')).toBe('All therapists'); expect(teamAllLabel('Stylist', 'Stylists')).toBe('All stylists'); });
});
describe('state 2: untick', () => {
  it('hides that person only', () => { expect(toggleStaff([], 'b', U)).toEqual(['b']); });
  it('N of M label', () => { expect(teamFilterLabel({ ...base, hiddenStaffIds: ['b'] })).toBe('2 of 3 stylists'); });
  it('single person shows first name', () => { expect(teamFilterLabel({ ...base, hiddenStaffIds: ['a', 'b'] })).toBe('Chhori'); });
  it('active', () => { expect(isTeamFilterActive({ hiddenStaffIds: ['b'], universe: U })).toBe(true); });
});
describe('state 3: tick back', () => {
  it('last unticked ticked -> All', () => {
    const next = toggleStaff(['b'], 'b', U);
    expect(next).toEqual([]);
    expect(teamFilterLabel({ ...base, hiddenStaffIds: next })).toBe('All stylists');
  });
});
describe('state 4: last ticked stays on', () => {
  it('cannot untick the last one', () => {
    expect(isLastTicked(['a', 'b'], 'c', U)).toBe(true);
    expect(toggleStaff(['a', 'b'], 'c', U)).toEqual(['a', 'b']);
  });
  it('not last when two ticked', () => { expect(isLastTicked(['a'], 'b', U)).toBe(false); });
});
describe('state 5/6: narrowed flag and hidden rows', () => {
  it('stale hidden ids (not listed) do not count', () => { expect(isTeamFilterActive({ hiddenStaffIds: ['zzz'], universe: U })).toBe(false); expect(teamFilterLabel({ ...base, hiddenStaffIds: ['zzz'] })).toBe('All stylists'); });
  it('positions alone narrow', () => { expect(isTeamFilterActive({ selectedPositions: ['Senior'], universe: U })).toBe(true); });
});
describe('universe = people on screen', () => {
  const onScreen = [U[0], U[1]]; // c is a non-service person, not in the universe
  it('lock holds when a ticked non-service person is outside the universe', () => {
    expect(isLastTicked(['a'], 'b', onScreen)).toBe(true);
    expect(toggleStaff(['a'], 'b', onScreen)).toEqual(['a']);
  });
  it('label counts only universe members', () => {
    expect(teamFilterLabel({ universe: onScreen, allLabel: 'All', plural: 'stylists', hiddenStaffIds: ['a', 'c'] })).toBe('Bikash');
    expect(teamFilterLabel({ universe: U, allLabel: 'All', plural: 'stylists', hiddenStaffIds: ['a'] })).toBe('2 of 3 stylists');
    expect(teamFilterLabel({ universe: onScreen, allLabel: 'All', plural: 'stylists', hiddenStaffIds: ['c'] })).toBe('All');
  });
});
describe('initials', () => { it('works', () => { expect(staffInitials('Asha Smoke')).toBe('AS'); expect(staffInitials('')).toBe(''); }); });
