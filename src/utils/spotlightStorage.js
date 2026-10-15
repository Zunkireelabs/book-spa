// Dismissal persistence for Spotlight slides: one localStorage flag per slide id + version and per user.
// Bumping a slide's `version` brings a dismissed slide back.
export const spotlightKey = (id, version, userId) => `zennly.spotlight.${id}.v${version ?? 1}.${userId || 'anon'}`;

const safe = (storage) => storage ?? (typeof window !== 'undefined' ? window.localStorage : null);

export function isSpotlightDismissed(id, version, userId, storage) {
  try { return safe(storage)?.getItem(spotlightKey(id, version, userId)) === '1'; } catch { return false; }
}

export function dismissSpotlight(id, version, userId, storage) {
  try { safe(storage)?.setItem(spotlightKey(id, version, userId), '1'); } catch { /* private mode: dismissal lasts for this page view only */ }
}

/** The slides still to show (callers decide relevance; this drops the ones this user dismissed). */
export const visibleSlides = (slides, userId, storage) => slides.filter((s) => !isSpotlightDismissed(s.id, s.version, userId, storage));

/** Autoplay runs only when nothing says stop: reduced motion, hover/focus, a hidden tab, any manual navigation, a single slide. */
export const shouldAutoplay = ({ count, reducedMotion, hovered, focused, hidden, interacted }) =>
  count > 1 && !reducedMotion && !hovered && !focused && !hidden && !interacted;

/** Wraps `capture` so "shown" fires once per slide per mount; clicked / dismissed fire every time. */
export function createSpotlightTracker(capture) {
  const seen = new Set();
  return {
    shown(id) { if (seen.has(id)) return; seen.add(id); capture('spotlight_shown', { id }); },
    clicked(id) { capture('spotlight_clicked', { id }); },
    dismissed(id) { capture('spotlight_dismissed', { id }); },
  };
}
