import React, { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../AppIcon';
export const PANEL_WIDTH = 420; // px; docked-panel width at lg+

function useMediaQuery(query) {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

// Generic right-hand panel shell (header with ×, scrolling body, sticky footer).
//  * lg+ (>=1024px): a fixed, full-height overlay on the right (420px, hairline left border, soft shadow, NO scrim) that slides in.
//    Nothing underneath moves or reflows; pages keep the draft visible by scrolling their own content (see CalendarGrid).
//  * below lg: a right-hand sheet (full-screen under 640px) with a light scrim covering the whole viewport.
// `onClose` is called for ×, Esc and the scrim — callers put any dirty-draft guard behind it. Both variants are portalled to <body>.
// `width`: any CSS width for the docked panel (default 420px), e.g. 'min(560px, max(420px, 100vw - 720px))'.
const SidePanel = ({ isOpen, title, onClose, children, footer, headerExtra, titleId: titleIdProp, width = `${PANEL_WIDTH}px` }) => {
  const docked = useMediaQuery('(min-width: 1024px)');
  const autoId = useId();
  const titleId = titleIdProp || `side-panel-title-${autoId}`;

  // Keep content mounted during the close transition (docked), then unmount so nothing stays focusable.
  const [mounted, setMounted] = useState(isOpen);
  useEffect(() => {
    if (isOpen) { setMounted(true); return undefined; }
    const t = setTimeout(() => setMounted(false), 220);
    return () => clearTimeout(t);
  }, [isOpen]);

  // `shown` flips one frame after mount/open so the slide-in transition actually runs (and back on close).
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!isOpen) { setShown(false); return undefined; }
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, [isOpen]);

  // Esc closes (through the caller's guard) unless an inner control already handled it.
  useEffect(() => {
    if (!isOpen) return undefined;
    // Deferred a tick so an inner popover/menu that handles the same Esc (and calls preventDefault) closes first, regardless of
    // listener registration order; the panel only closes on an Esc nothing else claimed.
    let t;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      clearTimeout(t);
      t = setTimeout(() => { if (!e.defaultPrevented) onClose?.(); }, 0);
    };
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); document.removeEventListener('keydown', onKey); };
  }, [isOpen, onClose]);

  const inner = (
    <div
      role="dialog"
      aria-modal={docked ? 'false' : 'true'}
      aria-labelledby={titleId}
      className="h-full flex flex-col bg-surface"
      style={{ width: '100%' }}
    >
      <div className="h-14 flex-shrink-0 flex items-center justify-between gap-2 px-5 border-b border-border bg-surface">
        <h3 id={titleId} className="font-heading font-heading-semibold text-[15px] text-text-primary truncate">{title}</h3>
        <div className="flex items-center gap-1">
          {headerExtra}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-spa text-text-secondary hover:bg-background spa-transition-fast"
          >
            <Icon name="X" size={18} />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">{children}</div>
      {footer && <div className="flex-shrink-0 border-t border-border bg-surface p-4">{footer}</div>}
    </div>
  );

  if (docked) {
    // Desktop: a fixed, full-height overlay (no scrim, nothing underneath moves or reflows) sliding in from the right, above
    // the header and sidebar. Portalled to <body> so no ancestor stacking context can trap it.
    return mounted ? createPortal(
      <aside
        aria-hidden={!isOpen}
        data-side-panel="true"
        className="fixed top-0 right-0 h-screen z-modal bg-surface border-l border-border overflow-hidden transition-transform duration-200 ease-out motion-reduce:transition-none"
        style={{
          width,
          maxWidth: '100vw',
          transform: shown ? 'translateX(0)' : 'translateX(100%)',
          boxShadow: '-8px 0 24px rgba(14,13,12,0.06)',
        }}
      >
        {inner}
      </aside>,
      document.body
    ) : null;
  }

  if (!isOpen) return null;
  // Portalled to <body>: an ancestor stacking context (e.g. the dashboard's `relative z-0` row) would otherwise trap
  // the overlay beneath the sticky app header, so the scrim would not cover the whole viewport.
  return createPortal(
    <>
      <div className="fixed inset-0 z-modal bg-black/10" onClick={onClose} aria-hidden="true" />
      <div className="fixed top-0 right-0 h-full w-full sm:w-[400px] max-w-full z-modal border-l border-border shadow-spa-elevated">
        {inner}
      </div>
    </>,
    document.body
  );
};

export default SidePanel;
