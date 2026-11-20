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

import { detentAfterDrag, stepBack, isTextEntry, halfMaxPx, scrollIntoTopBand } from './gestures';

describe('detent sheet helpers', () => {
  it('halfMaxPx is 62% of the viewport', () => { expect(halfMaxPx(844)).toBe(523); });
  it('drag up from half goes full (far or flick), short up does nothing', () => {
    expect(detentAfterDrag('half', -60, 600)).toBe('full');
    expect(detentAfterDrag('half', -30, 40)).toBe('full');
    expect(detentAfterDrag('half', -20, 600)).toBe('half');
  });
  it('drag down: half closes, full steps to half', () => {
    expect(detentAfterDrag('half', 120, 600)).toBe('close');
    expect(detentAfterDrag('full', 120, 600)).toBe('half');
    expect(detentAfterDrag('half', 40, 600)).toBe('half');
  });
  it('stepBack: full -> half -> close', () => { expect(stepBack('full')).toBe('half'); expect(stepBack('half')).toBe('close'); });
  it('isTextEntry', () => {
    expect(isTextEntry({ tagName: 'INPUT', type: 'number' })).toBe(true);
    expect(isTextEntry({ tagName: 'INPUT' })).toBe(true);
    expect(isTextEntry({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTextEntry({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isTextEntry({ tagName: 'BUTTON' })).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
  it('scrollIntoTopBand', () => {
    expect(scrollIntoTopBand(200, 100, 500)).toBe(0); // inside top 38% (100..252)
    expect(scrollIntoTopBand(400, 100, 500)).toBe(288); // below band -> top + margin
    expect(scrollIntoTopBand(60, 100, 500)).toBe(-52); // above visible area
    expect(scrollIntoTopBand(105, 100, 500)).toBe(-7); // closer than margin
  });
});
