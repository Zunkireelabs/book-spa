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
