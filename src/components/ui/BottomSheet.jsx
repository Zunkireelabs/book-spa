import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../AppIcon';
import { shouldDismissSheet } from '../../utils/gestures';

// Shared sheet. Phone (< md): a bottom sheet (drag handle, swipe down to close, max 90dvh, safe-area padding).
// >= md: the same content in a centred dialog, so callers never need a second layout.
// Nested sheets: render a second <BottomSheet onBack=...> while the first is open. They stack (later one on top);
// only the top sheet handles Esc / Tab, and the body stays locked until the last one closes.
// `onClose` is called for the close button, Esc, scrim tap and swipe-down; callers put any guard behind it.

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const stack = []; // ids of open sheets, top = last
let lockCount = 0;
let prevOverflow = '';

const lockScroll = () => { if (lockCount++ === 0) { prevOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; } };
const unlockScroll = () => { if (--lockCount <= 0) { lockCount = 0; document.body.style.overflow = prevOverflow; } };

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
