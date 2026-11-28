import { describe, it, expect } from 'vitest';
import { placeFlyout } from './flyoutPlacement';

const opts = { width: 128, height: 64, viewportW: 1280, viewportH: 800 };
const row = (o) => ({ top: 100, left: 0, right: 0, ...o });

describe('placeFlyout', () => {
  it('opens to the right when there is room', () => {
    expect(placeFlyout(row({ left: 100, right: 300 }), opts)).toEqual({ side: 'right', left: 304, top: 100 });
  });

  it('flips to the left when the row is against the right edge', () => {
    const r = placeFlyout(row({ left: 1000, right: 1260 }), opts);
    expect(r.side).toBe('left');
    expect(r.left).toBe(1000 - 4 - 128);
    expect(r.left + 128).toBeLessThanOrEqual(1280);
  });

  it('keeps the right side when it just fits within the margin', () => {
    const r = placeFlyout(row({ left: 900, right: 1280 - 8 - 4 - 128 }), opts);
    expect(r.side).toBe('right');
  });

  it('clamps inside the margins when neither side fits', () => {
    const r = placeFlyout(row({ left: 20, right: 180 }), { ...opts, viewportW: 200 });
    expect(r.left).toBeGreaterThanOrEqual(8);
    expect(r.left + 128).toBeLessThanOrEqual(200 - 8);
  });

  it('never goes negative on a viewport narrower than the flyout', () => {
    expect(placeFlyout(row({ left: 0, right: 50 }), { ...opts, viewportW: 100 }).left).toBe(8);
  });

  it('clamps top when the flyout would overflow the bottom', () => {
    const r = placeFlyout(row({ top: 780, left: 100, right: 300 }), opts);
    expect(r.top).toBe(800 - 64 - 8);
  });

  it('clamps top to the margin when the row is above the viewport', () => {
    expect(placeFlyout(row({ top: -20, left: 100, right: 300 }), opts).top).toBe(8);
  });
});
