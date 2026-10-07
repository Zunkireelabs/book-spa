import { useEffect, useRef, useState } from 'react';

// Generalized from this folder's original TabNav.jsx (now deleted — its 5-section
// Overview/Services/Amenities/Location/Policies layout was dropped in the
// services-only simplification, but its scroll-spy logic was exactly right for the
// category pill bar's navigate-on-scroll behavior): highlights whichever section is
// currently nearest the top of the scroll area, and clicking a pill scrolls smoothly
// to that section while suppressing the observer-driven highlight briefly so the
// click target doesn't flicker while the scroll animation is still in flight.
//
// root: a ref to a scrollable ancestor, or omit/null to
// track window scroll — the page's service list scrolls the window, the drawer's
// scrolls its own panel, so offsets must be computed relative to whichever one is
// actually scrolling.
//
// barRef/registerPill: optional — attach barRef to the horizontally-scrolling pill
// bar and registerPill(id) to each pill button, and this hook keeps the active pill
// scrolled into view on its own. Computed manually (bar.scrollTo on scrollLeft only)
// rather than via pill.scrollIntoView(), which also scrolls vertical ancestors and
// would fight the very vertical scroll-spy that triggered it.
export function useScrollSpy(ids, sectionRefs, { offset = 140, root = null } = {}) {
  const [activeId, setActiveId] = useState(ids[0]);
  const suppressUntil = useRef(0);
  const barRef = useRef(null);
  const pillRefs = useRef({});

  useEffect(() => {
    const scrollEl = root?.current || window;

    const onScroll = () => {
      if (Date.now() < suppressUntil.current) return;

      // Bottom-out guard: the last section's top can never cross the offset line if
      // it's shorter than the viewport/panel, so the normal top-crossing check below
      // can never select it. Within ~2px of the scroll end, force it active instead.
      const atBottom = scrollEl === window
        ? window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2
        : scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 2;
      if (atBottom) {
        setActiveId(ids[ids.length - 1]);
        return;
      }

      const rootTop = scrollEl === window ? 0 : scrollEl.getBoundingClientRect().top;
      let current = ids[0];
      for (const id of ids) {
        const el = sectionRefs.current[id];
        if (el && el.getBoundingClientRect().top - rootTop - offset <= 0) {
          current = id;
        }
      }
      setActiveId(current);
    };

    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => scrollEl.removeEventListener('scroll', onScroll);
  }, [ids, sectionRefs, offset, root]);

  // Keep the active pill visible in its (possibly off-screen) horizontal bar.
  useEffect(() => {
    const bar = barRef.current;
    const pill = pillRefs.current[activeId];
    if (!bar || !pill) return;
    const target = pill.offsetLeft - (bar.clientWidth - pill.offsetWidth) / 2;
    bar.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
  }, [activeId]);

  const registerPill = (id) => (el) => { pillRefs.current[id] = el; };

  const scrollTo = (id) => {
    setActiveId(id);
    suppressUntil.current = Date.now() + 700;
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return { activeId, scrollTo, barRef, registerPill };
}

export default useScrollSpy;
