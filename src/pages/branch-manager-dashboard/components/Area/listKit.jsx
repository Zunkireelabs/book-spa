import React, { useCallback, useEffect, useRef, useState } from 'react';
import ScrollRow from 'components/ui/ScrollRow';
import { viewerAccess } from 'services/dataMasking';
import { Link } from 'react-router-dom';
import { localizeBranch } from '../../../../utils/industryTerms';
import Icon from '../../../../components/AppIcon';
import { Menu } from '../../../../components/ui/ListToolbarKit';
import { useAuth } from '../../../../contexts/AuthContext';
import { useBranch } from '../../../../contexts/BranchContext';
import { getAreaForView, getVisibleTabs } from './areaTabsRegistry';
import { daysUntil } from '../../../../services/packagesView';
import { RANGES, rangeLabel } from '../../../../services/membershipsView';
import { useIndustry } from '../../../../hooks/useIndustry';

// Shared pieces of the "sales" list pages (Packages V20, Memberships V21): one header with a lead sentence and counted tabs, a
// lifecycle strip, a sticky toolbar + column headings inside the one `.content-scroll` scroller, and the small row bits.

const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

export const useMinWidth = (px) => {
  const q = `(min-width: ${px}px)`;
  const [on, setOn] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q).matches : true));
  useEffect(() => {
    const m = window.matchMedia(q);
    const f = () => setOn(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, [q]);
  return on;
};

/** "/" focuses the given input anywhere on the page. */
export const useSlashFocus = (ref) => {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !isTyping(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); ref.current?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ref]);
};
export { isTyping };

/** A short-lived toast: `notify(msg, 'error'?)`; render `toastNode` once. */
export const useToast = () => {
  const [toast, setToast] = useState(null);
  const notify = useCallback((msg, type = 'success') => setToast({ msg, type, at: Date.now() }), []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  const toastNode = toast ? (
    <div role="status" className={`fixed top-20 left-1/2 -translate-x-1/2 z-toast px-4 py-2.5 rounded-lg shadow-lg text-[13px] font-medium ${toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-text-primary text-white'}`}>
      {toast.msg}
    </div>
  ) : null;
  return { notify, toastNode };
};

/** The active tab registers { run, disabled }; only a change in whether Export can run re-renders the header. */
export const useExportSlot = () => {
  const exportRef = useRef(null);
  const [exportReady, setExportReady] = useState(false);
  const registerExport = useCallback((api) => { exportRef.current = api; setExportReady(!!api && !api.disabled); }, []);
  const runExport = useCallback(() => exportRef.current?.run(), []);
  return { registerExport, runExport, exportReady };
};

export const ExportButton = ({ onClick, disabled }) => (
  <button type="button" onClick={onClick} disabled={disabled}
    className="h-8 px-3 rounded-md border border-border bg-white text-[13px] font-medium inline-flex items-center gap-1.5 hover:bg-[#FAFAF9] disabled:opacity-50 disabled:cursor-not-allowed">
    <Icon name="Download" size={14} />Export
  </button>
);
export const PrimaryButton = ({ icon = 'Plus', children, ...props }) => (
  <button type="button" {...props} className="h-8 px-3 rounded-md bg-primary text-white text-[13px] font-medium inline-flex items-center gap-1.5 shadow-[0_1px_2px_rgba(45,90,39,.25),inset_0_1px_0_rgba(255,255,255,.15)] hover:bg-primary/95">
    <Icon name={icon} size={15} />{children}
  </button>
);

/** Lead sentence parts ([{ strong } | { text }]) → nodes. */
export const leadNodes = (parts) => parts.map((part, i) => (part.strong ? <b key={i} className="font-medium text-[#515152]">{part.strong}</b> : <React.Fragment key={i}>{part.text}</React.Fragment>));

// Header (title, lead, actions) over the area's tabs with counts. The tabs stick at the top of the one scroller; `children` gets
// the tabs' height so the active tab's toolbar and column headings can stick under them. Changing tab scrolls back to the top.
export const ListPageShell = ({ view, title, lead, actions, counts = {}, children }) => {
  const { profile } = useAuth();
  const { isOverall } = useBranch();
  const { productLabel } = useIndustry();
  const rootRef = useRef(null);
  const tabsRef = useRef(null);
  const [tabsH, setTabsH] = useState(53);
  useEffect(() => {
    const el = tabsRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setTabsH(Math.ceil(el.getBoundingClientRect().height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const firstView = useRef(true);
  useEffect(() => {
    if (firstView.current) { firstView.current = false; return; }
    const sc = rootRef.current?.closest('.content-scroll');
    if (sc) sc.scrollTop = 0;
  }, [view]);
  const area = getAreaForView(view);
  const tabs = area ? getVisibleTabs(area, { role: profile?.role, isOverall, productLabel, hidePrices: !viewerAccess(profile).canViewPrices }) : [];
  return (
    <div ref={rootRef} className="pb-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold tracking-[-0.45px] text-text-primary">{title}</h1>
          <p className="text-[13px] text-[#8A8A90] mt-[3px] tabular-nums" data-lead>{lead}</p>
        </div>
        <ScrollRow className="flex-wrap md:flex-wrap max-md:flex-nowrap" wrapperClassName="max-md:w-full">{actions}</ScrollRow>
      </div>
      <div ref={tabsRef} className="sticky top-0 z-sticky-filter bg-white pt-[14px]">
        <div role="tablist" aria-label={title} className="flex items-center gap-[22px] border-b border-border overflow-x-auto overflow-y-hidden">
          {tabs.map((t) => {
            const on = t.view === view;
            return (
              <Link key={t.view} role="tab" aria-selected={on} to={{ search: `?view=${t.view}` }}
                className={`h-[38px] max-md:h-11 flex items-center gap-[7px] text-[13px] font-medium relative whitespace-nowrap flex-shrink-0 ${on ? 'text-text-primary' : 'text-[#515152] hover:text-text-primary'}`}>
                {t.label}{counts[t.view] != null && <span className="text-[#8A8A90] tabular-nums" data-count={t.view}>{counts[t.view]}</span>}
                {on && <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-text-primary rounded" />}
              </Link>
            );
          })}
        </div>
      </div>
      {children(tabsH)}
    </div>
  );
};

// Lifecycle strip (Customers pattern): one button per segment with a count, a sub-line and a hint. `onPick(id, on)`.
export const LifecycleStrip = ({ segments, stats, selected, onPick, loading, ariaLabel }) => (
  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 border border-border rounded-[10px] mt-4 overflow-hidden" role="group" aria-label={ariaLabel}>
    {segments.map((s) => {
      const st = stats[s.id] || {};
      const on = selected === s.id;
      const hint = st.hint !== undefined ? st.hint : s.hint;
      return (
        <button key={s.id} type="button" aria-pressed={on} data-seg={s.id} onClick={() => onPick(s.id, on)}
          className={`text-left px-4 pt-[11px] pb-3 relative shadow-[1px_0_0_0_#E7E8E6,0_1px_0_0_#E7E8E6] ${on ? 'bg-[#F2F6F0]' : 'hover:bg-[#FAFAF9]'}`}>
          <span className={`flex items-center gap-1.5 text-[12px] font-medium ${on ? 'text-text-primary' : 'text-[#8A8A90]'}`}><i className="w-2 h-2 rounded-[2px]" style={{ background: s.color }} />{s.label}</span>
          <span className="flex items-baseline gap-2 mt-1">
            <b className="text-[20px] font-semibold tracking-[-0.4px] tabular-nums" data-seg-count>{loading ? '—' : st.count}</b>
            {!loading && st.sub && <span className="text-[12px] text-[#8A8A90] tabular-nums truncate">{st.sub}</span>}
          </span>
          <span className="block text-[11.5px] text-[#8A8A90] mt-0.5 lg:truncate min-h-[16px]">{loading ? '' : hint}</span>
          {on && <span className="absolute left-0 right-0 bottom-0 h-0.5 bg-primary" />}
        </button>
      );
    })}
  </div>
);

export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

// Date range button for the activity tabs (Wallet activity V21, Vouchers activity V23): presets plus a custom from/to.
export const RangeMenu = ({ id, from, to, today, onPick }) => {
  const [cf, setCf] = useState(from);
  const [ct, setCt] = useState(to);
  useEffect(() => { setCf(from); setCt(to); }, [from, to]);
  return (
    <Menu title="Date range" trigger={(open, toggle) => (
      <button type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} data-range
        className="h-[34px] px-3 rounded-[7px] border border-border bg-white text-[13px] font-medium inline-flex items-center gap-2 hover:bg-[#FAFAF9] whitespace-nowrap">
        <Icon name="Calendar" size={14} className="text-[#8A8A90]" />{rangeLabel(id, from, to)}<Icon name="ChevronDown" size={13} className="text-[#8A8A90]" />
      </button>)}>
      {(close) => (
        <div className="min-w-[230px]">
          {RANGES.map((r) => (
            <button key={r.id} type="button" onClick={() => { onPick(r.id); close(); }} className={`w-full text-left px-3 py-1.5 text-[13px] hover:bg-[#FAFAF9] flex justify-between ${id === r.id ? 'font-medium' : ''}`}>
              {r.label}{id === r.id && <Icon name="Check" size={13} />}
            </button>
          ))}
          <div className="border-t border-border mt-1 pt-2 px-3 pb-2.5 space-y-2">
            <p className="text-[11.5px] font-medium text-[#8A8A90] uppercase tracking-[.05em]">Custom</p>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" aria-label="From" value={cf} max={today} onChange={(e) => setCf(e.target.value)} className="h-8 px-2 border border-border rounded-md text-[12.5px]" />
              <input type="date" aria-label="To" value={ct} max={today} onChange={(e) => setCt(e.target.value)} className="h-8 px-2 border border-border rounded-md text-[12.5px]" />
            </div>
            <button type="button" disabled={!isDate(cf) || !isDate(ct) || cf > ct} onClick={() => { onPick('custom', cf, ct); close(); }}
              className="w-full h-8 rounded-md bg-primary text-white text-[12.5px] font-medium disabled:opacity-50">Apply</button>
          </div>
        </div>
      )}
    </Menu>
  );
};

export const SearchBox = React.forwardRef(({ value, onChange, placeholder, ariaLabel, className = 'w-full sm:w-[300px]' }, ref) => (
  <div className={`relative ${className}`}>
    <Icon name="Search" size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8A8A90]" />
    <input ref={ref} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={ariaLabel}
      className="w-full h-[34px] pl-8 pr-8 border border-border rounded-[7px] text-[13px] bg-white placeholder:text-[#8A8A90] focus:outline-none focus:border-[#cfd2cc] focus:shadow-[0_0_0_3px_rgba(45,90,39,.08)]" />
    <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[10.5px] font-medium text-[#8A8A90] border border-border rounded px-[5px] py-px bg-white">/</kbd>
  </div>
));

SearchBox.displayName = 'SearchBox';

/** "Sort <b>Label</b> ▾" menu over `{ id: { label } }`. */
export const SortMenu = ({ sorts, value, onChange, label = 'Sort' }) => (
  <Menu title="Sort by" trigger={(open, toggle) => (
    <button type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} className="h-7 px-2 rounded-md text-[12.5px] text-[#515152] inline-flex items-center gap-1.5 hover:bg-[#FAFAF9] whitespace-nowrap">
      {label} <b className="text-text-primary font-medium">{localizeBranch(sorts[value].label)}</b><Icon name="ChevronDown" size={13} />
    </button>)}>
    {(close) => Object.entries(sorts).map(([id, s]) => (
      <button key={id} type="button" onClick={() => { onChange(id); close(); }} className={`w-full text-left px-3 py-1.5 text-[13px] hover:bg-[#FAFAF9] flex justify-between ${value === id ? 'font-medium' : ''}`}>
        {localizeBranch(s.label)}{value === id && <Icon name="Check" size={13} />}
      </button>))}
  </Menu>
);

/** A set filter that can only be removed ("Has due", a member from "See all"). */
export const ClearableChip = ({ label, onClear }) => (
  <span className="h-7 rounded-full inline-flex items-center text-[12.5px] font-medium border border-border bg-[#FAFAF9] text-text-primary">
    <span className="pl-2.5 pr-2">{label}</span>
    <button type="button" onClick={onClear} aria-label={`Clear ${label}`} className="h-full pr-2 -ml-1 text-[#8A8A90] hover:text-text-primary"><Icon name="X" size={12} /></button>
  </span>
);

// Sticky toolbar block under the tabs: its measured height (the column headings stick under it), and whether it is stuck
// (a sentinel + IntersectionObserver, no scroll listeners).
export const useStickyBlock = (stickyTop) => {
  const blockRef = useRef(null);
  const sentinelRef = useRef(null);
  const [blockH, setBlockH] = useState(58);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = blockRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setBlockH(Math.ceil(el.getBoundingClientRect().height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const root = el.closest('.content-scroll');
    const io = new IntersectionObserver(([entry]) => {
      const rootTop = entry.rootBounds ? entry.rootBounds.top : 0;
      setStuck(!entry.isIntersecting && entry.boundingClientRect.top < rootTop + stickyTop + 1);
    }, { root, rootMargin: `-${stickyTop}px 0px 0px 0px`, threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [stickyTop]);
  /** Scroll so the list's natural top sits just under the tabs (only when the toolbar is stuck). */
  const scrollToListTop = useCallback(() => {
    const el = sentinelRef.current;
    const sc = el?.closest('.content-scroll');
    if (!el || !sc) return;
    sc.scrollTo({ top: sc.scrollTop + el.getBoundingClientRect().top - sc.getBoundingClientRect().top - stickyTop });
  }, [stickyTop]);
  return { blockRef, sentinelRef, blockH, stuck, scrollToListTop };
};
export const thClass = (stuck) => `h-[34px] text-[12px] font-medium whitespace-nowrap border-b border-border bg-white text-[#8A8A90] sticky z-[5] ${stuck ? 'shadow-[0_8px_8px_-8px_rgba(14,13,12,.14)]' : ''}`;

// ── Row bits ─────────────────────────────────────────────────────────────────────────────────────
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ymd = (iso) => String(iso).slice(0, 10).split('-').map(Number);
/** "3 Nov 2026" */
export const longDate = (iso) => { if (!iso) return '—'; const [y, m, d] = ymd(iso); return `${d} ${MON[m - 1]} ${y}`; };
/** "2 Oct" this year, "2 Oct 2025" otherwise. */
export const shortDate = (iso, today) => { if (!iso) return '—'; const [y, m, d] = ymd(iso); return `${d} ${MON[m - 1]}${String(y) !== String(today).slice(0, 4) ? ` ${y}` : ''}`; };
export const tileDate = (iso) => { const [, m, d] = ymd(iso); return { day: d, mon: MON[m - 1] }; };
/** "in 15 days" / "in 6 months" / "today" (future), or null when past / no date. */
export function relativeUntil(iso, today) {
  const d = daysUntil(iso, today);
  if (d == null || d < 0) return null;
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d < 90) return `in ${d} days`;
  return `in ${Math.round(d / 30.44)} months`;
}
/** "15 days left" / "6 months left" / "Ends today". */
export function timeLeft(iso, today) {
  const d = daysUntil(iso, today);
  if (d == null || d < 0) return null;
  if (d === 0) return 'Ends today';
  if (d === 1) return '1 day left';
  if (d < 90) return `${d} days left`;
  return `${Math.round(d / 30.44)} months left`;
}

export const npr = (n) => `NPR ${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
export const initialsOf = (name) => {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return ((w[0][0] || '') + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
};

export const Avatar = ({ name, size = 32 }) => (
  <div className="rounded-full bg-[#F1F1EF] text-[#4A4A4F] font-semibold grid place-items-center flex-shrink-0" style={{ width: size, height: size, fontSize: size >= 40 ? 15 : 11.5 }}>
    {initialsOf(name)}
  </div>
);

/** Status pill from a `{ [status]: { label, dot, pill } }` config. */
export const StatusPill = ({ status, config }) => {
  const s = config[status] || Object.values(config)[0];
  return (
    <span className={`h-[22px] rounded-full pl-[7px] pr-2 text-[11.5px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap ${s.pill}`}>
      <i className="w-1.5 h-1.5 rounded-full" style={{ background: s.dot }} />{s.label}
    </span>
  );
};

// The small bordered row button ("Remind", "Renew", "Book session", "Sell", "Top up").
export const MiniButton = ({ children, primary = false, icon = null, ...props }) => (
  <button type="button" {...props}
    className={`h-[26px] px-[9px] rounded-md border bg-white text-[12px] font-medium inline-flex items-center gap-[5px] whitespace-nowrap hover:bg-[#FAFAF9] ${primary ? 'text-primary border-[#CFDCCC]' : 'text-text-primary border-border'}`}>
    {icon}{children}
  </button>
);
/** Same look as MiniButton, as an external link (wa.me). */
export const MiniLink = ({ href, icon, children, ...props }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} {...props}
    className="h-[26px] px-[9px] rounded-md border border-border bg-white text-[12px] font-medium inline-flex items-center gap-[5px] text-text-primary hover:bg-[#FAFAF9] whitespace-nowrap">
    {icon && <Icon name={icon} size={13} />}{children}
  </a>
);

/** Small on/off switch for a table row (the panel kit's SwitchRow is a full-width settings row). */
export const RowSwitch = ({ checked, onChange, label, busy }) => (
  <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={busy}
    onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
    className={`relative inline-flex w-[30px] h-[18px] rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-60 ${checked ? 'bg-primary' : 'bg-[#D6D3D1]'}`}>
    <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-all ${checked ? 'left-[14px]' : 'left-[2px]'}`} />
  </button>
);

export const csvDownload = (name, head, rows) => {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const blob = new Blob([[head.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

/** Empty / no-match block under a list. */
export const EmptyBlock = ({ icon = 'Layers', title, hint, action }) => (
  <div className="text-center py-16">
    <Icon name={icon} size={28} className="text-[#B4B4BA] mx-auto mb-3" />
    <p className="text-[14px] font-medium text-text-primary">{title}</p>
    {hint && <p className="text-[13px] text-[#8A8A90] mt-1">{hint}</p>}
    {action && <button type="button" onClick={action.run} className="mt-3 text-[13px] font-medium text-primary hover:underline">{action.label}</button>}
  </div>
);
export const ErrorBlock = ({ error, onRetry }) => (
  <div className="border border-error/20 bg-error/5 rounded-lg p-4 mt-2 flex items-center gap-3 text-[13px] text-error">
    <Icon name="AlertCircle" size={16} />{error}
    <button type="button" onClick={onRetry} className="ml-auto underline font-medium">Retry</button>
  </div>
);
