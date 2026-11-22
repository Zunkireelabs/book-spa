import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/analytics', () => ({ capture: vi.fn() }));
vi.mock('./industryTerms', () => ({
  localizeTerms: (t) => t.replace(/\brooms\b/gi, 'chairs').replace(/\broom\b/gi, 'chair'),
  wordBranch: () => 'clinic',
}));
import { describeError } from './errorGuide';

describe('describeError uses the org own words', () => {
  it('room and branch words follow the industry terms', () => {
    const c = describeError({ code: 'ROOM_FULL' }, { hasRooms: true, roomName: 'Chair 1', startTime: '12:00', endTime: '13:00', otherFreeRooms: 2 });
    expect(c.how).toBe('2 other chairs are free then.');
    expect(describeError({ code: 'INVALID_ROOM' }, { hasRooms: true }).lead).toBe("That chair isn't at this clinic.");
    expect(describeError({ code: 'BRANCH_CLOSED' }, { branchName: undefined }).lead).toMatch(/^This clinic is closed/);
  });
});
