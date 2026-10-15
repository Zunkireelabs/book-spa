import React, { useState, useEffect, useRef } from 'react';
import Icon from '../AppIcon';

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

// Dashed filter chip: "+ Therapist"; once set it turns solid with the value and an × to clear.
export const FilterChip = ({ label, value, options, onChange, selectedLabel }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismiss(open, setOpen, ref);
  const set = value != null && value !== '';
  return (
    <div className="relative" ref={ref}>
      <span className={`h-7 rounded-full inline-flex items-center text-[12.5px] font-medium ${set ? 'border border-border bg-[#FAFAF9] text-text-primary' : 'border border-dashed border-[#D3D5D0] text-[#515152] hover:bg-[#FAFAF9]'}`}>
        <button type="button" onClick={() => setOpen((o) => !o)} className="h-full px-2.5 inline-flex items-center gap-[5px]" aria-haspopup="listbox" aria-expanded={open}>
          {!set && <Icon name="Plus" size={13} />}{set ? `${label}: ${selectedLabel}` : label}
        </button>
        {set && <button type="button" onClick={() => onChange('')} aria-label={`Clear ${label}`} className="h-full pr-2 -ml-1 text-[#8A8A90] hover:text-text-primary"><Icon name="X" size={12} /></button>}
      </span>
      {open && (
        <div role="listbox" className="absolute left-0 top-9 z-dropdown min-w-[200px] max-h-64 overflow-y-auto bg-white border border-border rounded-lg shadow-[0_8px_24px_rgba(14,13,12,.1)] py-1">
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

export const Menu = ({ trigger, children }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismiss(open, setOpen, ref);
  return (
    <div className="relative" ref={ref}>
      {trigger(open, () => setOpen((o) => !o))}
      {open && <div className="absolute right-0 top-9 z-dropdown min-w-[190px] bg-white border border-border rounded-lg shadow-[0_8px_24px_rgba(14,13,12,.1)] py-1">{children(() => setOpen(false))}</div>}
    </div>
  );
};
