// Pure gesture helpers (no DOM), shared by BottomSheet and the phone calendar header.

export const SWIPE_MIN_PX = 48;
export const SWIPE_DOMINANCE = 2;

// Horizontal swipe: returns 'left' | 'right' | null. Acts only when |dx| > 48px and |dx| > 2x |dy|.
export function horizontalSwipe(dx, dy) {
  if (Math.abs(dx) <= SWIPE_MIN_PX) return null;
  if (Math.abs(dx) <= SWIPE_DOMINANCE * Math.abs(dy)) return null;
  return dx < 0 ? 'left' : 'right';
}

// Bottom-sheet drag-to-dismiss: dragged down far enough, or flicked down fast enough.
export function shouldDismissSheet(dy, dtMs, { distance = 100, velocity = 0.5 } = {}) {
  if (dy <= 0) return false;
  if (dy >= distance) return true;
  return dtMs > 0 && dy / dtMs >= velocity && dy > 24;
}

// ── Detent sheet (ZNLY-285): half (fixed 62% of the viewport) / full ──────────────────────────────────────────────
export const HALF_MAX_RATIO = 0.62; // half detent = a fixed 62% of the viewport (same panel as full, tabs included)

// Height of the half detent in px for a viewport of `vh` px.
export const halfMaxPx = (vh) => Math.round(vh * HALF_MAX_RATIO);

// Where a drag ends: dy > 0 is down. Returns 'full' | 'half' | 'close' | the current detent (no change).
export function detentAfterDrag(current, dy, dtMs, { upDistance = 48, upVelocity = 0.4 } = {}) {
  const fastUp = dtMs > 0 && -dy / dtMs >= upVelocity && -dy > 24;
  if (dy < 0 && (-dy >= upDistance || fastUp)) return 'full';
  if (dy > 0 && shouldDismissSheet(dy, dtMs)) return current === 'full' ? 'half' : 'close';
  return current;
}

// Esc / phone Back: full -> half -> close.
export const stepBack = (detent) => (detent === 'full' ? 'half' : 'close');

// A focused control that raises the keyboard (so the sheet should go full). Checkbox/radio/button-ish inputs do not.
const NON_TEXT_INPUT = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image']);
export function isTextEntry(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea') return true;
  if (tag === 'input') return !NON_TEXT_INPUT.has((el.type || 'text').toLowerCase());
  return !!el.isContentEditable;
}

// Vertical scroll (px, applied to the grid's scroller) that brings a card into the visible top `band` (default 38%) of the
// area above the sheet. `cardTop` is viewport-relative; `visTop`/`visBottom` bound the area above the sheet. 0 = already in the band.
export function scrollIntoTopBand(cardTop, visTop, visBottom, band = 0.38, margin = 12) {
  const bandBottom = visTop + Math.max(0, visBottom - visTop) * band;
  if (cardTop >= visTop + margin && cardTop <= bandBottom) return 0;
  return Math.round(cardTop - (visTop + margin));
}
