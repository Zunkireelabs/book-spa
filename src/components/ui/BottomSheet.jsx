import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../AppIcon';
import { shouldDismissSheet, detentAfterDrag, stepBack, isTextEntry, halfMaxPx } from '../../utils/gestures';

// Shared sheet. Phone (< md): a bottom sheet (drag handle, swipe down to close, max 90dvh, safe-area padding).
// >= md: the same content in a centred dialog, so callers never need a second layout.
// Nested sheets: render a second <BottomSheet onBack=...> while the first is open. They stack (later one on top);
// only the top sheet handles Esc / Tab, and the body stays locked until the last one closes.
// `onClose` is called for the close button, Esc, scrim tap and swipe-down; callers put any guard behind it.

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const stack = []; // ids of open sheets, top = last
let lockCount = 0;
let prevOverflow = '';

// Also tags <html> so CSS can freeze the app's inner page scrollers (.content-scroll, the calendar grid): on phone those, not the body, are what scrolls.
const lockScroll = () => { if (lockCount++ === 0) { prevOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; document.documentElement.classList.add('scroll-locked'); } };
const unlockScroll = () => { if (--lockCount <= 0) { lockCount = 0; document.body.style.overflow = prevOverflow; document.documentElement.classList.remove('scroll-locked'); } };

// Shared body-scroll lock for any overlay that covers the page (same ref-counted lock the sheets use, so stacked overlays can't unlock each other).
// `phoneOnly` (default): lock only below md, where the overlay covers the screen; desktop popovers leave the page scrollable.
// overflow:hidden keeps scrollTop, so closing restores the page exactly. Pair the overlay's own scroller with `overscroll-contain`.
export function useBodyScrollLock(active, phoneOnly = true) {
  useEffect(() => {
    if (!active || typeof window === 'undefined') return undefined;
    if (phoneOnly && !window.matchMedia?.('(max-width: 767.98px)').matches) return undefined;
    lockScroll();
    return unlockScroll;
  }, [active, phoneOnly]);
}

// Expand / collapse chevron, placed inline in the sheet header (between the edit pencil and the close button).
export const SheetExpandButton = ({ full, onToggle }) => (
  <button type="button" onClick={onToggle} aria-label={full ? 'Collapse booking' : 'Expand booking'}
    className="w-11 h-11 flex items-center justify-center rounded-spa text-text-secondary hover:bg-background spa-transition-fast">
    <Icon name={full ? 'ChevronDown' : 'ChevronUp'} size={20} />
  </button>
);

let openSheets = 0; // DetentSheets currently open
let entryPushed = false; // our single history entry is in place
let selfBack = 0; // history.back() calls we issued ourselves (their popstate must not count as the user's Back)

export function useMediaQuery(query) {
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

// Visual viewport (shrinks when the on-screen keyboard is up): { h, bottom } where `bottom` lifts a fixed sheet above the keyboard.
function useVisualViewport(active) {
  const read = () => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return { h: typeof window !== 'undefined' ? window.innerHeight : 800, bottom: 0 };
    return { h: Math.round(vv.height), bottom: Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) };
  };
  const [vp, setVp] = useState(read);
  useEffect(() => {
    if (!active) return undefined;
    const vv = window.visualViewport;
    const on = () => setVp(read());
    on();
    window.addEventListener('resize', on);
    vv?.addEventListener('resize', on);
    vv?.addEventListener('scroll', on);
    return () => { window.removeEventListener('resize', on); vv?.removeEventListener('resize', on); vv?.removeEventListener('scroll', on); };
  }, [active]);
  return vp;
}

// ZNLY-285: phone sheet with two detents, owned by the caller (`detent` 'half' | 'full', `onDetentChange`).
//  half = a fixed 62% of the viewport (same panel as full, body scrolls); full = the whole viewport below the safe area.
//  `scrim` true: light backdrop, tap = close, modal semantics + focus trap. false (calendar): no backdrop, the page behind stays live
//  and is not trapped at half. Esc / phone Back step full -> half -> close with ONE history entry per open. Scroll lock only at full.
//  `header` is rendered inside the drag zone (put the title element with `titleId` in it). `onClose` is the caller's guarded close.
export const DetentSheet = ({ isOpen, detent, onDetentChange, onClose, header, children, footer, scrim = true, titleId }) => {
  const id = useId();
  const panelRef = useRef(null);
  const returnFocusRef = useRef(null);
  const [mounted, setMounted] = useState(isOpen);
  const [shown, setShown] = useState(false);
  const [dragY, setDragY] = useState(0);
  const drag = useRef(null);
  const vp = useVisualViewport(isOpen);
  const full = detent === 'full';
  const modal = scrim || full;

  const latest = useRef({});
  latest.current = { detent, onDetentChange, onClose };
  const step = () => {
    const { detent: d, onDetentChange: chg, onClose: close } = latest.current;
    const next = stepBack(d);
    if (next === 'close') close?.(); else chg?.(next);
  };

  useEffect(() => {
    if (isOpen) { setMounted(true); return undefined; }
    setShown(false);
    const t = setTimeout(() => { setMounted(false); setDragY(0); }, 220);
    return () => clearTimeout(t);
  }, [isOpen]);
  useEffect(() => {
    if (!isOpen || !mounted) return undefined;
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, [isOpen, mounted]);

  // Stack registration, Esc (deferred a tick so an inner popover / PaymentModal that claims the same Esc wins), Tab trap when modal.
  useEffect(() => {
    if (!isOpen) return undefined;
    returnFocusRef.current = document.activeElement;
    stack.push(id);
    let escT;
    const onKey = (e) => {
      if (stack[stack.length - 1] !== id) return;
      if (e.key === 'Escape') {
        clearTimeout(escT);
        escT = setTimeout(() => { if (!e.defaultPrevented) step(); }, 0);
      } else if (e.key === 'Tab' && (scrim || latest.current.detent === 'full')) {
        const el = panelRef.current;
        if (!el) return;
        const items = Array.from(el.querySelectorAll(FOCUSABLE)).filter((n) => n.offsetParent !== null);
        if (!items.length) { e.preventDefault(); el.focus(); return; }
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(escT);
      document.removeEventListener('keydown', onKey);
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
      const back = returnFocusRef.current;
      if (scrim && back && typeof back.focus === 'function' && document.contains(back)) back.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, id, scrim]);

  // Scroll lock only while full.
  useEffect(() => {
    if (!isOpen || !full) return undefined;
    lockScroll();
    return () => unlockScroll();
  }, [isOpen, full]);

  // One history entry for the open sheet layer (shared, so a skeleton -> loaded remount or a booking switch never stacks another):
  // phone Back pops it, we re-push and step full -> half -> close. When the last sheet closes the entry is removed again, unless
  // the app already navigated elsewhere (then the top entry is not ours and is left alone).
  useEffect(() => {
    if (!isOpen) return undefined;
    openSheets += 1;
    if (!entryPushed) { window.history.pushState({ ...(window.history.state || {}), __sheet: true }, ''); entryPushed = true; }
    const onPop = () => {
      if (selfBack > 0) { selfBack -= 1; return; }
      if (stack[stack.length - 1] !== id) return;
      window.history.pushState({ ...(window.history.state || {}), __sheet: true }, '');
      step();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      openSheets -= 1;
      setTimeout(() => {
        if (openSheets > 0 || !entryPushed) return;
        entryPushed = false;
        if (window.history.state?.__sheet) { selfBack += 1; window.history.back(); }
      }, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, id]);

  const onPointerDown = (e) => {
    if (e.target.closest('button,a,input,textarea')) return;
    drag.current = { y: e.clientY, t: performance.now() };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => { if (drag.current) setDragY(Math.max(0, e.clientY - drag.current.y)); };
  const endDrag = (e, cancelled) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragY(0);
    if (cancelled) return;
    const next = detentAfterDrag(detent, e.clientY - d.y, performance.now() - d.t);
    if (next === 'close') onClose?.();
    else if (next !== detent) onDetentChange?.(next);
  };

  // A text field gaining focus raises the keyboard: go full so the footer and field stay visible.
  const onFocusCapture = (e) => { if (detent === 'half' && isTextEntry(e.target)) onDetentChange?.('full'); };

  if (!mounted) return null;
  const showing = shown && isOpen;
  const fullH = `calc(${vp.h}px - env(safe-area-inset-top))`;
  return createPortal(
    <>
      {scrim && (
        <div
          className={`fixed inset-0 z-modal bg-black/30 transition-opacity duration-200 motion-reduce:transition-none ${showing ? 'opacity-100' : 'opacity-0'}`}
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal={modal ? 'true' : 'false'}
        aria-labelledby={titleId}
        tabIndex={-1}
        data-detent-sheet={detent}
        onFocusCapture={onFocusCapture}
        className="fixed inset-x-0 z-modal flex flex-col bg-surface rounded-t-[16px] shadow-spa-modal outline-none overflow-hidden transition-[transform,height] duration-200 ease-out motion-reduce:transition-none"
        style={{
          bottom: vp.bottom,
          height: full ? fullH : `min(${halfMaxPx(vp.h)}px, ${fullH})`,
          transform: showing ? `translateY(${dragY}px)` : 'translateY(100%)',
          transitionDuration: drag.current ? '0ms' : undefined,
        }}
      >
        <div className="flex-shrink-0 touch-none select-none" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={(e) => endDrag(e, false)} onPointerCancel={(e) => endDrag(e, true)}>
          <div className="flex justify-center pt-2 pb-1"><span className="block w-9 h-1 rounded-full bg-border" aria-hidden="true" /></div>
          {header}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain">{children}</div>
        {footer && <div className="flex-shrink-0 border-t border-border bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] [&_button]:min-h-[44px]">{footer}</div>}
      </div>
    </>,
    document.body
  );
};

// Call right before navigating to another page from inside a sheet: our history entry is turned into a plain same-URL entry
// (flag stripped), so Back from the new page lands on the original page in one press, and the sheet's cleanup sees no flag
// and does not history.back() over the navigation.
export function releaseSheetEntry() {
  const st = window.history.state;
  if (entryPushed && st?.__sheet) {
    const { __sheet, ...rest } = st;
    window.history.replaceState(rest, '');
  }
  entryPushed = false;
}

const BottomSheet = ({ isOpen, title, onClose, onBack, children, footer, headerExtra }) => {
  const id = useId();
  const titleId = `bottom-sheet-title-${id}`;
  const panelRef = useRef(null);
  const returnFocusRef = useRef(null);

  const [mounted, setMounted] = useState(isOpen);
  const [shown, setShown] = useState(false);
  const [dragY, setDragY] = useState(0);
  const drag = useRef(null);

  useEffect(() => {
    if (isOpen) { setMounted(true); return undefined; }
    setShown(false);
    const t = setTimeout(() => { setMounted(false); setDragY(0); }, 220);
    return () => clearTimeout(t);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !mounted) return undefined;
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, [isOpen, mounted]);

  // Lock scroll, register on the stack, trap + restore focus.
  useEffect(() => {
    if (!isOpen) return undefined;
    returnFocusRef.current = document.activeElement;
    stack.push(id);
    lockScroll();
    const focusT = setTimeout(() => {
      const el = panelRef.current;
      if (el && !el.contains(document.activeElement)) (el.querySelector('[data-autofocus]') || el).focus({ preventScroll: true });
    }, 0);

    const onKey = (e) => {
      if (stack[stack.length - 1] !== id) return;
      if (e.key === 'Escape') {
        if (e.defaultPrevented) return;
        e.preventDefault();
        onClose?.();
      } else if (e.key === 'Tab') {
        const el = panelRef.current;
        if (!el) return;
        const items = Array.from(el.querySelectorAll(FOCUSABLE)).filter((n) => n.offsetParent !== null);
        if (!items.length) { e.preventDefault(); el.focus(); return; }
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(focusT);
      document.removeEventListener('keydown', onKey);
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
      unlockScroll();
      const back = returnFocusRef.current;
      if (back && typeof back.focus === 'function' && document.contains(back)) back.focus({ preventScroll: true });
    };
  }, [isOpen, id, onClose]);

  // Swipe down on the handle / header.
  const onPointerDown = (e) => {
    if (e.target.closest('button')) return;
    drag.current = { y: e.clientY, t: performance.now(), pid: e.pointerId };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    setDragY(Math.max(0, e.clientY - drag.current.y));
  };
  const endDrag = (e, cancelled) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    const dy = e.clientY - d.y;
    if (!cancelled && shouldDismissSheet(dy, performance.now() - d.t)) onClose?.();
    setDragY(0);
  };

  if (!mounted) return null;

  return createPortal(
    <>
      <div
        className={`fixed inset-0 z-modal bg-black/30 transition-opacity duration-200 motion-reduce:transition-none ${shown && isOpen ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="fixed inset-x-0 bottom-0 z-modal flex justify-center md:inset-0 md:items-center pointer-events-none"
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          data-bottom-sheet="true"
          className="pointer-events-auto w-full md:max-w-md bg-surface flex flex-col max-h-[90dvh] rounded-t-[16px] md:rounded-spa-lg shadow-spa-modal outline-none transition-transform duration-200 ease-out motion-reduce:transition-none"
          style={{
            transform: shown && isOpen ? `translateY(${dragY}px)` : 'translateY(100%)',
            transitionDuration: drag.current ? '0ms' : undefined,
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          <div
            className="flex-shrink-0 touch-none select-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => endDrag(e, false)}
            onPointerCancel={(e) => endDrag(e, true)}
          >
            <div className="md:hidden flex justify-center pt-2"><span className="block w-9 h-1 rounded-full bg-border" aria-hidden="true" /></div>
            <div className="h-14 flex items-center justify-between gap-2 px-4 border-b border-border">
              <div className="flex items-center gap-1 min-w-0">
                {onBack && (
                  <button type="button" onClick={onBack} aria-label="Back" className="w-11 h-11 -ml-3 flex items-center justify-center rounded-spa text-text-secondary hover:bg-background spa-transition-fast flex-shrink-0">
                    <Icon name="ChevronLeft" size={20} />
                  </button>
                )}
                <h3 id={titleId} className="font-heading font-heading-semibold text-[16px] text-text-primary truncate">{title}</h3>
              </div>
              <div className="flex items-center gap-1">
                {headerExtra}
                <button type="button" onClick={onClose} aria-label="Close" className="w-11 h-11 -mr-2 flex items-center justify-center rounded-spa text-text-secondary hover:bg-background spa-transition-fast">
                  <Icon name="X" size={20} />
                </button>
              </div>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">{children}</div>
          {footer && <div className="flex-shrink-0 border-t border-border bg-surface p-4">{footer}</div>}
        </div>
      </div>
    </>,
    document.body
  );
};

// A titled group inside the sheet body.
export const SheetSection = ({ title, children }) => (
  <section className="px-4 py-3 border-b border-border last:border-b-0">
    {title && <h4 className="mb-1.5 text-[11px] font-body font-medium uppercase tracking-wider text-text-tertiary">{title}</h4>}
    {children}
  </section>
);

// A 44px+ row: icon, label, optional value / trailing node; a button when onClick is given.
export const SheetRow = ({ icon, label, value, trailing, onClick, disabled, danger, className = '' }) => {
  const inner = (
    <>
      {icon && <Icon name={icon} size={18} className={danger ? 'text-error' : 'text-text-secondary'} />}
      <span className={`flex-1 min-w-0 text-left text-[15px] ${danger ? 'text-error' : 'text-text-primary'}`}>{label}</span>
      {value != null && <span className="text-[13px] text-text-tertiary">{value}</span>}
      {trailing}
      {onClick && !trailing && <Icon name="ChevronRight" size={16} className="text-text-tertiary" />}
    </>
  );
  const cls = `w-full min-h-[44px] flex items-center gap-3 py-1.5 ${className}`;
  return onClick
    ? <button type="button" onClick={onClick} disabled={disabled} className={`${cls} hover:bg-background spa-transition-fast disabled:opacity-40`}>{inner}</button>
    : <div className={cls}>{inner}</div>;
};

export default BottomSheet;
