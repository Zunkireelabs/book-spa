import { useState, useEffect, useRef } from 'react';

// Tracks scroll direction on the window and reports whether a piece of
// chrome should hide itself: true once the user has scrolled down past
// `threshold` and keeps scrolling down, false the moment they scroll back up
// or return near the top of the page.
export default function useScrollDirection(threshold = 80) {
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);

  useEffect(() => {
    lastY.current = window.scrollY;

    const onScroll = () => {
      const y = window.scrollY;
      if (y <= threshold) {
        setHidden(false);
      } else if (y > lastY.current) {
        setHidden(true);
      } else if (y < lastY.current) {
        setHidden(false);
      }
      lastY.current = y;
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);

  return hidden;
}
