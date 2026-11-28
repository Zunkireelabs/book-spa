import { describe, it, expect } from 'vitest';
import { CAL_STEP_MIN, snapLength, lengthLabel } from './calendarStep';

describe('calendar step (ZNLY-407)', () => {
  it('the step is 5 minutes', () => { expect(CAL_STEP_MIN).toBe(5); });
  it('snaps a dragged length to whole 5-minute steps', () => {
    expect(snapLength(52, 30)).toBe(50);
    expect(snapLength(53, 30)).toBe(55);
    expect(snapLength(47.4, 30)).toBe(45);
  });
  it('never goes shorter than the service', () => {
    expect(snapLength(10, 30)).toBe(30);
    expect(snapLength(-40, 30)).toBe(30);
    expect(snapLength(30, 30)).toBe(30);
  });
  it('label: until time, length, and (+extra) only when longer', () => {
    expect(lengthLabel('3:20pm', 50, 30)).toBe('until 3:20pm · 50 min (+20)');
    expect(lengthLabel('3:00pm', 30, 30)).toBe('until 3:00pm · 30 min');
  });
});
