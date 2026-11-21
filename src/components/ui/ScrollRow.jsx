import React, { useEffect, useRef, useState } from 'react';

/**
 * Phone: a group of chips/buttons/tabs becomes ONE horizontally scrollable row
 * (snap, hidden scrollbar, right-edge fade while more is hidden, 44px chips).
 * >= md: nothing changes; pass the desktop layout in `className` (e.g. "md:flex-wrap md:gap-2").
 *
 * Children are styled through the row (nowrap, no shrink, snap-start, min-h 44px on phone),
 * so callers keep their own chip markup.
 */
const ScrollRow = ({ children, className = '', wrapperClassName = '', fadeFrom = 'from-white', desktopWrap = true, gap = 'gap-2', ...rest }) => {
  const ref = useRef(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => setMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      ro?.disconnect();
    };
  }, [children]);

  return (
    <div className={`relative min-w-0 max-w-full ${wrapperClassName}`}>
      <div
        ref={ref}
        className={`flex items-center ${gap} overflow-x-auto snap-x snap-proximity [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0 [&>*]:snap-start [&>*]:whitespace-nowrap max-md:[&>*]:min-h-[44px] ${desktopWrap ? 'md:flex-wrap md:overflow-visible' : 'md:flex-nowrap'} ${className}`}
        {...rest}
      >
        {children}
      </div>
      {more && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l ${fadeFrom} to-transparent md:hidden`}
        />
      )}
    </div>
  );
};

export default ScrollRow;
