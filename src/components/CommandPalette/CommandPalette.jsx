import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBodyScrollLock } from '../ui/BottomSheet';
import { useParams } from 'react-router-dom';
import { useGuardedNavigate } from '../../contexts/DirtyGuardContext';
import Icon from 'components/AppIcon';
import { useAuth } from 'contexts/AuthContext';
import { useBranch } from 'contexts/BranchContext';
import { useIndustry } from 'hooks/useIndustry';
import { matchLocal, buildPages, searchCustomerRows, searchBookingRows } from './sources';
import { requestGoToday } from 'pages/branch-manager-dashboard/components/calendar/calendarSignals';

const RECENT_MAX = 6;
const DEBOUNCE_MS = 200;
const recentKey = (userId) => `zennly.cmdk.recent.${userId || 'anon'}`;
const readRecent = (userId) => { try { return JSON.parse(localStorage.getItem(recentKey(userId))) || []; } catch { return []; } };

const GROUP_LABEL = { recent: 'Recent', page: 'Pages', action: 'Actions', customer: 'Customers', booking: 'Bookings' };

// ⌘K search: find pages, customers and bookings, or run a couple of simple actions.
const CommandPalette = ({ onClose }) => {
  useBodyScrollLock(true);
  const navigate = useGuardedNavigate();
  const { orgSlug: urlOrgSlug } = useParams();
  const { profile } = useAuth();
  const { branchId, isOverall } = useBranch();
  const { staffLabel, staffLabelPlural, productLabel, enableRooms, locationLabelPlural } = useIndustry();

  const role = profile?.role;
  const userId = profile?.id;
  const orgSlug = urlOrgSlug || profile?.organizations?.slug;
  const basePath = orgSlug ? `/${orgSlug}/dashboard` : '/dashboard';
  const ctx = useMemo(
    () => ({ hidePrices: profile?.role === 'staff' && profile?.can_view_prices === false, role, isOverall, staffLabel, staffLabelPlural, productLabel, enableRooms, locationLabelPlural, basePath, branchId, orgSlug }),
    [profile?.role, profile?.can_view_prices, role, isOverall, staffLabel, staffLabelPlural, productLabel, enableRooms, locationLabelPlural, basePath, branchId, orgSlug]
  );

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const [customers, setCustomers] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState({ customers: false, bookings: false });
  const [recent] = useState(() => readRecent(userId));
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const reqId = useRef(0);
  const opener = useRef(typeof document !== 'undefined' ? document.activeElement : null);

  // Focus, scroll lock, restore focus on close
  useEffect(() => {
    inputRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const opened = opener.current;
    return () => { document.body.style.overflow = prev; opened?.focus?.(); };
  }, []);

  // Debounce the remote lookups
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  // Remote groups: fail-open, stale-safe (a response older than the latest query is dropped), previous results stay until new arrive.
  useEffect(() => {
    if (debounced.length < 2) { reqId.current += 1; setCustomers([]); setBookings([]); setLoading({ customers: false, bookings: false }); return; }
    const id = ++reqId.current;
    setLoading({ customers: true, bookings: true });
    searchCustomerRows(debounced, ctx)
      .then((rows) => { if (id === reqId.current) setCustomers(rows); })
      .catch((e) => { console.warn('[cmdk] customer search failed:', e?.message); if (id === reqId.current) setCustomers([]); })
      .finally(() => { if (id === reqId.current) setLoading((l) => ({ ...l, customers: false })); });
    searchBookingRows(debounced, ctx)
      .then((rows) => { if (id === reqId.current) setBookings(rows); })
      .catch((e) => { console.warn('[cmdk] booking search failed:', e?.message); if (id === reqId.current) setBookings([]); })
      .finally(() => { if (id === reqId.current) setLoading((l) => ({ ...l, bookings: false })); });
  }, [debounced, ctx]);

  // Groups, in order: (empty query) Recent + Pages | Pages, Actions, Customers, Bookings
  const groups = useMemo(() => {
    const q = query.trim();
    const out = [];
    if (!q) {
      if (recent.length) out.push({ id: 'recent', items: recent });
      out.push({ id: 'page', items: buildPages(ctx).filter((p) => !p.label.includes(' · ')).slice(0, 8) });
      return out;
    }
    const { pages, actions } = matchLocal(q, ctx);
    if (pages.length) out.push({ id: 'page', items: pages.slice(0, 7) });
    if (actions.length) out.push({ id: 'action', items: actions });
    const showRemote = debounced.length >= 2;
    if (showRemote && (customers.length || loading.customers) && ['manager', 'admin', 'admin_viewer'].includes(role) && !isOverall) out.push({ id: 'customer', items: customers, loading: loading.customers });
    if (showRemote && (bookings.length || loading.bookings) && !isOverall) out.push({ id: 'booking', items: bookings, loading: loading.bookings });
    return out;
  }, [query, debounced, recent, ctx, customers, bookings, loading, role, isOverall]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => { if (active >= flat.length) setActive(Math.max(0, flat.length - 1)); }, [flat.length, active]);
  useEffect(() => { listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const choose = useCallback((item) => {
    if (!item) return;
    // remember it (without the transient fields) as the newest recent entry
    try {
      const entry = { key: item.key, kind: item.kind, label: item.label, secondary: item.secondary, icon: item.icon, href: item.href };
      const next = [entry, ...readRecent(userId).filter((r) => r.key !== item.key)].slice(0, RECENT_MAX);
      localStorage.setItem(recentKey(userId), JSON.stringify(next));
    } catch { /* storage unavailable */ }
    onClose();
    navigate(item.href);
    // "Go to today": the calendar owns its date, so signal it explicitly (handled on mount too, if we are navigating to it)
    if (item.key === 'action:today') requestGoToday();
  }, [navigate, onClose, userId]);

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (flat.length ? (a + 1) % flat.length : 0)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (flat.length ? (a - 1 + flat.length) % flat.length : 0)); return; }
    if (e.key === 'Enter') { e.preventDefault(); choose(flat[active]); }
  };

  let idx = -1;
  return createPortal(
    <div className="fixed inset-0 z-modal" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" onMouseDown={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="relative mx-auto mt-[15dvh] [--panel-top:15dvh] [--panel-gap:15dvh] max-sm:[--panel-top:0.75rem] max-sm:[--panel-gap:0.75rem] panel-fit w-[640px] max-w-[calc(100vw-24px)] flex flex-col bg-surface rounded-spa-lg shadow-spa-elevated border border-border overflow-hidden max-sm:mt-3"
      >
        <div className="flex items-center gap-3 px-4 h-12 border-b border-border flex-shrink-0">
          <Icon name="Search" size={16} className="text-text-tertiary flex-shrink-0" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-activedescendant={flat[active] ? `cmdk-opt-${active}` : undefined}
            aria-autocomplete="list"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages, customers, bookings…"
            className="flex-1 min-w-0 bg-transparent border-0 p-0 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-0 focus:border-0"
          />
          <kbd className="hidden sm:inline text-[11px] text-text-tertiary border border-border rounded px-1.5 py-0.5">esc</kbd>
        </div>

        <div ref={listRef} id="cmdk-list" role="listbox" className="flex-1 min-h-0 overflow-y-auto overscroll-contain sidebar-scroll py-2">
          {flat.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-text-secondary">No results for “{query.trim()}”.</p>
          )}
          {groups.map((g) => (
            <div key={g.id} role="group" aria-label={GROUP_LABEL[g.id]} className="mb-1">
              <div className="px-4 pt-2 pb-1 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
                <span>{GROUP_LABEL[g.id]}</span>
                {g.loading && <span className="w-3 h-3 rounded-full border-2 border-text-tertiary/40 border-t-text-tertiary animate-spin" aria-label="Loading" />}
              </div>
              {g.items.map((item) => {
                idx += 1;
                const i = idx;
                const on = i === active;
                return (
                  <div
                    key={`${g.id}-${item.key}`}
                    id={`cmdk-opt-${i}`}
                    data-idx={i}
                    role="option"
                    aria-selected={on}
                    onMouseMove={() => { if (!on) setActive(i); }}
                    onClick={() => choose(item)}
                    className={`mx-2 px-2.5 h-9 rounded-spa flex items-center gap-3 cursor-pointer ${on ? 'bg-black/[0.05]' : ''}`}
                  >
                    <Icon name={item.icon || 'ArrowRight'} size={16} className={`flex-shrink-0 text-text-tertiary`} />
                    <span className="flex-1 min-w-0 truncate text-sm text-text-primary">{item.label}</span>
                    {item.secondary && <span className="max-w-[55%] truncate text-xs text-text-tertiary">{item.secondary}</span>}
                    {on && <Icon name="CornerDownLeft" size={13} className="text-text-tertiary flex-shrink-0" />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-4 px-4 h-9 border-t border-border text-[11px] text-text-tertiary flex-shrink-0">
          <span>↑↓ Select</span><span>↵ Open</span><span>esc Close</span>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default CommandPalette;
