import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Icon from '../AppIcon';
import BottomSheet, { useMediaQuery } from './BottomSheet';

// ONE "tap the row, pick from a list" shell (ZNLY-303 / 318 / 320), shared by StaffPickRow and ServicePickRow.
// The row is a full-width button (`children` inside, then a ›). Tapping opens `renderPicker(close)`: a bottom sheet on phone,
// a popover anchored under the row on desktop (↑/↓ move between radios/checkboxes, Enter picks, Esc closes, outside click closes).
// `onOpenPhone`: phone only, the caller shows the list itself instead of this shell's own bottom sheet.
// `renderTrigger({ open, toggle, btnRef })` replaces the default full-width row button (e.g. a header "＋ Add client" link); `openSignal` opens the picker
// from outside whenever it changes to a new positive number.
const PickShell = ({ tone = 'border-border bg-surface', title = 'Pick', renderPicker, onOpenPhone = null, disabled = false, sheetFooter, belowRow = null, renderTrigger = null, openSignal = 0, onSignalConsumed = null, children }) => {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (openSignal > 0) { setOpen(true); onSignalConsumed?.(); } }, [openSignal]); // eslint-disable-line react-hooks/exhaustive-deps
  const wrapRef = useRef(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const isPhone = useMediaQuery('(max-width: 767.98px)');
  const close = () => setOpen(false);

  // Desktop popover: outside click / Esc close; ↑ ↓ move between rows, Enter picks the focused one.
  useEffect(() => {
    if (!open || isPhone) return undefined;
    const rows = () => Array.from(popRef.current?.querySelectorAll('input[type="checkbox"]:not([disabled]), input[type="radio"]:not([disabled]), [data-pick-none]') || []);
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); btnRef.current?.focus(); return; }
      if (!popRef.current?.contains(document.activeElement) && document.activeElement !== btnRef.current) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const list = rows(); if (!list.length) return;
        e.preventDefault();
        const i = list.indexOf(document.activeElement);
        list[e.key === 'ArrowDown' ? (i + 1) % list.length : (i <= 0 ? list.length - 1 : i - 1)].focus();
      } else if (e.key === 'Enter' && popRef.current?.contains(document.activeElement) && document.activeElement.type !== 'text') {
        e.preventDefault(); document.activeElement.click();
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey, true); };
  }, [open, isPhone]);

  // Keep the popover inside the panel's scroll area (above its sticky footer): scroll the row up if needed, then cap the height to what is left.
  const [fitH, setFitH] = useState(null);
  const [narrow, setNarrow] = useState(null); // { right: bool, w: px } when the row is narrower than the list needs (e.g. a half-width column)
  useLayoutEffect(() => {
    if (!open || isPhone || !wrapRef.current || !popRef.current) { setFitH(null); setNarrow(null); return; }
    let sc = wrapRef.current.parentElement;
    while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
    const MIN_W = 360;
    const rowR = wrapRef.current.getBoundingClientRect();
    // The box the list must fit in: the scrolling ancestor, else the enclosing panel / dialog, else the viewport. (A small trigger such as a
    // header link has no scroll ancestor and a tiny parent: sizing against that gave an ~80px list.)
    const host = sc || wrapRef.current.closest('[role="dialog"]');
    const box = host ? host.getBoundingClientRect() : { left: 0, width: window.innerWidth };
    if (rowR.width < MIN_W) {
      const w = Math.min(MIN_W, Math.max(rowR.width, box.width - 16));
      setNarrow({ right: (rowR.left + rowR.width / 2) > (box.left + box.width / 2), w });
    } else setNarrow(null);
    if (!sc) return;
    const room = () => sc.getBoundingClientRect().bottom - wrapRef.current.getBoundingClientRect().bottom - 12;
    const need = Math.min(popRef.current.scrollHeight, 420);
    if (room() < need) {
      const canUp = wrapRef.current.getBoundingClientRect().top - sc.getBoundingClientRect().top - 8;
      sc.scrollTop += Math.max(0, Math.min(need - room(), canUp));
    }
    setFitH(Math.max(160, Math.min(need, room())));
  }, [open, isPhone]);

  return (
    <div>
    <div ref={wrapRef} className="relative">
      {renderTrigger ? renderTrigger({ open, toggle: () => setOpen((o) => !o), btnRef }) : (
      <button ref={btnRef} type="button" disabled={disabled} aria-haspopup="dialog" aria-expanded={open} onClick={() => (isPhone && onOpenPhone ? onOpenPhone() : setOpen((o) => !o))}
        className={`w-full min-h-[44px] flex items-center gap-2.5 px-3 py-1.5 border rounded-spa text-left spa-transition-fast disabled:opacity-50 ${tone}`}>
        {children}
        <Icon name="ChevronRight" size={16} className="flex-shrink-0 text-text-secondary" />
      </button>)}
      {open && !isPhone && (
        <div ref={popRef} role="dialog" aria-label={title} style={{ ...(fitH ? { maxHeight: fitH } : {}), ...(narrow ? { width: narrow.w } : {}) }} className={`absolute ${narrow ? (narrow.right ? 'right-0' : 'left-0') : 'left-0 right-0'} top-full mt-1 z-dropdown panel-fit [--panel-gap:6rem] bg-surface border border-border rounded-spa-lg shadow-spa-elevated overflow-y-auto overscroll-contain`}>
          {renderPicker(close)}
        </div>
      )}
      {isPhone && (
        <BottomSheet isOpen={open} title={title} floatingClose onClose={close} footer={typeof sheetFooter === 'function' ? sheetFooter(close) : sheetFooter}>
          <div className="pb-4">{renderPicker(close)}</div>
        </BottomSheet>
      )}
    </div>
    {typeof belowRow === 'function' ? belowRow(open) : belowRow}
    </div>
  );
};

export default PickShell;
