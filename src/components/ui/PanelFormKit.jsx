import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Icon from '../AppIcon';
import SidePanel from './SidePanel';
import CustomSelect from './CustomSelect';
import MiniMonthCalendar from '../../pages/branch-manager-dashboard/components/calendar/MiniMonthCalendar';

// Shared building blocks for the calendar's block / transfer forms so they look and behave like quick-create:
// 13px labels, 40px controls, a "Mon 12 Oct" date button with the mini-month popover, a 12-hour time picker snapped to
// 10 minutes, the ink segmented control, and a SidePanel (docked overlay) shell with a sticky footer and the inline
// dirty-draft confirm. `PanelShell` also renders the same form as a centered modal (`variant="modal"`) for any caller
// that isn't the calendar.

export const CONTROL = 'w-full h-10 px-3 text-[13px] font-body text-text-primary bg-surface border border-border rounded-spa focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-60 disabled:cursor-not-allowed placeholder:text-text-tertiary';

export const format12h = (time24) => {
  if (!time24) return '';
  const [h, m] = String(time24).split(':').map(Number);
  if (Number.isNaN(h)) return '';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m || 0).padStart(2, '0')}${h >= 12 && h < 24 ? 'pm' : 'am'}`;
};

export const addMinutes = (time24, minutes) => {
  const [h, m] = time24.split(':').map(Number);
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

// 'Mon 12 Oct' (add the year when it isn't the current one).
export const formatShortDate = (ymd, withYear = false) => {
  if (!ymd) return '';
  const d = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) }).replace(',', '');
};

// Parse free-typed time ("9", "9:30", "9:30am", "21:15") into "HH:MM"; null while incomplete.
const parseTimeInput = (raw) => {
  const match = raw.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;
  let h = Number(match[1]);
  const m = match[2] ? Number(match[2]) : 0;
  const suffix = match[3]?.toLowerCase();
  if (m > 59) return null;
  if (suffix === 'pm' && h < 12) h += 12;
  if (suffix === 'am' && h === 12) h = 0;
  if (h > 23) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

export const Field = ({ label, required, hint, children, className = '' }) => (
  <div className={className}>
    {label && (
      <label className="block font-body font-body-medium text-[13px] text-text-primary mb-1.5">
        {label} {required && <span className="text-error">*</span>}
      </label>
    )}
    {children}
    {hint && <p className="mt-1.5 text-xs text-text-secondary">{hint}</p>}
  </div>
);

export const TextInput = (props) => <input type="text" {...props} className={`${CONTROL} ${props.className || ''}`} />;
export const NumberInput = (props) => <input type="number" {...props} className={`${CONTROL} ${props.className || ''}`} />;

export const SelectField = ({ value, onChange, options, placeholder, disabled }) => (
  <CustomSelect value={value} onChange={onChange} options={options} placeholder={placeholder} disabled={disabled} size="md" />
);

// Ink segmented control (same look as the toolbar's Day / 4 Day and quick-create's Individual / Group).
export const Segmented = ({ options, value, onChange, disabled }) => (
  <div className={`grid gap-0.5 p-0.5 h-10 bg-background border border-border rounded-spa`} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }} role="group">
    {options.map(([val, label]) => (
      <button
        key={val}
        type="button"
        disabled={disabled}
        aria-pressed={value === val}
        onClick={() => onChange(val)}
        className={`px-3 text-[13px] font-body font-body-medium rounded-[4px] transition-colors disabled:opacity-60 ${
          value === val ? 'bg-text-primary text-white' : 'text-text-secondary hover:text-text-primary'
        }`}
      >
        {label}
      </button>
    ))}
  </div>
);

// Equal-fit tab bar, same style as the booking panel's (primary underline, icon + label).
export const TabBar = ({ tabs, value, onChange }) => (
  <div className="sticky top-0 z-10 bg-surface border-b border-border">
    <nav className="grid" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={value === tab.id}
          onClick={() => onChange(tab.id)}
          className={`h-11 flex items-center justify-center gap-1.5 text-[13px] font-body font-body-medium border-b-2 -mb-px spa-transition-fast whitespace-nowrap ${
            value === tab.id ? 'border-primary text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          {tab.icon && <Icon name={tab.icon} size={14} />}
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  </div>
);

export const InlineError = ({ message }) => (message ? (
  <div role="alert" className="flex items-start gap-2 px-3 py-2 rounded-spa bg-error/10 border border-error/20">
    <Icon name="AlertCircle" size={14} className="text-error mt-0.5 flex-shrink-0" />
    <span className="font-body text-[13px] text-error">{message}</span>
  </div>
) : null);

export const InlineWarning = ({ message, icon = 'AlertTriangle' }) => (message ? (
  <div role="alert" className="flex items-start gap-2 px-3 py-2 rounded-spa bg-error/10 border border-error/20">
    <Icon name={icon} size={14} className="text-error mt-0.5 flex-shrink-0" />
    <span className="font-body text-[13px] text-error">{message}</span>
  </div>
) : null);

// "Mon 12 Oct" button + mini-month popover.
export const DateField = ({ value, onChange, label, required, disabled, hint, min }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const today = new Date();
  const todayYmd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return (
    <Field label={label} required={required} hint={hint}>
      <div className="relative" ref={ref}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="w-full h-10 pl-9 pr-3 flex items-center text-[13px] font-body text-text-primary bg-surface border border-border rounded-spa hover:bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 text-left disabled:opacity-60"
        >
          <Icon name="Calendar" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
          <span className="truncate">{value ? formatShortDate(value) : 'Pick a date'}</span>
        </button>
        {open && (
          <div className="absolute left-0 top-full mt-1 bg-surface border border-border rounded-spa-lg shadow-spa-elevated z-dropdown p-3">
            <MiniMonthCalendar
              selectedDate={value || min || todayYmd}
              onDateSelect={(d) => { if (!min || d >= min) { onChange(d); setOpen(false); } }}
            />
          </div>
        )}
      </div>
    </Field>
  );
};

// 12-hour time picker: type ("6:50pm", "18:50") or pick from the list, snapped to `step` minutes.
export const TimeField = ({ value, onChange, label, required, disabled, hint, step = 10, fromTime = '06:00', toTime = '23:50' }) => {
  const [text, setText] = useState(value ? format12h(value) : '');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const listRef = useRef(null);
  useEffect(() => { setText(value ? format12h(value) : ''); }, [value]);
  const options = useMemo(() => {
    const [fh, fm] = fromTime.split(':').map(Number);
    const [th, tm] = toTime.split(':').map(Number);
    const out = [];
    for (let t = fh * 60 + fm; t <= th * 60 + tm; t += step) out.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
    if (value && !out.includes(value)) { out.push(value); out.sort(); }
    return out;
  }, [fromTime, toTime, step, value]);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  useEffect(() => {
    if (!open || !listRef.current) return;
    const sel = listRef.current.querySelector('[data-selected="true"]');
    if (sel) listRef.current.scrollTop = Math.max(0, sel.offsetTop - 60);
  }, [open]);
  return (
    <Field label={label} required={required} hint={hint}>
      <div className="relative" ref={ref}>
        <Icon name="Clock" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
        <input
          type="text"
          aria-label={label || 'Time'}
          disabled={disabled}
          value={text}
          onChange={(e) => { setText(e.target.value); const p = parseTimeInput(e.target.value); if (p) onChange(p); }}
          onFocus={(e) => { e.target.select(); setOpen(true); }}
          onBlur={() => setText(value ? format12h(value) : '')}
          placeholder="--:--"
          autoComplete="off"
          className={`${CONTROL} pl-9`}
        />
        {open && (
          <div ref={listRef} className="absolute top-full left-0 mt-1 w-32 max-h-48 overflow-y-auto bg-surface border border-border rounded-spa shadow-spa-elevated z-dropdown">
            {options.map((t) => (
              <button
                key={t}
                type="button"
                data-selected={t === value}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange(t); setText(format12h(t)); setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-[13px] font-body hover:bg-background ${t === value ? 'bg-background font-body-medium text-text-primary' : 'text-text-primary'}`}
              >
                {format12h(t)}
              </button>
            ))}
          </div>
        )}
      </div>
    </Field>
  );
};

const ghostBtn = 'h-9 px-3 text-[13px] font-body font-body-medium border border-border rounded-spa hover:bg-background spa-transition-fast whitespace-nowrap disabled:opacity-50';
const primaryBtn = 'h-9 px-4 text-[13px] font-body font-body-medium bg-primary text-white rounded-spa hover:bg-primary/90 spa-transition-fast disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 whitespace-nowrap';

// Form container: a docked SidePanel (variant="panel") or a centered modal (variant="modal").
//  * footer = [left: optional destructive action + disabled reason] [Cancel (ghost)] [primary]; or `footerOverride`
//    (e.g. the scope chooser); or the inline "Discard changes?" confirm.
//  * `dirty` + `guardRef`: closing (×, Esc, Cancel) or an external switch (guardRef.current(action)) asks first.
export const PanelShell = ({
  variant = 'panel', title, onClose, dirty = false, guardRef, busy = false,
  reason = '', primary, cancelLabel = 'Cancel', footerLeft, footerOverride, hideFooter = false,
  headerExtra, children,
}) => {
  const [confirm, setConfirm] = useState(null); // { action? }
  const requestClose = useCallback(() => {
    if (busy) return;
    if (dirty) setConfirm({}); else onClose?.();
  }, [busy, dirty, onClose]);
  useEffect(() => {
    if (!guardRef) return undefined;
    guardRef.current = (action) => { if (dirty) setConfirm({ action }); else action(); };
    return () => { guardRef.current = null; };
  });

  const footerNode = hideFooter ? null : confirm ? (
    <div key="confirm" role="alertdialog" aria-label="Discard changes" className="flex items-center gap-3">
      <p className="flex-1 min-w-0 text-[13px] text-text-primary">Discard your changes?</p>
      <button type="button" onClick={() => setConfirm(null)} className={ghostBtn}>Keep editing</button>
      <button
        type="button"
        onClick={() => { const c = confirm; setConfirm(null); if (c.action) c.action(); else onClose?.(); }}
        className="h-9 px-3 text-[13px] font-body font-body-medium bg-text-primary text-white rounded-spa hover:opacity-90 spa-transition-fast whitespace-nowrap"
      >
        Discard
      </button>
    </div>
  ) : footerOverride ? (
    <div key="override">{footerOverride}</div>
  ) : (
    <div key="actions" className="flex items-center gap-3">
      {footerLeft}
      <p className="flex-1 min-w-0 text-xs text-text-secondary" aria-live="polite">{primary?.disabled ? reason : ''}</p>
      <button type="button" onClick={requestClose} disabled={busy} className={ghostBtn}>{cancelLabel}</button>
      {primary && (
        <button type="button" onClick={primary.onClick} disabled={primary.disabled || primary.loading} className={primaryBtn}>
          {primary.loading && <div className="animate-spin w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" />}
          {primary.label}
        </button>
      )}
    </div>
  );

  if (variant === 'panel') {
    return (
      <SidePanel isOpen title={title} onClose={requestClose} footer={footerNode} headerExtra={headerExtra}>
        {children}
      </SidePanel>
    );
  }
  return (
    <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={requestClose}>
      <div
        className="bg-surface rounded-spa-lg shadow-spa-modal border border-border w-full max-w-md max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between gap-2 px-5 h-14 border-b border-border flex-shrink-0">
          <h3 className="font-heading font-heading-semibold text-[15px] text-text-primary truncate">{title}</h3>
          <button type="button" onClick={requestClose} aria-label="Close" className="w-8 h-8 flex items-center justify-center rounded-spa text-text-secondary hover:bg-background spa-transition-fast">
            <Icon name="X" size={18} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
        {footerNode && <div className="border-t border-border p-4 flex-shrink-0">{footerNode}</div>}
      </div>
    </div>
  );
};

// Standard padded body for a form inside the shell.
export const FormBody = ({ children, className = '' }) => <div className={`px-5 py-5 space-y-4 ${className}`}>{children}</div>;

// Hairline summary box (replaces the old purple-tinted info boxes).
export const InfoRows = ({ rows }) => (
  <dl className="border border-border rounded-spa divide-y divide-border text-[13px]">
    {rows.filter(Boolean).map(([k, v, tone]) => (
      <div key={k} className="flex items-center justify-between gap-3 px-3 py-2">
        <dt className="text-text-secondary">{k}</dt>
        <dd className={`text-right tabular-nums ${tone === 'amber' ? 'text-warning' : 'text-text-primary'} font-body-medium`}>{v}</dd>
      </div>
    ))}
  </dl>
);
