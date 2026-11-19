import { describe, it, expect } from 'vitest';
import { horizontalSwipe, shouldDismissSheet } from './gestures';

describe('horizontalSwipe', () => {
  it('ignores short drags', () => { expect(horizontalSwipe(-48, 0)).toBeNull(); expect(horizontalSwipe(30, 2)).toBeNull(); });
  it('left / right past 48px', () => { expect(horizontalSwipe(-60, 5)).toBe('left'); expect(horizontalSwipe(80, -10)).toBe('right'); });
  it('ignores mostly-vertical drags', () => { expect(horizontalSwipe(60, 40)).toBeNull(); expect(horizontalSwipe(60, 30)).toBeNull(); expect(horizontalSwipe(61, 30)).toBe('right'); });
});

describe('shouldDismissSheet', () => {
  it('upward or no drag never dismisses', () => { expect(shouldDismissSheet(-200, 100)).toBe(false); expect(shouldDismissSheet(0, 100)).toBe(false); });
  it('long drag dismisses', () => { expect(shouldDismissSheet(100, 2000)).toBe(true); expect(shouldDismissSheet(60, 2000)).toBe(false); });
  it('fast flick dismisses', () => { expect(shouldDismissSheet(50, 60)).toBe(true); expect(shouldDismissSheet(10, 5)).toBe(false); });
});
