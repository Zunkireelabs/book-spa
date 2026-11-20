// Axis-lock maths for the calendar scroller (ZNLY-302). Pure helpers: no DOM, so they are unit-tested.
// Vertical is favoured: hours are what people scroll most, and a thumb swipe is rarely a clean horizontal line.

export const TOUCH_THRESHOLD = 8;    // px of finger travel before a swipe picks its axis
export const HORIZONTAL_BIAS = 1.2;  // horizontal only when |dx| > 1.2 * |dy|
export const WHEEL_IDLE_MS = 120;    // a gap this long ends a wheel / trackpad burst
export const WHEEL_LOCK_PX = 6;      // accumulated travel before a wheel burst commits to an axis
export const DIAGONAL_RATIO = 0.3;   // a wheel event is "diagonal" (and gets intercepted) only when minor/major is above this
export const FLICK_SPEED = 0.3;      // px per ms: a release faster than this moves on to the next column

// Which axis does a finger drag of (dx, dy) belong to? null = not decided yet (still under the threshold).
export function pickTouchAxis(dx, dy, { threshold = TOUCH_THRESHOLD, bias = HORIZONTAL_BIAS } = {}) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < threshold) return null;
  return ax > bias * ay ? 'x' : 'y';
}

// Dominant axis of a single wheel event (same bias), or null for no movement.
export function wheelAxis(dx, dy, bias = HORIZONTAL_BIAS) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax === 0 && ay === 0) return null;
  return ax > bias * ay ? 'x' : 'y';
}

// A wheel / trackpad burst: the first events decide the axis, the rest of the burst (until WHEEL_IDLE_MS of quiet) keeps it.
// feed(now, dx, dy) -> { dx, dy, changed }. Only a clearly diagonal event (minor axis above DIAGONAL_RATIO of the major) is
// altered (minor zeroed, changed = true: the caller must preventDefault and scroll the kept axis itself). Everything else
// passes through untouched (changed = false) so native trackpad smoothness and momentum are never disturbed.
export function createWheelBurst({ idleMs = WHEEL_IDLE_MS, lockPx = WHEEL_LOCK_PX, ratio = DIAGONAL_RATIO } = {}) {
  let axis = null;
  let last = -Infinity;
  let sx = 0;
  let sy = 0;
  return {
    feed(now, dx, dy) {
      if (now - last > idleMs) { axis = null; sx = 0; sy = 0; }
      last = now;
      if (!axis) {
        sx += dx; sy += dy;
        if (Math.max(Math.abs(sx), Math.abs(sy)) >= lockPx) axis = wheelAxis(sx, sy);
      }
      const use = axis || wheelAxis(sx, sy) || wheelAxis(dx, dy);
      const major = use === 'x' ? Math.abs(dx) : Math.abs(dy);
      const minor = use === 'x' ? Math.abs(dy) : Math.abs(dx);
      if (!use || minor === 0 || minor <= ratio * major) return { dx, dy, changed: false };
      return { dx: use === 'y' ? 0 : dx, dy: use === 'x' ? 0 : dy, changed: true };
    },
    get axis() { return axis; },
  };
}

// Where a horizontal drag settles on release (phone Day view): the nearest whole column, or the next one in the
// direction of a quick flick. `left` = scrollLeft now, `velocity` = px/ms of scrollLeft (positive = moving to later columns).
export function snapTarget({ left, velocity = 0, colW, max, flick = FLICK_SPEED }) {
  if (!colW || colW <= 0) return Math.max(0, Math.min(max, left));
  const at = left / colW;
  let k = Math.round(at);
  if (Math.abs(velocity) > flick) k = velocity > 0 ? Math.ceil(at - 1e-6) : Math.floor(at + 1e-6);
  return Math.max(0, Math.min(max, k * colW));
}

// Free release (Week / 4-day on a phone: no snap): coast a little way in the direction of travel.
export function coastTarget({ left, velocity = 0, max, ms = 220 }) {
  return Math.max(0, Math.min(max, left + velocity * ms));
}
