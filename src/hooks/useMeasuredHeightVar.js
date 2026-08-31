import { useLayoutEffect } from 'react';

// Keeps a CSS custom property on the document root in sync with an element's
// live rendered height, via ResizeObserver. Lets sibling/descendant elements
// (e.g. a sticky bar stacked under a fixed header) read the real height
// instead of hardcoding a pixel value that only holds for one breakpoint and
// silently drifts whenever the measured element's own content changes.
export default function useMeasuredHeightVar(ref, cssVarName) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const setVar = (height) => {
      document.documentElement.style.setProperty(cssVarName, `${height}px`);
    };
    setVar(el.getBoundingClientRect().height);

    const observer = new ResizeObserver(([entry]) => {
      setVar(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, cssVarName]);
}
