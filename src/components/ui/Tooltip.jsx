import React, { useState, useRef, useId, useCallback, useLayoutEffect, useEffect } from 'react';
import { createPortal } from 'react-dom';

// Instant dark-pill tooltip (native `title` waits ~1s). Mouse hover + keyboard focus only: touch gets none (tap still acts on the target).
// Portal + semantic z token; sits above the target, flips below near the top edge.
const SHOW_DELAY = 60;     // ms
const WARM_WINDOW = 250;   // moving between neighbouring tooltips shows the next one at once (no flicker)
let lastHideAt = 0;

export default function Tooltip({ label, children, className = 'inline-flex' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const anchorRef = useRef(null);
  const tipRef = useRef(null);
  const timer = useRef(null);
  const id = useId();

  const show = useCallback((instant) => {
    clearTimeout(timer.current);
    const go = () => setOpen(true);
    if (instant || Date.now() - lastHideAt < WARM_WINDOW) go(); else timer.current = setTimeout(go, SHOW_DELAY);
  }, []);
  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setOpen(prev => { if (prev) lastHideAt = Date.now(); return false; });
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !tipRef.current) return;
    const a = anchorRef.current.getBoundingClientRect();
    const t = tipRef.current.getBoundingClientRect();
    const above = a.top - t.height - 6 >= 4;
    const left = Math.min(Math.max(a.left + a.width / 2 - t.width / 2, 4), window.innerWidth - t.width - 4);
    setPos({ left, top: above ? a.top - t.height - 6 : a.bottom + 6 });
  }, [open, label]);
  useEffect(() => { if (!open) setPos(null); }, [open]);

  if (!label) return children;
  return (
    <span
      ref={anchorRef}
      className={className}
      aria-describedby={open ? id : undefined}
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') show(false); }}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={() => show(true)}
      onBlur={hide}
    >
      {children}
      {open && createPortal(
        <div ref={tipRef} id={id} role="tooltip"
          className="fixed z-notification pointer-events-none px-2 py-1 rounded-md bg-text-primary text-white text-[12px] leading-tight font-body whitespace-nowrap shadow-spa-elevated"
          style={{ left: pos ? pos.left : -9999, top: pos ? pos.top : -9999 }}>
          {label}
        </div>,
        document.body
      )}
    </span>
  );
}
