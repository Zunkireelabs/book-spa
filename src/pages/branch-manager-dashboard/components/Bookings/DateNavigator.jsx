import React, { useState, useRef, useMemo } from 'react';
import Icon from '../../../../components/AppIcon';
import { useDismiss } from '../../../../components/ui/ListToolbarKit';
import { makeRange, stepRange, rangeLabel, addMonths } from '../../../../utils/bookingsList';

const MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const PRESETS = [
  { mode: 'day', label: 'Day' },
  { mode: 'week', label: 'Next 7 days' },
  { mode: 'month', label: 'This month' },
  { mode: 'custom', label: 'Custom range' },
];

// Cells of a month grid (Mon-first), as ISO strings or null for the leading blanks.
function monthCells(firstISO) {
  const [y, m] = firstISO.split('-').map(Number);
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [...Array(lead).fill(null), ...Array.from({ length: n }, (_, i) => `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`)];
}

// ‹ [📅 Today · Thu 15 Oct ▾] › — the arrows step by the active range unit; the popover has a mini month and the presets.
const DateNavigator = ({ range, today, onChange }) => {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(range.from.slice(0, 7) + '-01');
  const [pendingFrom, setPendingFrom] = useState(null); // custom range: first click chosen, waiting for the second
  const ref = useRef(null);
  useDismiss(open, setOpen, ref);
  const cells = useMemo(() => monthCells(view), [view]);
  const [vy, vm] = view.split('-').map(Number);

  const toggle = () => { setView(range.from.slice(0, 7) + '-01'); setPendingFrom(null); setOpen((o) => !o); };
  const pick = (iso) => {
    if (range.mode === 'custom') {
      if (!pendingFrom) { setPendingFrom(iso); return; }
      onChange(makeRange('custom', iso, { from: pendingFrom, to: iso }));
      setPendingFrom(null); setOpen(false);
      return;
    }
    onChange(makeRange(range.mode, iso));
    setOpen(false);
  };
  const preset = (mode) => {
    setPendingFrom(null);
    if (mode === 'custom') { onChange({ mode: 'custom', from: range.from, to: range.to }); return; }
    onChange(makeRange(mode, mode === 'month' ? today : range.from));
    if (mode !== 'day') setOpen(false);
  };

  const inRange = (iso) => (pendingFrom ? iso === pendingFrom : iso >= range.from && iso <= range.to);
  const unit = { day: 'day', week: '7 days', month: 'month', custom: 'range' }[range.mode];

  return (
    <div className="relative flex items-center gap-1.5" ref={ref}>
      <button type="button" onClick={() => onChange(stepRange(range, -1))} aria-label={`Previous ${unit}`} className="w-[30px] h-[30px] border border-border rounded-md grid place-items-center text-[#515152] hover:bg-[#FAFAF9]"><Icon name="ChevronLeft" size={15} /></button>
      <button type="button" onClick={toggle} aria-haspopup="dialog" aria-expanded={open} className="h-[30px] border border-border rounded-md px-2.5 inline-flex items-center gap-2 text-[13px] font-medium bg-white hover:bg-[#FAFAF9] whitespace-nowrap">
        <Icon name="Calendar" size={14} className="text-[#8A8A90]" />{rangeLabel(range, today)}<Icon name="ChevronDown" size={13} className="text-[#8A8A90]" />
      </button>
      <button type="button" onClick={() => onChange(stepRange(range, 1))} aria-label={`Next ${unit}`} className="w-[30px] h-[30px] border border-border rounded-md grid place-items-center text-[#515152] hover:bg-[#FAFAF9]"><Icon name="ChevronRight" size={15} /></button>
      {open && (
        <div role="dialog" aria-label="Choose dates" className="absolute left-0 top-9 z-dropdown bg-white border border-border rounded-lg shadow-[0_8px_24px_rgba(14,13,12,.1)] p-3 flex flex-col sm:flex-row gap-3">
          <div className="flex sm:flex-col gap-1 sm:w-[128px] flex-wrap">
            {PRESETS.map((p) => (
              <button key={p.mode} type="button" onClick={() => preset(p.mode)} className={`h-8 px-2.5 rounded-md text-[13px] text-left whitespace-nowrap hover:bg-[#FAFAF9] ${range.mode === p.mode ? 'bg-[#F2F6F0] font-medium text-text-primary' : 'text-[#515152]'}`}>{p.label}</button>
            ))}
            <button type="button" onClick={() => { onChange(makeRange('day', today)); setOpen(false); }} className="h-8 px-2.5 rounded-md text-[13px] text-left text-primary font-medium hover:bg-[#FAFAF9] sm:mt-2 sm:border-t sm:border-border sm:rounded-none sm:pt-2">Today</button>
          </div>
          <div className="w-[238px]">
            <div className="flex items-center justify-between mb-1.5">
              <button type="button" onClick={() => setView(addMonths(view, -1))} aria-label="Previous month" className="w-7 h-7 grid place-items-center rounded-md hover:bg-[#FAFAF9] text-[#515152]"><Icon name="ChevronLeft" size={14} /></button>
              <span className="text-[13px] font-medium">{MON_LONG[vm - 1]} {vy}</span>
              <button type="button" onClick={() => setView(addMonths(view, 1))} aria-label="Next month" className="w-7 h-7 grid place-items-center rounded-md hover:bg-[#FAFAF9] text-[#515152]"><Icon name="ChevronRight" size={14} /></button>
            </div>
            <div className="grid grid-cols-7 text-center text-[11px] text-[#8A8A90] mb-1">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i}>{d}</span>)}</div>
            <div className="grid grid-cols-7 gap-y-0.5">
              {cells.map((iso, i) => iso ? (
                <button key={iso} type="button" onClick={() => pick(iso)} aria-label={iso} aria-pressed={inRange(iso)}
                  className={`h-8 text-[12.5px] tabular-nums grid place-items-center ${inRange(iso) ? 'bg-[#EEF3EC] text-primary font-medium' : 'hover:bg-[#FAFAF9]'} ${iso === range.from || iso === pendingFrom ? 'rounded-l-md' : ''} ${iso === range.to || iso === pendingFrom ? 'rounded-r-md' : ''} ${!inRange(iso) ? 'rounded-md' : ''} ${iso === today ? 'font-semibold underline decoration-primary underline-offset-4' : ''}`}>
                  {Number(iso.slice(8))}
                </button>
              ) : <span key={`b${i}`} />)}
            </div>
            {range.mode === 'custom' && <p className="text-[12px] text-[#8A8A90] mt-2">{pendingFrom ? 'Now pick the last day.' : 'Pick the first and last day.'}</p>}
          </div>
        </div>
      )}
    </div>
  );
};

export default DateNavigator;
