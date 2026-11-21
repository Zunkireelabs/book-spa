import React, { useState, useEffect, useRef } from 'react';
import Icon from '../AppIcon';
import BottomSheet, { useMediaQuery } from './BottomSheet';

// Shared by the list pages' toolbars (Customers, Bookings): outside-click/Esc dismissal, the dashed "+ Filter" chip and a small menu.

export const useDismiss = (open, setOpen, ref) => {
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc, true); };
  }, [open, setOpen, ref]);
};

// Phone (< md): every filter chip / menu opens the shared BottomSheet (title, ×, 44px rows, check on the selected one, swipe / Esc / tap-outside to close)
// instead of a popover. >= md keeps the dropdowns.
export const usePhone = () => useMediaQuery('(max-width: 767.98px)');
const SHEET_ROWS = '[&_button]:min-h-11 [&_label]:min-h-11 [&_button]:text-[15px] [&_label]:text-[15px] [&_button]:px-4 [&_label]:px-4 [&_button]:py-2 [&_label]:py-2';

// Dashed filter chip: "+ Therapist"; once set it turns solid with the value and an × to clear.
export const FilterChip = ({ label, value, options, onChange, selectedLabel }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const phone = usePhone();
  useDismiss(open && !phone, setOpen, ref);
  const set = value != null && value !== '';
  return (
    <div className="relative" ref={ref}>
      <span className={`h-7 max-md:h-11 rounded-full inline-flex items-center text-[12.5px] font-medium ${set ? 'border border-border bg-[#FAFAF9] text-text-primary' : 'border border-dashed border-[#D3D5D0] text-[#515152] hover:bg-[#FAFAF9]'}`}>
        <button type="button" onClick={() => setOpen((o) => !o)} className="h-full px-2.5 inline-flex items-center gap-[5px]" aria-haspopup="listbox" aria-expanded={open}>
          {!set && <Icon name="Plus" size={13} />}{set ? `${label}: ${selectedLabel}` : label}
        </button>
        {set && <button type="button" onClick={() => onChange('')} aria-label={`Clear ${label}`} className="h-full pr-2 -ml-1 text-[#8A8A90] hover:text-text-primary"><Icon name="X" size={12} /></button>}
      </span>
      {open && phone && (
        <BottomSheet isOpen onClose={() => setOpen(false)} title={label}>
          <div role="listbox" className="pb-2">
            {options.length === 0 && <p className="px-4 py-3 text-[14px] text-[#8A8A90]">Nothing to filter by yet</p>}
            {options.map((o) => (
              <button key={o.id} type="button" role="option" aria-selected={value === o.id} onClick={() => { onChange(o.id); setOpen(false); }}
                className={`w-full min-h-11 text-left px-4 py-2 text-[15px] flex items-center justify-between gap-3 ${value === o.id ? 'font-medium' : ''}`}>
                <span className="truncate">{o.label}</span>{value === o.id && <Icon name="Check" size={16} />}
              </button>
            ))}
          </div>
        </BottomSheet>
      )}
      {open && !phone && (
        <div role="listbox" className="absolute left-0 top-9 z-dropdown min-w-[200px] max-h-64 overflow-y-auto max-md:fixed max-md:inset-x-3 max-md:top-auto max-md:bottom-3 max-md:left-3 max-md:min-w-0 max-md:max-h-[60dvh] bg-white border border-border rounded-lg shadow-[0_8px_24px_rgba(14,13,12,.1)] py-1">
          {options.length === 0 && <p className="px-3 py-2 text-[12.5px] text-[#8A8A90]">Nothing to filter by yet</p>}
          {options.map((o) => (
            <button key={o.id} type="button" role="option" aria-selected={value === o.id} onClick={() => { onChange(o.id); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-[13px] hover:bg-[#FAFAF9] flex items-center justify-between gap-3 ${value === o.id ? 'font-medium' : ''}`}>
              <span className="truncate">{o.label}</span>{value === o.id && <Icon name="Check" size={13} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// `title` is required: it heads the phone sheet, so say what the menu chooses ("Sort by", "Columns"); never a generic "Options".
export const Menu = ({ trigger, children, title }) => {
  if (!title && import.meta.env?.DEV) console.error('ListToolbarKit Menu: `title` is required (it heads the phone sheet).');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const phone = usePhone();
  useDismiss(open && !phone, setOpen, ref);
  return (
    <div className="relative" ref={ref}>
      {trigger(open, () => setOpen((o) => !o))}
      {open && phone && (
        <BottomSheet isOpen onClose={() => setOpen(false)} title={title}>
          <div className={`pb-2 ${SHEET_ROWS} [&_button]:w-full [&_button]:text-left [&_label]:flex`}>{children(() => setOpen(false))}</div>
        </BottomSheet>
      )}
      {open && !phone && <div className="absolute right-0 top-9 z-dropdown min-w-[190px] max-md:fixed max-md:inset-x-3 max-md:top-auto max-md:bottom-3 max-md:right-3 max-md:left-3 max-md:min-w-0 bg-white border border-border rounded-lg shadow-[0_8px_24px_rgba(14,13,12,.1)] py-1">{children(() => setOpen(false))}</div>}
    </div>
  );
};
