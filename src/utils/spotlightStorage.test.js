import { describe, it, expect, vi } from 'vitest';
import { spotlightKey, isSpotlightDismissed, dismissSpotlight, visibleSlides, shouldAutoplay, createSpotlightTracker } from './spotlightStorage';

const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) }; };

describe('spotlight dismissal', () => {
  it('uses a per-slide, per-version, per-user key', () => {
    expect(spotlightKey('win-back-v1', 1, 'u1')).toBe('zennly.spotlight.win-back-v1.v1.u1');
    expect(spotlightKey('x', undefined, undefined)).toBe('zennly.spotlight.x.v1.anon');
  });
  it('is not dismissed until dismissed, then stays dismissed', () => {
    const s = memory();
    expect(isSpotlightDismissed('x', 1, 'u1', s)).toBe(false);
    dismissSpotlight('x', 1, 'u1', s);
    expect(isSpotlightDismissed('x', 1, 'u1', s)).toBe(true);
  });
  it('does not leak across users, slides or versions', () => {
    const s = memory();
    dismissSpotlight('x', 1, 'u1', s);
    expect(isSpotlightDismissed('x', 1, 'u2', s)).toBe(false);
    expect(isSpotlightDismissed('y', 1, 'u1', s)).toBe(false);
    expect(isSpotlightDismissed('x', 2, 'u1', s)).toBe(false);
  });
  it('survives a throwing storage', () => {
    const bad = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(isSpotlightDismissed('x', 1, 'u1', bad)).toBe(false);
    expect(() => dismissSpotlight('x', 1, 'u1', bad)).not.toThrow();
  });
  it('visibleSlides drops only the dismissed ones', () => {
    const s = memory();
    const slides = [{ id: 'a', version: 1 }, { id: 'b', version: 1 }, { id: 'c', version: 1 }];
    dismissSpotlight('b', 1, 'u1', s);
    expect(visibleSlides(slides, 'u1', s).map((x) => x.id)).toEqual(['a', 'c']);
    expect(visibleSlides(slides, 'u2', s).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    ['a', 'c'].forEach((id) => dismissSpotlight(id, 1, 'u1', s));
    expect(visibleSlides(slides, 'u1', s)).toEqual([]);
  });
});

describe('autoplay rule', () => {
  const base = { count: 3, reducedMotion: false, hovered: false, focused: false, hidden: false, interacted: false };
  it('runs only when nothing says stop', () => {
    expect(shouldAutoplay(base)).toBe(true);
    expect(shouldAutoplay({ ...base, count: 1 })).toBe(false);
    expect(shouldAutoplay({ ...base, reducedMotion: true })).toBe(false);
    expect(shouldAutoplay({ ...base, hovered: true })).toBe(false);
    expect(shouldAutoplay({ ...base, focused: true })).toBe(false);
    expect(shouldAutoplay({ ...base, hidden: true })).toBe(false);
    expect(shouldAutoplay({ ...base, interacted: true })).toBe(false);
  });
});

describe('analytics tracker', () => {
  it('fires shown once per slide per mount, clicked and dismissed every time', () => {
    const capture = vi.fn();
    const t = createSpotlightTracker(capture);
    t.shown('a'); t.shown('a'); t.shown('b');
    t.clicked('a'); t.clicked('a');
    t.dismissed('b');
    expect(capture.mock.calls).toEqual([
      ['spotlight_shown', { id: 'a' }], ['spotlight_shown', { id: 'b' }],
      ['spotlight_clicked', { id: 'a' }], ['spotlight_clicked', { id: 'a' }],
      ['spotlight_dismissed', { id: 'b' }],
    ]);
  });
});
