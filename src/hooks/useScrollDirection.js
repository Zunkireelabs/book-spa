import { useState, useEffect, useRef } from 'react';

// Tracks scroll direction on the window and reports whether a piece of
// chrome should hide itself: true once the user has scrolled down past
// `threshold` and keeps scrolling down, false the moment they scroll back up
// or return near the top of the page.
//
// Two things make this safe to drive a height-collapsing animation from,
// which naive scroll-direction tracking is not:
//
// 1. Reads are throttled to one per animation frame (rAF) rather than
//    reacting to every raw 'scroll' event, so the resulting layout change
//    can't fire faster than the browser can paint.
// 2. `hysteresis` — the state only flips once scroll has moved at least
//    this many px past the point of the last flip. Trackpad/inertial scroll
//    deltas aren't perfectly monotonic (a "down" gesture can still emit an
//    occasional 1px "up" tick), so without a buffer the naive
//    y > lastY / y < lastY comparison flips `hidden` back and forth on that
//    noise — each flip re-triggers the collapse's CSS transition mid-flight,
//    which is what shows up as scroll jitter.
export default function useScrollDirection(threshold = 80, hysteresis = 24) {
  const [hidden, setHidden] = useState(false);
  const anchorY = useRef(0);
  const ticking = useRef(false);

  useEffect(() => {
    anchorY.current = window.scrollY;

    const check = () => {
      ticking.current = false;
      const y = window.scrollY;
      if (y <= threshold) {
        setHidden(false);
        anchorY.current = y;
      } else if (y - anchorY.current > hysteresis) {
        setHidden(true);
        anchorY.current = y;
      } else if (anchorY.current - y > hysteresis) {
        setHidden(false);
        anchorY.current = y;
      }
    };

    const onScroll = () => {
      if (ticking.current) return;
      ticking.current = true;
      requestAnimationFrame(check);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold, hysteresis]);

  return hidden;
}
