import { describe, it, expect } from 'vitest';
import { teamFilterLabel, isTeamFilterActive, teamAllLabel, staffInitials } from './calendarFilter';

const opts = [{ id: 'a', name: 'Asha Smoke' }, { id: 'b', name: 'Bikash Smoke' }];
describe('teamFilterLabel', () => {
  it('none narrowed -> allLabel', () => { expect(teamFilterLabel({ allLabel: 'All positions' })).toBe('All positions'); });
  it('one person -> first name', () => { expect(teamFilterLabel({ selectedStaffIds: ['b'], staffOptions: opts, allLabel: 'x' })).toBe('Bikash'); });
  it('one person not in list -> 1 selected', () => { expect(teamFilterLabel({ selectedStaffIds: ['z'], staffOptions: opts, allLabel: 'x' })).toBe('1 selected'); });
  it('2+ people -> N selected', () => { expect(teamFilterLabel({ selectedStaffIds: ['a', 'b'], staffOptions: opts, allLabel: 'x' })).toBe('2 selected'); });
  it('positions count too', () => {
    expect(teamFilterLabel({ selectedPositions: ['Senior'], allLabel: 'x' })).toBe('1 selected');
    expect(teamFilterLabel({ selectedStaffIds: ['a'], selectedPositions: ['Senior'], staffOptions: opts, allLabel: 'x' })).toBe('2 selected');
  });
});
describe('helpers', () => {
  it('active', () => { expect(isTeamFilterActive({})).toBe(false); expect(isTeamFilterActive({ selectedStaffIds: ['a'] })).toBe(true); });
  it('all label', () => { expect(teamAllLabel('Therapist', 'Therapists')).toBe('All positions'); expect(teamAllLabel('Stylist', 'Stylists')).toBe('All stylists'); });
  it('initials', () => { expect(staffInitials('Asha Smoke')).toBe('AS'); expect(staffInitials('')).toBe(''); });
});
