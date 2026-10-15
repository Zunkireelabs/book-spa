import React, { useState, useRef, useEffect } from 'react';
import { initials } from '../../../../utils/customerDirectory';


// "● Free now 4 [avatars] ▾" with a card that opens on hover, click and keyboard. `onBook(therapistId)` is omitted for read-only roles.
const FreeNowChip = ({ availability, nowLabel, serviceNamesFor, onBook }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const timer = useRef(null);
  const { free, inSession, basis } = availability;
  const onToday = basis === 'bookings'; // no shift hours or check-ins recorded: only people with a booking today are counted

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc, true); };
  }, [open]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const hoverOpen = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(true), 120); };
  const hoverClose = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), 220); };

  return (
    <div ref={ref} className="relative flex-shrink-0 ml-2" onMouseEnter={hoverOpen} onMouseLeave={hoverClose}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open} data-free-chip
        className="h-7 px-2.5 border border-border rounded-[7px] inline-flex items-center gap-2 text-[12.5px] bg-white hover:bg-[#FAFAF9] whitespace-nowrap">
        <i className="w-[7px] h-[7px] rounded-full bg-[#22C55E]" />Free now{onToday && <span className="hidden sm:inline">&nbsp;(on today)</span>} <b className="font-semibold tabular-nums">{free.length}</b>
        <span className="hidden sm:flex">
          {free.slice(0, 4).map((f) => <i key={f.therapist.id} className="w-[22px] h-[22px] rounded-full bg-[#ECFDF3] text-[#15803D] border-2 border-white text-[9px] not-italic font-semibold grid place-items-center -ml-1.5 first:ml-0">{initials(f.therapist.name)}</i>)}
        </span>
      </button>
      {open && (
        <div role="dialog" aria-label="Free now" className="absolute right-0 top-8 z-dropdown w-[320px] max-w-[calc(100vw-32px)] bg-white border border-border rounded-[10px] shadow-[0_16px_40px_rgba(14,13,12,.12)] p-2.5 max-h-[70vh] overflow-y-auto">
          <div className="text-[11.5px] font-semibold text-[#8A8A90] uppercase tracking-[.04em] px-1 pb-1.5">Free now <span className="normal-case tracking-normal font-medium">· {nowLabel}</span></div>
          {onToday && <p className="px-1 pb-1.5 text-[11.5px] text-[#8A8A90] leading-snug">No shift hours or check-ins are recorded, so this counts people with a booking today.</p>}
          {free.length === 0 && <p className="px-1 py-2 text-[12.5px] text-[#8A8A90]">Nobody is free right now.</p>}
          {free.map((f) => {
            const svc = serviceNamesFor(f.therapist.id);
            return (
              <div key={f.therapist.id} className="flex items-center gap-2.5 px-1 py-1.5 rounded-md hover:bg-[#FAFAF9]" data-free-row={f.therapist.id}>
                <i className="w-[26px] h-[26px] rounded-full bg-[#ECFDF3] text-[#15803D] text-[10px] not-italic font-semibold grid place-items-center flex-shrink-0">{initials(f.therapist.name)}</i>
                <div className="min-w-0 flex-1">
                  <b className="block font-medium text-[13px] truncate">{f.therapist.name}</b>
                  <span className="block text-[12px] text-[#8A8A90] truncate">{[f.label, svc].filter(Boolean).join(' · ')}</span>
                </div>
                {onBook && <button type="button" onClick={() => { setOpen(false); onBook(f.therapist.id); }} className="h-[26px] px-[9px] border border-border rounded-md bg-white text-[12px] font-medium hover:bg-[#FAFAF9] flex-shrink-0">Book</button>}
              </div>
            );
          })}
          {inSession.length > 0 && (
            <>
              <div className="text-[11.5px] font-semibold text-[#8A8A90] uppercase tracking-[.04em] px-1 pt-3 pb-1.5">In session <span className="normal-case tracking-normal font-medium">· {inSession.length}</span></div>
              {inSession.map((s) => (
                <div key={s.therapist.id} className="flex items-center gap-2.5 px-1 py-1.5" data-session-row={s.therapist.id}>
                  <i className="w-[26px] h-[26px] rounded-full bg-[#EEF0FF] text-[#4338CA] text-[10px] not-italic font-semibold grid place-items-center flex-shrink-0">{initials(s.therapist.name)}</i>
                  <div className="min-w-0"><b className="block font-medium text-[13px] truncate">{s.therapist.name}</b><span className="block text-[12px] text-[#8A8A90]">{s.label}</span></div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default FreeNowChip;
