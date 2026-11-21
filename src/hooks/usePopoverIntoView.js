import { useCallback, useLayoutEffect, useRef } from 'react';

// ZNLY-325: an absolutely-positioned popover (date calendar, time list, customer suggestions…) inside a panel's scroll area grows that area
// instead of floating over it, so near the bottom it sits under the sticky footer until the user scrolls. On open, scroll the panel just
// enough to bring the popover's bottom into view (PickShell's approach). Attach the returned callback ref to the popover element; `deps`
// re-checks it when its size changes (e.g. suggestions arriving).
export default function usePopoverIntoView(open, ...deps) {
  const nodeRef = useRef(null);
  const setRef = useCallback((n) => { nodeRef.current = n; }, []);
  useLayoutEffect(() => {
    const el = nodeRef.current;
    if (!open || !el) return;
    let sc = el.parentElement;
    while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
    if (!sc) return;
    const deficit = el.getBoundingClientRect().bottom - (sc.getBoundingClientRect().bottom - 12);
    if (deficit > 0) sc.scrollTop += deficit;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ...deps]);
  return setRef;
}
