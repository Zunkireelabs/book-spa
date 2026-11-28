// Where to put a `position: fixed` flyout next to the row that opened it.
//
// Opens to the right of the row when it fits, otherwise flips to the left, and is
// always clamped inside the viewport margins — so a selector sitting against the
// right edge (e.g. inside the 420px right-aligned SidePanel) never renders its
// flyout off-screen. If neither side fits (very narrow viewport) it overlaps the
// row rather than leaving the screen.
//
// rowRect: the trigger row's getBoundingClientRect() ({ top, left, right }).
// Returns { top, left, side } where side is the side it actually opened on.
export function placeFlyout(rowRect, { width, height, viewportW, viewportH, gap = 4, margin = 8 }) {
  const fitsRight = rowRect.right + gap + width <= viewportW - margin;
  const side = fitsRight ? 'right' : 'left';
  const rawLeft = fitsRight ? rowRect.right + gap : rowRect.left - gap - width;
  const clamp = (n, min, max) => Math.max(min, Math.min(n, max));
  return {
    side,
    left: clamp(rawLeft, margin, Math.max(margin, viewportW - width - margin)),
    top: clamp(rowRect.top, margin, Math.max(margin, viewportH - height - margin)),
  };
}
