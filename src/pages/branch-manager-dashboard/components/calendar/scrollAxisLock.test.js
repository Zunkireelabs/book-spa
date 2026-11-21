import { describe, it, expect } from 'vitest';
import { pickTouchAxis, wheelAxis, createWheelBurst, snapTarget, coastTarget } from './scrollAxisLock';

describe('pickTouchAxis', () => {
  it('waits below the threshold', () => { expect(pickTouchAxis(5, 3)).toBeNull(); expect(pickTouchAxis(0, 7)).toBeNull(); });
  it('picks vertical for a vertical swipe', () => { expect(pickTouchAxis(2, 20)).toBe('y'); });
  it('picks horizontal for a clearly horizontal swipe', () => { expect(pickTouchAxis(30, 5)).toBe('x'); });
  it('is biased towards vertical on a diagonal', () => {
    expect(pickTouchAxis(20, 20)).toBe('y');
    expect(pickTouchAxis(23, 20)).toBe('y');
    expect(pickTouchAxis(25, 20)).toBe('x');
  });
  it('threshold is inclusive', () => { expect(pickTouchAxis(8, 0)).toBe('x'); });
});

describe('wheelAxis', () => {
  it('null for nothing', () => expect(wheelAxis(0, 0)).toBeNull());
  it('dominant axis with the same bias', () => { expect(wheelAxis(1, 10)).toBe('y'); expect(wheelAxis(10, 1)).toBe('x'); expect(wheelAxis(10, 10)).toBe('y'); });
});

describe('createWheelBurst', () => {
  it('lets a near-single-axis event through untouched (minor <= 30%)', () => {
    const b = createWheelBurst();
    expect(b.feed(0, 0, 30)).toEqual({ dx: 0, dy: 30, changed: false });
    expect(b.feed(16, 5, 30)).toEqual({ dx: 5, dy: 30, changed: false });
  });
  it('intercepts a clearly diagonal event and drops the minor axis', () => {
    const b = createWheelBurst();
    expect(b.feed(0, 15, 30)).toEqual({ dx: 0, dy: 30, changed: true });
    expect(b.axis).toBe('y');
  });
  it('keeps the locked axis for the whole burst', () => {
    const b = createWheelBurst();
    b.feed(0, 0, 30);
    expect(b.feed(10, 40, 20)).toEqual({ dx: 0, dy: 20, changed: true });
  });
  it('a quiet gap resets the lock so the next burst can go sideways', () => {
    const b = createWheelBurst();
    b.feed(0, 0, 20);
    expect(b.feed(500, 30, 12)).toEqual({ dx: 30, dy: 0, changed: true });
    expect(b.axis).toBe('x');
  });
});

describe('snapTarget', () => {
  const base = { colW: 100, max: 500 };
  it('settles on the nearest column when slow', () => {
    expect(snapTarget({ ...base, left: 140, velocity: 0.1 })).toBe(100);
    expect(snapTarget({ ...base, left: 160, velocity: -0.1 })).toBe(200);
  });
  it('a quick flick moves on to the next column in that direction', () => {
    expect(snapTarget({ ...base, left: 120, velocity: 0.5 })).toBe(200);
    expect(snapTarget({ ...base, left: 180, velocity: -0.5 })).toBe(100);
  });
  it('a flick exactly on a column stays there', () => {
    expect(snapTarget({ ...base, left: 200, velocity: 0.5 })).toBe(200);
  });
  it('clamps to the scroll range', () => {
    expect(snapTarget({ ...base, left: 490, velocity: 0.6 })).toBe(500);
    expect(snapTarget({ ...base, left: 20, velocity: -0.6 })).toBe(0);
    expect(snapTarget({ ...base, left: 330, velocity: 0 })).toBe(300);
  });
});

describe('coastTarget', () => {
  it('coasts in the direction of travel and clamps', () => {
    expect(coastTarget({ left: 100, velocity: 1, max: 1000, ms: 200 })).toBe(300);
    expect(coastTarget({ left: 100, velocity: -1, max: 1000, ms: 200 })).toBe(0);
    expect(coastTarget({ left: 900, velocity: 2, max: 1000, ms: 200 })).toBe(1000);
  });
});
