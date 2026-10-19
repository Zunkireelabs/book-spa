import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../../../../components/AppIcon';
import { FilterChip, Menu } from '../../../../components/ui/ListToolbarKit';
import { useOrg } from '../../../../contexts/OrgContext';
import {
  SEGMENTS, SORTS, DISPLAY_STATUS, segmentById, displayStatus, stripStats, needsItems, sortPackages, matchesPackageSearch, reminderText, daysUntil, ENDS_SOON_DAYS,
} from '../../../../services/packagesView';
import { buildWhatsAppUrl } from '../../../../utils/checkoutReceipt';
import NeedsYouNow from '../Bookings/NeedsYouNow';
import PackageDetailPanel from './PackageDetailPanel';
import { Avatar, StatusPill, SessionMeter, MiniButton, longDate, shortDate, relativeUntil, npr, phoneOf, phoneLabel, csvDownload } from './packageBits';

const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
const useMinWidth = (px) => {
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
const uniqueOptions = (list, idOf, labelOf) => {
  const seen = new Map();
  list.forEach((p) => { const id = idOf(p); if (id && !seen.has(id)) seen.set(id, labelOf(p)); });
  return [...seen].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
};

// Guest packages (V20): lifecycle strip → Needs you now → sticky toolbar + column headings → one row per sold package.
// Row click opens the package in the right-hand panel (it overlays; nothing underneath reflows). All list state lives in the URL.
const PackageListPanel = ({ packages, today, error, onRetry, onChanged, readOnly, isOverall, stickyTop, onSell, registerExport }) => {
  const navigate = useNavigate();
  const { orgName } = useOrg();
  const [sp, setSp] = useSearchParams();
  const isSm = useMinWidth(640);
  const isMd = useMinWidth(768);
  const isLg = useMinWidth(1024);

  // ── URL state ────────────────────────────────────────────────────────────────────────────────────
  const segParam = sp.get('seg');
  const seg = segParam === 'all' ? null : (segmentById(segParam) ? segParam : 'active'); // Active is the default selection
  const query = sp.get('q') || '';
  const sort = SORTS[sp.get('sort')] ? sp.get('sort') : 'ends';
  const openId = sp.get('open') || null;
  const filters = { type: sp.get('pt') || '', service: sp.get('sv') || '', seller: sp.get('by') || '', branch: isOverall ? (sp.get('br') || '') : '' };
  const hasDue = sp.get('due') === '1';
  const spRef = useRef(sp);
  spRef.current = sp;
  const patch = useCallback((obj, { push = false } = {}) => {
    const next = new URLSearchParams(spRef.current);
    Object.entries(obj).forEach(([k, v]) => { if (v == null || v === '') next.delete(k); else next.set(k, String(v)); });
    spRef.current = next;
    setSp(next, { replace: !push });
  }, [setSp]);

  const [searchText, setSearchText] = useState(query);
  const searchRef = useRef(null);
  useEffect(() => {
    const t = setTimeout(() => { if (searchText !== query) patch({ q: searchText }); }, 200);
    return () => clearTimeout(t);
  }, [searchText]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSearchText(query); }, [query]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !isTyping(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); searchRef.current?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // ── Derived ──────────────────────────────────────────────────────────────────────────────────────
  const all = useMemo(() => packages || [], [packages]);
  const stats = useMemo(() => stripStats(all, today), [all, today]);
  const options = useMemo(() => ({
    type: uniqueOptions(all, (p) => p.packageTypeId, (p) => p.packageTypeName),
    service: uniqueOptions(all, (p) => p.serviceName !== '—' && p.serviceName, (p) => p.serviceName),
    seller: uniqueOptions(all, (p) => p.issuedById, (p) => p.issuedByName),
    branch: uniqueOptions(all, (p) => p.branchId, (p) => p.branchName),
  }), [all]);
  const filtered = useMemo(() => {
    const segment = seg ? segmentById(seg) : null;
    const list = all.filter((p) => {
      if (segment && !segment.test(p, today)) return false;
      if (hasDue && !(p.dueAmount > 0)) return false;
      if (filters.type && p.packageTypeId !== filters.type) return false;
      if (filters.service && p.serviceName !== filters.service) return false;
      if (filters.seller && p.issuedById !== filters.seller) return false;
      if (filters.branch && p.branchId !== filters.branch) return false;
      return matchesPackageSearch(p, query);
    });
    return sortPackages(list, sort, today);
  }, [all, seg, hasDue, filters.type, filters.service, filters.seller, filters.branch, query, sort, today]);

  // ── Actions ──────────────────────────────────────────────────────────────────────────────────────
  const remindUrl = (p) => (readOnly ? null : buildWhatsAppUrl(phoneOf(p), reminderText(p, today, orgName)));
  const renew = (p) => onSell({ customer: { id: p.customerId || undefined, full_name: p.guestName, phone: phoneOf(p) }, typeId: p.packageTypeId });
  const canBook = !readOnly && !isOverall; // New booking is a single-branch page
  const book = useCallback((p) => navigate('?view=new-booking', {
    state: { prefill: { fullName: p.guestName, phone: phoneOf(p), email: p.customerEmail || '', gender: p.customerGender || '', serviceId: p.serviceId } },
  }), [navigate]);
  const rowAction = (p, status) => {
    if (readOnly) return null;
    if (status === 'endsSoon') {
      const url = remindUrl(p);
      return url ? { label: 'Remind', icon: 'MessageSquare', href: url } : null;
    }
    if (status === 'lastSession') return { label: 'Renew', primary: true, run: () => renew(p) };
    if ((status === 'active' || status === 'notStarted') && canBook && p.serviceId) return { label: 'Book session', primary: true, run: () => book(p) };
    return null;
  };

  // Needs you now: each button narrows the list (or, with exactly one package, acts on it directly).
  const needs = useMemo(() => needsItems(all, today).map((it) => {
    if (it.id === 'ending' && it.pkg) { const href = remindUrl(it.pkg); return href ? { ...it, href } : it; }
    return it;
  }), [all, today, readOnly, orgName]); // eslint-disable-line react-hooks/exhaustive-deps
  const needActive = hasDue ? 'due' : seg === 'ending' ? 'ending' : seg === 'last' ? 'last' : '';
  const onNeed = (id) => {
    if (!id) { patch({ seg: '', due: '' }, { push: true }); return; }
    const it = needs.find((n) => n.id === id);
    if (id === 'last' && it?.pkg && !readOnly) { renew(it.pkg); return; }
    if (id === 'due') patch({ due: '1', seg: 'all' }, { push: true });
    else patch({ seg: id, due: '' }, { push: true });
  };

  const exportCsv = useCallback(() => {
    csvDownload(`packages-${seg || 'all'}-${today}.csv`,
      ['Guest', 'Phone', 'Package', 'Service', 'Branch', 'Sessions', 'Left', 'Status', 'Valid until', 'Sold', 'Sold by', 'Price', 'Paid', 'Method', 'Due'],
      filtered.map((p) => [p.guestName, phoneOf(p), p.packageTypeName, p.serviceName, p.branchName, p.sessionsTotal, p.sessionsRemaining,
        displayStatusLabel(p, today), p.expiryDate, p.issuedDate, p.issuedByName, p.finalAmount ?? p.paidAmount, p.paidAmount, p.paymentMethod || '', p.dueAmount || 0]));
  }, [filtered, seg, today]);
  useEffect(() => { registerExport({ run: exportCsv, disabled: !packages || filtered.length === 0 }); }, [exportCsv, packages, filtered.length, registerExport]);
  useEffect(() => () => registerExport(null), [registerExport]);

  // ── Sticky toolbar + headings ────────────────────────────────────────────────────────────────────
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
  // Changing the segment / a filter / the sort while scrolled down → back to the top of the list.
  const listKey = `${seg}|${hasDue}|${query}|${sort}|${filters.type}|${filters.service}|${filters.seller}|${filters.branch}`;
  const firstKey = useRef(true);
  useEffect(() => {
    if (firstKey.current) { firstKey.current = false; return; }
    const el = sentinelRef.current;
    const sc = el?.closest('.content-scroll');
    if (!el || !sc || !stuck) return;
    sc.scrollTo({ top: sc.scrollTop + el.getBoundingClientRect().top - sc.getBoundingClientRect().top - stickyTop });
  }, [listKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ↑/↓ moves the open panel between rows (Esc is the panel's).
  useEffect(() => {
    if (!openId) return undefined;
    const onKey = (e) => {
      if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || isTyping(e.target)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"], .z-modal-overlay')) return;
      const i = filtered.findIndex((p) => p.id === openId);
      const nxt = i < 0 ? null : filtered[i + (e.key === 'ArrowDown' ? 1 : -1)];
      if (!nxt) return;
      e.preventDefault();
      patch({ open: nxt.id });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openId, filtered, patch]);
  useEffect(() => {
    if (openId) document.querySelector(`tr[data-package-id="${openId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [openId]);

  // ── Render ───────────────────────────────────────────────────────────────────────────────────────
  const loading = !packages && !error;
  const strip = (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 border border-border rounded-[10px] mt-4 overflow-hidden" role="group" aria-label="Package lifecycle">
      {SEGMENTS.map((s) => {
        const st = stats[s.id];
        const on = seg === s.id;
        return (
          <button key={s.id} type="button" aria-pressed={on} data-seg={s.id} onClick={() => patch({ seg: on ? 'all' : (s.id === 'active' ? '' : s.id) }, { push: true })}
            className={`text-left px-4 pt-[11px] pb-3 relative shadow-[1px_0_0_0_#E7E8E6,0_1px_0_0_#E7E8E6] ${on ? 'bg-[#F2F6F0]' : 'hover:bg-[#FAFAF9]'}`}>
            <span className={`flex items-center gap-1.5 text-[12px] font-medium ${on ? 'text-text-primary' : 'text-[#8A8A90]'}`}><i className="w-2 h-2 rounded-[2px]" style={{ background: s.color }} />{s.label}</span>
            <span className="flex items-baseline gap-2 mt-1">
              <b className="text-[20px] font-semibold tracking-[-0.4px] tabular-nums" data-seg-count>{loading ? '—' : st.count}</b>
              {!loading && st.sub && <span className="text-[12px] text-[#8A8A90] tabular-nums truncate">{st.sub}</span>}
            </span>
            <span className="block text-[11.5px] text-[#8A8A90] mt-0.5 lg:truncate min-h-[16px]">{loading ? '' : st.hint}</span>
            {on && <span className="absolute left-0 right-0 bottom-0 h-0.5 bg-primary" />}
          </button>
        );
      })}
    </div>
  );

  const chipValue = (k) => options[k].find((o) => o.id === filters[k])?.label;
  const chips = (
    <>
      <FilterChip label="Package type" value={filters.type} options={options.type} onChange={(v) => patch({ pt: v })} selectedLabel={chipValue('type')} />
      <FilterChip label="Service" value={filters.service} options={options.service} onChange={(v) => patch({ sv: v })} selectedLabel={chipValue('service')} />
      <FilterChip label="Sold by" value={filters.seller} options={options.seller} onChange={(v) => patch({ by: v })} selectedLabel={chipValue('seller')} />
      {isOverall && <FilterChip label="Branch" value={filters.branch} options={options.branch} onChange={(v) => patch({ br: v })} selectedLabel={chipValue('branch')} />}
      {hasDue && (
        <span className="h-7 rounded-full inline-flex items-center text-[12.5px] font-medium border border-border bg-[#FAFAF9] text-text-primary">
          <span className="pl-2.5 pr-2">Has due</span>
          <button type="button" onClick={() => patch({ due: '' })} aria-label="Clear Has due" className="h-full pr-2 -ml-1 text-[#8A8A90] hover:text-text-primary"><Icon name="X" size={12} /></button>
        </span>
      )}
    </>
  );
  const sortMenu = (
    <Menu trigger={(open, toggle) => (
      <button type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} className="h-7 px-2 rounded-md text-[12.5px] text-[#515152] inline-flex items-center gap-1.5 hover:bg-[#FAFAF9] whitespace-nowrap">
        Sort <b className="text-text-primary font-medium">{SORTS[sort].label}</b><Icon name="ChevronDown" size={13} />
      </button>)}>
      {(close) => Object.entries(SORTS).map(([id, s]) => (
        <button key={id} type="button" onClick={() => { patch({ sort: id === 'ends' ? '' : id }); close(); }} className={`w-full text-left px-3 py-1.5 text-[13px] hover:bg-[#FAFAF9] flex justify-between ${sort === id ? 'font-medium' : ''}`}>
          {s.label}{sort === id && <Icon name="Check" size={13} />}
        </button>))}
    </Menu>
  );
  const searchBox = (
    <div className="relative w-full sm:w-[300px]">
      <Icon name="Search" size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8A8A90]" />
      <input ref={searchRef} value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search guest, phone or package" aria-label="Search packages"
        className="w-full h-[34px] pl-8 pr-8 border border-border rounded-[7px] text-[13px] bg-white placeholder:text-[#8A8A90] focus:outline-none focus:border-[#cfd2cc] focus:shadow-[0_0_0_3px_rgba(45,90,39,.08)]" />
      <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[10.5px] font-medium text-[#8A8A90] border border-border rounded px-[5px] py-px bg-white">/</kbd>
    </div>
  );
  // Below sm only the search sticks; the chips and sort scroll with the page so the pinned block stays small.
  const toolbar = isSm
    ? <div className="flex items-center gap-2 pt-3.5 pb-2 flex-wrap">{searchBox}{chips}<div className="ml-auto">{sortMenu}</div></div>
    : <div className="pt-2.5 pb-2">{searchBox}</div>;

  const showPackage = isLg; // below desktop the package name sits under the guest's name instead
  const showValid = isMd;
  const showPaid = isLg;
  const showBranch = isLg && isOverall;
  const showActions = isLg;
  const colCount = 3 + (showPackage ? 1 : 0) + (showValid ? 1 : 0) + (showBranch ? 1 : 0) + (showPaid ? 1 : 0) + (isSm ? 1 : 0);
  const th = `h-[34px] text-[12px] font-medium whitespace-nowrap border-b border-border bg-white text-[#8A8A90] sticky z-[5] ${stuck ? 'shadow-[0_8px_8px_-8px_rgba(14,13,12,.14)]' : ''}`;
  const thTop = { top: stickyTop + blockH };

  const anyFilter = !!(query || filters.type || filters.service || filters.seller || filters.branch || hasDue);
  const clearAll = () => { setSearchText(''); patch({ q: '', pt: '', sv: '', by: '', br: '', due: '', seg: 'all' }, { push: true }); };

  let body = null;
  if (loading) {
    body = Array.from({ length: 7 }).map((_, i) => (
      <tr key={i}><td colSpan={colCount} className="h-[58px] border-b border-[#F1F1EF]"><div className="h-8 rounded bg-[#F1F1EF] animate-pulse" /></td></tr>
    ));
  } else if (!error) {
    body = filtered.map((p) => {
      const status = displayStatus(p, today);
      const dim = status === 'usedUp' || status === 'expired';
      const selected = p.id === openId;
      const action = showActions ? rowAction(p, status) : null;
      const d = daysUntil(p.expiryDate, today);
      const warn = !dim && d != null && d >= 0 && d <= ENDS_SOON_DAYS;
      const fade = dim ? 'opacity-[.55]' : '';
      const sessionsLabel = status === 'usedUp' ? `All ${p.sessionsTotal} used`
        : status === 'expired' ? `${p.sessionsRemaining} unused`
          : <>{p.sessionsRemaining} left <span className="text-[#8A8A90] font-normal">of {p.sessionsTotal}</span></>;
      const validMain = status === 'usedUp' ? `Used up ${shortDate(p.lastRedeemedDate || p.expiryDate, today)}` : status === 'expired' ? `Ended ${shortDate(p.expiryDate, today)}` : longDate(p.expiryDate);
      const validSub = status === 'usedUp' ? `valid to ${longDate(p.expiryDate)}` : status === 'expired' ? `${p.sessionsRemaining} session${p.sessionsRemaining === 1 ? '' : 's'} unused` : relativeUntil(p.expiryDate, today);
      return (
        <tr key={p.id} data-package-id={p.id} data-status={status} tabIndex={0} aria-selected={selected || undefined}
          onClick={() => patch({ open: p.id })} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) patch({ open: p.id }); }}
          style={{ scrollMarginTop: stickyTop + blockH + 40 }}
          className={`group cursor-pointer focus:outline-none ${selected ? 'bg-[#F2F6F0]' : 'hover:bg-[#FAFAF9] focus-visible:bg-[#FAFAF9]'}`}>
          <td className={`h-[58px] border-b border-[#F1F1EF] pr-3 ${selected ? 'shadow-[inset_3px_0_0_0_#2D5A27]' : ''}`}>
            <div className={`flex items-center gap-3 pl-2 ${fade}`}>
              <Avatar name={p.guestName} />
              <div className="min-w-0">
                <div className="font-medium text-[13.5px] tracking-[-0.1px] text-text-primary truncate">{p.guestName}</div>
                <div className="text-[12.5px] text-[#8A8A90] mt-0.5 truncate tabular-nums">{showPackage ? (phoneLabel(p) || '—') : p.packageTypeName}</div>
              </div>
            </div>
          </td>
          {showPackage && (
            <td className="h-[58px] border-b border-[#F1F1EF] pr-3">
              <div className={fade}>
                <div className="font-medium text-[13px] text-text-primary truncate">{p.packageTypeName}</div>
                <div className="text-[12.5px] text-[#8A8A90] mt-0.5 truncate">{p.serviceName}{p.serviceDurationMinutes ? ` · ${p.serviceDurationMinutes} min` : ''}</div>
              </div>
            </td>
          )}
          <td className="h-[58px] border-b border-[#F1F1EF] pr-3">
            <div className={`flex flex-col gap-1.5 ${fade}`}>
              <div className="text-[13px] font-medium text-text-primary tabular-nums whitespace-nowrap" data-sessions>{sessionsLabel}</div>
              <SessionMeter total={p.sessionsTotal} remaining={p.sessionsRemaining} status={status} width={isSm ? 150 : 96} />
            </div>
          </td>
          {showValid && (
            <td className="h-[58px] border-b border-[#F1F1EF] pr-3">
              <div className={fade}>
                <div className="text-[13px] font-medium text-text-primary tabular-nums whitespace-nowrap">{validMain}</div>
                {validSub && <div className={`text-[12.5px] mt-0.5 whitespace-nowrap ${warn ? 'text-[#B45309] font-medium' : 'text-[#8A8A90]'}`} data-valid-hint>{validSub}</div>}
              </div>
            </td>
          )}
          {showBranch && <td className="h-[58px] border-b border-[#F1F1EF] pr-3 text-[13px] text-[#515152] truncate"><span className={fade}>{p.branchName}</span></td>}
          {showPaid && (
            <td className="h-[58px] border-b border-[#F1F1EF] pr-3 text-right">
              <div className={fade}>
                <div className="text-[13px] font-medium text-text-primary tabular-nums whitespace-nowrap">{npr(p.paidAmount)}</div>
                {(p.dueAmount > 0 || p.paymentMethod) && (
                  <div className="text-[12.5px] mt-0.5 whitespace-nowrap" data-paid-sub>
                    {p.dueAmount > 0
                      ? <span className="inline-flex items-center gap-1.5 font-medium text-text-primary tabular-nums" data-due><i className="w-1.5 h-1.5 rounded-full bg-[#F59E0B]" />{npr(p.dueAmount)} due</span>
                      : <span className="text-[#8A8A90]">{p.paymentMethod}</span>}
                  </div>
                )}
              </div>
            </td>
          )}
          {isSm && <td className="h-[58px] border-b border-[#F1F1EF] pl-2"><span className={fade}><StatusPill status={status} /></span></td>}
          <td className="h-[58px] border-b border-[#F1F1EF] pr-1">
            <div className="flex gap-1.5 justify-end items-center text-[#8A8A90]">
              {action && (
                <span className={`${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'} transition-opacity`}>
                  {action.href ? (
                    <a href={action.href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} data-row-action={action.label}
                      className="h-[26px] px-[9px] rounded-md border border-border bg-white text-[12px] font-medium inline-flex items-center gap-[5px] text-text-primary hover:bg-[#FAFAF9]">
                      <Icon name={action.icon} size={13} />{action.label}
                    </a>
                  ) : (
                    <MiniButton primary={action.primary} data-row-action={action.label} onClick={(e) => { e.stopPropagation(); action.run(); }}>{action.label}</MiniButton>
                  )}
                </span>
              )}
              <Icon name="ChevronRight" size={15} />
            </div>
          </td>
        </tr>
      );
    });
  }

  return (
    <div>
      {strip}
      {!loading && !error && needs.length > 0 && (
        <div className="mt-3 -mb-3"><NeedsYouNow items={needs} active={needActive} onPick={onNeed} quietTail /></div>
      )}
      <div ref={sentinelRef} aria-hidden="true" className="h-px mt-0.5" />
      <div ref={blockRef} className="sticky z-sticky-filter bg-white" style={{ top: stickyTop }}>{toolbar}</div>
      {!isSm && <div className="flex items-center gap-2 pb-2 flex-wrap">{chips}<div className="ml-auto">{sortMenu}</div></div>}

      {error ? (
        <div className="border border-error/20 bg-error/5 rounded-lg p-4 mt-2 flex items-center gap-3 text-[13px] text-error">
          <Icon name="AlertCircle" size={16} />{error}
          <button type="button" onClick={onRetry} className="ml-auto underline font-medium">Retry</button>
        </div>
      ) : (
        <table className="w-full border-collapse table-fixed">
          <colgroup>
            <col style={{ width: isLg ? '22%' : undefined }} />
            {showPackage && <col style={{ width: '20%' }} />}
            <col style={{ width: isSm ? 172 : 112 }} />
            {showValid && <col style={{ width: isLg ? 132 : 120 }} />}
            {showBranch && <col style={{ width: 104 }} />}
            {showPaid && <col style={{ width: 124 }} />}
            {isSm && <col style={{ width: 124 }} />}
            <col style={{ width: showActions ? 144 : 28 }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className={`${th} text-left pl-2`} style={thTop}>Guest</th>
              {showPackage && <th scope="col" className={`${th} text-left`} style={thTop}>Package</th>}
              <th scope="col" className={`${th} text-left`} style={thTop}>Sessions</th>
              {showValid && <th scope="col" className={`${th} text-left`} style={thTop}>Valid until</th>}
              {showBranch && <th scope="col" className={`${th} text-left`} style={thTop}>Branch</th>}
              {showPaid && <th scope="col" className={`${th} text-right pr-3`} style={thTop}>Paid</th>}
              {isSm && <th scope="col" className={`${th} text-left pl-2`} style={thTop}>Status</th>}
              <th scope="col" className={th} style={thTop}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="text-center py-16">
          <Icon name="Layers" size={28} className="text-[#B4B4BA] mx-auto mb-3" />
          {all.length === 0 ? (
            <>
              <p className="text-[14px] font-medium text-text-primary">No packages sold yet</p>
              <p className="text-[13px] text-[#8A8A90] mt-1">Packages you sell to guests appear here.</p>
              {!readOnly && <button type="button" onClick={() => onSell()} className="mt-3 text-[13px] font-medium text-primary hover:underline">Sell package</button>}
            </>
          ) : (
            <>
              <p className="text-[14px] font-medium text-text-primary">No packages match</p>
              <p className="text-[13px] text-[#8A8A90] mt-1">{anyFilter ? 'Try a different search or clear a filter.' : `Nothing is in “${segmentById(seg)?.label}” right now.`}</p>
              <button type="button" onClick={clearAll} className="mt-3 text-[13px] font-medium text-primary hover:underline">Clear filters</button>
            </>
          )}
        </div>
      )}
      {!loading && !error && filtered.length > 0 && (
        <div className="flex items-center h-[52px] text-[12.5px] text-[#8A8A90] tabular-nums">{filtered.length} package{filtered.length === 1 ? '' : 's'}</div>
      )}

      {openId && (
        <PackageDetailPanel
          packageId={openId}
          today={today}
          readOnly={readOnly}
          canBook={canBook}
          onBook={book}
          onClose={() => patch({ open: '' })}
          onChanged={onChanged}
        />
      )}
    </div>
  );
};

const displayStatusLabel = (p, today) => DISPLAY_STATUS[displayStatus(p, today)].label;

export default PackageListPanel;
