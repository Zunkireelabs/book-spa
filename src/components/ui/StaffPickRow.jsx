import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Icon from '../AppIcon';
import { avatarColor } from '../../pages/branch-manager-dashboard/components/calendar/phoneCalendarLayout';
import BottomSheet, { useMediaQuery } from './BottomSheet';

// ONE "who is picked, tap to change" row (ZNLY-303): avatar · name · status line · Free/Busy pill · ›.
// Empty = a dashed "＋ Pick staff". `problem` turns it amber and shows the reason. Tapping opens `renderPicker(close)`:
// a bottom sheet on phone, a popover anchored under the row on desktop (↑/↓ move, Enter picks, Esc closes).
const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

// ZNLY-318 extensions (every user gets them): `people` + `max` for a couple (two overlapping avatars, "A, B", amber "1 of 2 · pick one more"),
// `assignedIds` / `assignedNames` (the saved assignment: ASSIGNED tag when the pick equals it, "Was <name>" hint when it differs),
// `onOpenPhone` (phone: the caller shows the list itself, e.g. in place inside its own sheet, instead of this row's own bottom sheet).
const StaffPickRow = ({ id = null, name = '', people = null, max = 1, statusLine = '', pill = null, problem = '', assignedIds = [], assignedNames = [], emptyLabel = 'Pick staff', title = 'Pick staff', renderPicker, onOpenPhone = null, disabled = false }) => {
  const picks = people || (name ? [{ id, name }] : []);
  const multi = max > 1;
  const partial = multi && Number.isFinite(max) && picks.length > 0 && picks.length < max;
  const need = max - picks.length;
  const shownProblem = problem || (partial ? `${picks.length} of ${max} · pick ${need === 1 ? 'one' : need} more` : '');
  const shownLine = multi && Number.isFinite(max) && picks.length === max && statusLine ? `${statusLine} · ${picks.length} of ${max}` : statusLine;
  const hasSaved = assignedIds.length > 0;
  const isSaved = hasSaved && picks.length > 0 && picks.length === assignedIds.length && picks.every((p) => assignedIds.includes(p.id));
  const wasHint = hasSaved && !isSaved && assignedNames.length > 0 ? `Was ${assignedNames.join(', ')}` : '';
  const [open, setOpen] = useState(false);
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
  useLayoutEffect(() => {
    if (!open || isPhone || !wrapRef.current || !popRef.current) { setFitH(null); return; }
    let sc = wrapRef.current.parentElement;
    while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
    if (!sc) return;
    const room = () => sc.getBoundingClientRect().bottom - wrapRef.current.getBoundingClientRect().bottom - 12;
    const need = Math.min(popRef.current.scrollHeight, 420);
    if (room() < need) {
      const canUp = wrapRef.current.getBoundingClientRect().top - sc.getBoundingClientRect().top - 8;
      sc.scrollTop += Math.max(0, Math.min(need - room(), canUp));
    }
    setFitH(Math.max(160, Math.min(need, room())));
  }, [open, isPhone]);

  const empty = picks.length === 0;
  const tone = shownProblem ? 'border-amber-300 bg-amber-50' : empty ? 'border-dashed border-border bg-surface' : 'border-border bg-surface';
  return (
    <div>
    <div ref={wrapRef} className="relative">
      <button ref={btnRef} type="button" disabled={disabled} aria-haspopup="dialog" aria-expanded={open} onClick={() => (isPhone && onOpenPhone ? onOpenPhone() : setOpen((o) => !o))}
        className={`w-full min-h-[44px] flex items-center gap-2.5 px-3 py-1.5 border rounded-spa text-left spa-transition-fast disabled:opacity-50 ${tone}`}>
        {empty ? (
          <span className="flex-1 text-sm text-text-secondary">＋ {emptyLabel}</span>
        ) : (
          <>
            <span className="flex flex-shrink-0">
              {picks.map((p, i) => (
                <span key={p.id || i} aria-hidden="true" className={`w-7 h-7 rounded-full text-white flex items-center justify-center text-[11px] font-semibold ${i > 0 ? '-ml-2 ring-2 ring-surface' : ''}`} style={{ background: avatarColor(p.id) }}>{initials(p.name)}</span>
              ))}
            </span>
            <span className="flex-1 min-w-0">
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="truncate text-sm font-body-medium text-text-primary">{picks.map((p) => p.name).join(', ')}</span>
                {isSaved && <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-success/10 text-success">Assigned</span>}
              </span>
              {(shownProblem || shownLine) && <span className={`block truncate text-xs ${shownProblem ? 'text-amber-800' : 'text-text-secondary'}`}>{shownProblem || shownLine}</span>}
            </span>
            {pill && !shownProblem && (
              <span className={`flex-shrink-0 whitespace-nowrap text-[11.5px] rounded-full px-2 py-0.5 ${pill === 'free' ? 'bg-success/10 text-success' : 'bg-amber-100 text-amber-800'}`}>{pill === 'free' ? 'Free' : 'Busy'}</span>
            )}
          </>
        )}
        <Icon name="ChevronRight" size={16} className="flex-shrink-0 text-text-secondary" />
      </button>
      {open && !isPhone && (
        <div ref={popRef} role="dialog" aria-label={title} style={fitH ? { maxHeight: fitH } : undefined} className="absolute left-0 right-0 top-full mt-1 z-dropdown panel-fit [--panel-gap:6rem] bg-surface border border-border rounded-spa-lg shadow-spa-elevated overflow-y-auto overscroll-contain">
          {renderPicker(close)}
        </div>
      )}
      {isPhone && (
        <BottomSheet isOpen={open} title={title} floatingClose onClose={close}
          footer={multi ? <button type="button" onClick={close} className="w-full min-h-[44px] rounded-spa bg-primary text-white text-sm font-semibold">Done</button> : undefined}>
          <div className="pb-4">{renderPicker(close)}</div>
        </BottomSheet>
      )}
    </div>
    {wasHint && !open && <p className="mt-1.5 px-0.5 text-xs text-text-secondary">{wasHint}</p>}
    </div>
  );
};

export default StaffPickRow;
