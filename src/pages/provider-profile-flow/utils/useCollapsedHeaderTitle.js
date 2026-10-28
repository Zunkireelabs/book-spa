import { useEffect, useRef, useState } from 'react';

// iOS/Fresha-style collapsing title: the big page heading has its own ref; once it
// scrolls out from under the sticky back/X bar, `collapsed` flips true so the caller
// can show a small version of the same title pinned next to the back button instead.
// headerHeight must match the sticky bar's actual rendered height (not the reserved
// --booking-header-h spacer, which can be a few px larger) or the IntersectionObserver's
// trigger line sits slightly off from where the heading visually passes behind the bar.
export function useCollapsedHeaderTitle(headerHeight = 73) {
  const titleRef = useRef(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => setCollapsed(!entry.isIntersecting),
      { rootMargin: `-${headerHeight}px 0px 0px 0px`, threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [headerHeight]);

  return { titleRef, collapsed };
}
