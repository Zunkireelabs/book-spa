import { useState, useEffect, useRef } from 'react';

// Returns a 0..1 progress value driven directly by window.scrollY: 0 at the
// top of the page, 1 once the user has scrolled `distance` px, moving
// linearly (and reversibly) in between. Intended to drive an inline
// max-height/opacity collapse for a piece of chrome that should shrink away
// as the page scrolls.
//
// This is deliberately NOT a boolean "hidden" flag flipped by a scroll-
// direction check and animated with a CSS transition. That approach caused
// visible jitter: a timed transition runs on its own clock, independent of
// the user's actual scroll motion, so while the user kept scrolling the
// layout-shift animation and the real scroll were two unsynced motions
// fighting each other. A continuous progress value has no separate
// animation to desync — the collapse is always exactly wherever scrollY
// says it should be, every frame, symmetric for scrolling up or down. The
// caller must not add a CSS transition on top of this for the same reason.
export default function useScrollCollapse(distance = 140) {
  const [progress, setProgress] = useState(0);
  const ticking = useRef(false);

  useEffect(() => {
    const update = () => {
      ticking.current = false;
      const p = Math.min(1, Math.max(0, window.scrollY / distance));
      setProgress(p);
    };

    const onScroll = () => {
      if (ticking.current) return;
      ticking.current = true;
      requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [distance]);

  return progress;
}
