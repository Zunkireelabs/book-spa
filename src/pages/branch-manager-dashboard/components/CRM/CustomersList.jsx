import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useParams, useSearchParams, useLocation } from 'react-router-dom';
import Icon from '../../../../components/AppIcon';
import { getCustomerDirectory, fetchDuplicateCandidates } from '../../../../services/api';
import { useAuth } from '../../../../contexts/AuthContext';
import {
  TABS, SORTS, LIFECYCLE, tabCounts, lifecycleCounts, matchesSearch, sortCustomers, relativeDayLabel, monthsSince, initials, daysBetween,
} from '../../../../utils/customerDirectory';
import { formatPhoneGrouped } from '../../../../utils/phone';
import { friendlyError } from '../../../../utils/friendlyError';
import CustomerPanel from './CustomerPanel';
import CustomersSpotlight from './CustomersSpotlight';
import { useBranch } from '../../../../contexts/BranchContext';
import { StarIcon, InSpaTag } from './customerBits';

const PAGE_SIZE = 25;
const LAST_VISIT_OPTIONS = [
  { id: '30', label: 'In the last 30 days', test: (d) => d != null && d <= 30 },
  { id: '90', label: 'In the last 3 months', test: (d) => d != null && d <= 90 },
  { id: '180', label: 'In the last 6 months', test: (d) => d != null && d <= 180 },
  { id: 'old', label: 'More than 6 months ago', test: (d) => d != null && d > 180 },
  { id: 'never', label: 'No visits yet', test: (d) => d == null },
];
const TAB_DEFS = [
  { id: 'all', label: 'All' },
  { id: 'in-spa', label: 'In spa now', dot: true },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'owes', label: 'Owes money' },
  { id: 'members', label: 'Members' },
  { id: 'vip', label: 'VIP', star: true },
];
const EMPTY_TAB = {
  all: ['No customers yet', 'Customers are added automatically when bookings are made.'],
  'in-spa': ['Nobody is in the spa right now', 'Customers with a service in progress appear here.'],
  upcoming: ['No upcoming bookings', 'Customers with a future booking appear here.'],
  owes: ['Nobody owes anything', 'Customers with an unpaid visit appear here.'],
  members: ['No members yet', 'Customers with an active membership appear here.'],
  vip: ['No VIP customers yet', 'Customers with 8+ visits and NPR 25,000 paid appear here.'],
};
const EMPTY_SEGMENT = Object.fromEntries(LIFECYCLE.map((s) => [s.id, [`No ${s.label.toLowerCase()} customers`, s.hint]]));

const npr = (n) => `NPR ${Number(n || 0).toLocaleString('en-IN')}`;
const csvEscape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

const useDismiss = (open, setOpen, ref) => {
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
const FilterChip = ({ label, value, options, onChange, selectedLabel }) => {
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

const Menu = ({ trigger, children }) => {
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

const WIDTHS = { name: 'w-[32%]', next: 'w-[24%] hidden sm:table-cell', last: 'w-[20%] hidden md:table-cell', visits: 'w-[72px] hidden md:table-cell', spent: 'w-[116px] hidden lg:table-cell', balance: 'w-[128px] hidden sm:table-cell' };
const SortHeader = ({ id, label, sort, dir, onSort, right }) => (
  <th scope="col" aria-sort={sort === id ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    className={`h-[34px] text-[12px] ${WIDTHS[id] || ''} ${id === 'visits' || id === 'spent' ? 'pr-4' : 'pr-3'} font-medium whitespace-nowrap border-b border-border bg-white sticky top-0 z-10 ${right ? 'text-right' : 'text-left'} ${sort === id ? 'text-text-primary' : 'text-[#8A8A90]'}`}>
    <button type="button" onClick={() => onSort(id)} className={`inline-flex items-center gap-1 hover:text-text-primary ${right ? 'flex-row-reverse' : ''}`}>
      {label}{sort === id && <Icon name={dir === 'asc' ? 'ArrowUp' : 'ArrowDown'} size={12} />}
    </button>
  </th>
);

// `readOnly`: the Overall (all branches) view, or admin_viewer: no booking or export actions.
const CustomersList = ({ branchId, readOnly: overallReadOnly = false, onShowDuplicates }) => {
  const { profile } = useAuth();
  const { branchName } = useBranch();
  const { orgSlug } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const role = profile?.role;
  const readOnly = overallReadOnly || role === 'admin_viewer';
  const isMgrUp = role === 'admin' || role === 'manager' || role === 'admin_viewer';
  const canExport = !overallReadOnly && (role === 'admin' || role === 'manager');

  const tabParam = searchParams.get('tab');
  const tab = TABS[tabParam] ? tabParam : 'all';
  const segParam = searchParams.get('segment');
  const segment = LIFECYCLE.some((s) => s.id === segParam) ? segParam : null;
  const query = searchParams.get('q') || '';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  const openId = searchParams.get('open') || null;
  const noMember = searchParams.get('member') === 'no';
  const sort = SORTS[searchParams.get('sort')] ? searchParams.get('sort') : 'next';
  const dir = searchParams.get('dir') === 'asc' || searchParams.get('dir') === 'desc' ? searchParams.get('dir') : SORTS[sort].dir;

  // Merge into the URL without adding history entries for typing/paging; changing tab/segment is a real navigation.
  const paramsRef = useRef(searchParams);
  paramsRef.current = searchParams;
  const patchParams = useCallback((patch, { push = false } = {}) => {
    const next = new URLSearchParams(paramsRef.current);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === '' || (k === 'tab' && v === 'all') || (k === 'page' && Number(v) === 1)) next.delete(k); else next.set(k, String(v));
    }
    paramsRef.current = next;
    setSearchParams(next, { replace: !push });
  }, [setSearchParams]);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ therapist: '', service: '', last: '' });
  const [columns, setColumns] = useState({ visits: true, spent: true, balance: true });
  const [dupCount, setDupCount] = useState(null);
  const [searchText, setSearchText] = useState(query);
  const searchRef = useRef(null);
  const hasLoadedRef = useRef(false);

  const load = useCallback(async () => {
    if (!branchId) return;
    if (!hasLoadedRef.current) setLoading(true);
    setError(null);
    const result = await getCustomerDirectory({ branchId });
    if (result.error) setError(friendlyError(result.error, 'Failed to load customers.'));
    else setData(result.data);
    hasLoadedRef.current = true;
    setLoading(false);
  }, [branchId]);
  useEffect(() => { load(); }, [load]);

  // Possible-duplicates count (managers see only pairs touching their branch, same as the duplicates panel).
  useEffect(() => {
    if (!profile?.org_id || !isMgrUp) return undefined;
    let off = false;
    fetchDuplicateCandidates(profile.org_id).then(({ data: rows }) => {
      if (off || !rows) return;
      setDupCount(role === 'admin' || role === 'admin_viewer' ? rows.length : rows.filter((c) => c.branch_id_a === profile.branch_id || c.branch_id_b === profile.branch_id).length);
    });
    return () => { off = true; };
  }, [profile?.org_id, profile?.branch_id, role, isMgrUp]);

  // Debounced search → URL; "/" focuses the search anywhere on the page.
  useEffect(() => {
    const t = setTimeout(() => { if (searchText !== query) patchParams({ q: searchText, page: 1 }); }, 200);
    return () => clearTimeout(t);
  }, [searchText]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSearchText(query); }, [query]);
  useEffect(() => { searchRef.current?.focus({ preventScroll: true }); }, [loading]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !isTyping(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); searchRef.current?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const customers = data?.customers;
  const today = data?.today;
  const counts = useMemo(() => (customers ? tabCounts(customers) : null), [customers]);
  const mix = useMemo(() => (customers ? lifecycleCounts(customers) : null), [customers]);
  const therapistOptions = useMemo(() => (data?.therapists || []).map((t) => ({ id: t.id, label: t.name })), [data]);
  const serviceOptions = useMemo(() => {
    const all = new Set();
    (customers || []).forEach((c) => c.services.forEach((s) => all.add(s)));
    return [...all].sort().map((s) => ({ id: s, label: s }));
  }, [customers]);

  const filtered = useMemo(() => {
    if (!customers) return [];
    const lastOpt = LAST_VISIT_OPTIONS.find((o) => o.id === filters.last);
    const list = customers.filter((c) => {
      if (!TABS[tab](c)) return false;
      if (segment && c.segment !== segment) return false;
      if (noMember && c.member) return false;
      if (!matchesSearch(c, query)) return false;
      if (filters.therapist && !c.therapistIds.includes(filters.therapist)) return false;
      if (filters.service && !c.services.includes(filters.service)) return false;
      if (lastOpt && !lastOpt.test(c.lastVisit ? daysBetween(c.lastVisit.date, today) : null)) return false;
      return true;
    });
    return sortCustomers(list, sort, dir);
  }, [customers, tab, segment, noMember, query, filters, sort, dir, today]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const rows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const setFilter = (k) => (v) => { setFilters((f) => ({ ...f, [k]: v })); patchParams({ page: 1 }); };
  const onSort = (id) => {
    if (id === sort) patchParams({ sort: id, dir: dir === 'asc' ? 'desc' : 'asc' });
    else patchParams({ sort: id, dir: SORTS[id].dir });
  };

  // ↑/↓ moves between customers while the panel is open (Esc is handled by the panel).
  useEffect(() => {
    if (!openId) return undefined;
    const onKey = (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      if (isTyping(e.target)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"], .z-modal-overlay')) return; // a modal (e.g. payment) is on top
      const i = filtered.findIndex((c) => c.id === openId);
      if (i < 0) return;
      const nxt = filtered[i + (e.key === 'ArrowDown' ? 1 : -1)];
      if (!nxt) return;
      e.preventDefault();
      patchParams({ open: nxt.id, page: Math.floor(filtered.indexOf(nxt) / PAGE_SIZE) + 1 });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openId, filtered, patchParams]);

  // ── Navigation ────────────────────────────────────────────────────────────────
  const listUrl = `${location.pathname}${location.search}`;
  const openProfile = (c) => navigate(`/${orgSlug}/customers/${c.id}`, { state: { from: listUrl } });
  const customerOpen = useMemo(() => (openId && customers ? customers.find((c) => c.id === openId) || null : null), [openId, customers]);
  const bookFor = (c) => navigate('?view=new-booking', { state: { prefill: { fullName: c.fullName, phone: c.phone, email: c.email, gender: c.gender } } });

  const exportCsv = () => {
    const header = ['Name', 'Phone', 'Email', 'Segment', 'Next booking', 'Last visit', 'Visits', 'Spent', 'Balance'];
    const lines = [header.join(',')];
    filtered.forEach((c) => lines.push([
      c.fullName, c.phone, c.email, c.segment,
      c.nextBooking ? `${c.nextBooking.date} ${c.nextBooking.time}` : '', c.lastVisit?.date || '', c.completedVisits, c.spent, c.balance,
    ].map(csvEscape).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `customers-${segment || tab}-${today}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  // ── Render ─────────────────────────────────────────────────────────────────────
  const total = counts?.all;
  const anyFilter = query || Object.values(filters).some(Boolean) || segment || noMember;
  const showSpent = columns.spent && isMgrUp;
  const colCount = 3 + (columns.visits ? 1 : 0) + (showSpent ? 1 : 0) + (columns.balance ? 1 : 0) + 1;

  const header = (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <h1 className="text-[22px] font-semibold tracking-[-0.45px] flex items-baseline gap-2.5 text-text-primary">
        Customers{total != null && <span className="text-[15px] text-[#8A8A90] font-medium tracking-normal tabular-nums">{total}</span>}
      </h1>
      <div className="flex gap-2">
        {canExport && (
          <button type="button" onClick={exportCsv} disabled={!filtered.length} className="h-8 px-3 rounded-md border border-border bg-white text-[13px] font-medium inline-flex items-center gap-1.5 hover:bg-[#FAFAF9] disabled:opacity-50">
            <Icon name="Download" size={14} />Export
          </button>
        )}
        {!readOnly && (
          <button type="button" onClick={() => navigate('?view=new-booking')} className="h-8 px-3 rounded-md bg-primary text-white text-[13px] font-medium inline-flex items-center gap-1.5 shadow-[0_1px_2px_rgba(45,90,39,.25),inset_0_1px_0_rgba(255,255,255,.15)] hover:bg-primary/95">
            <Icon name="Plus" size={15} />New booking
          </button>
        )}
      </div>
    </div>
  );

  const spotlight = customers && today ? (
    <CustomersSpotlight
      customers={customers} today={today} role={role} orgId={profile?.org_id} branchName={branchName}
      onSeeOwes={() => patchParams({ tab: 'owes', segment: '', member: '', page: 1 }, { push: true })}
      onReviewAtRisk={() => patchParams({ segment: 'at-risk', tab: '', member: '', page: 1 }, { push: true })}
      onSeeRegularsNoMember={() => patchParams({ segment: 'regular', member: 'no', tab: '', page: 1 }, { push: true })}
    />
  ) : null;

  const strip = (
    <div className="grid grid-cols-2 lg:grid-cols-5 border border-border rounded-[10px] mt-[18px] overflow-hidden" role="group" aria-label="Customer lifecycle">
      {LIFECYCLE.map((s, i) => {
        const n = mix ? mix[s.id] : null;
        const pct = mix && total ? Math.round((n / total) * 100) : 0;
        const on = segment === s.id;
        return (
          <button key={s.id} type="button" aria-pressed={on} onClick={() => patchParams({ segment: on ? '' : s.id, page: 1 }, { push: true })}
            className={`text-left px-4 py-3 relative ${i > 0 ? 'lg:border-l border-border' : ''} ${i % 2 === 1 ? 'border-l lg:border-l' : ''} ${i >= 2 ? 'border-t lg:border-t-0' : ''} ${on ? 'bg-[#F2F6F0]' : 'hover:bg-[#FAFAF9]'}`}>
            <span className={`flex items-center gap-1.5 text-[12px] font-medium ${on ? 'text-text-primary' : 'text-[#8A8A90]'}`}><i className="w-2 h-2 rounded-[2px]" style={{ background: s.color }} />{s.label}</span>
            <span className="flex items-baseline gap-2 mt-1">
              <b className="text-[20px] font-semibold tracking-[-0.4px] tabular-nums">{n ?? '—'}</b>
              <span className="text-[12px] text-[#8A8A90] tabular-nums">{mix ? `${pct}%` : ''}</span>
            </span>
            <span className="block text-[11.5px] text-[#8A8A90] mt-0.5">{s.hint}</span>
            <span className="block h-[3px] rounded-sm bg-[#F1F1EF] mt-2.5 overflow-hidden"><span className="block h-full rounded-sm" style={{ width: `${pct}%`, background: s.color }} /></span>
            {on && <span className="absolute left-0 right-0 bottom-0 h-0.5 bg-primary" />}
          </button>
        );
      })}
    </div>
  );

  const views = (
    <div className="flex items-center gap-[22px] border-b border-border mt-5 overflow-x-auto overflow-y-hidden lg:overflow-visible" role="tablist" aria-label="Customer views">
      {TAB_DEFS.map((v) => {
        const on = tab === v.id;
        return (
          <button key={v.id} type="button" role="tab" aria-selected={on} onClick={() => patchParams({ tab: v.id, page: 1 }, { push: true })}
            className={`h-[38px] flex items-center gap-[7px] text-[13px] font-medium relative whitespace-nowrap ${on ? 'text-text-primary' : 'text-[#515152] hover:text-text-primary'}`}>
            {v.dot && <span className="w-1.5 h-1.5 rounded-full bg-[#4F46E5]" />}
            {v.star && <StarIcon size={12} />}
            {v.label}{counts && <span className="text-[#8A8A90] tabular-nums">{counts[v.id]}</span>}
            {on && <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-text-primary rounded" />}
          </button>
        );
      })}
      {isMgrUp && dupCount > 0 && (
        <button type="button" onClick={onShowDuplicates} className="ml-auto h-[38px] flex items-center gap-1.5 text-[12.5px] whitespace-nowrap text-[#8A8A90] hover:text-text-primary">
          <Icon name="GitMerge" size={14} />{dupCount} possible duplicate{dupCount === 1 ? '' : 's'}
        </button>
      )}
    </div>
  );

  const toolbar = (
    <div className="flex items-center gap-2 py-3.5 flex-wrap">
      <div className="relative w-full sm:w-[320px]">
        <Icon name="Search" size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8A8A90]" />
        <input ref={searchRef} value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search name, phone or email"
          aria-label="Search customers" className="w-full h-[34px] pl-8 pr-8 border border-border rounded-[7px] text-[13px] bg-white placeholder:text-[#8A8A90] focus:outline-none focus:border-[#cfd2cc] focus:shadow-[0_0_0_3px_rgba(45,90,39,.08)]" />
        <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[10.5px] font-medium text-[#8A8A90] border border-border rounded px-[5px] py-px bg-white">/</kbd>
      </div>
      <FilterChip label="Therapist" value={filters.therapist} options={therapistOptions} onChange={setFilter('therapist')} selectedLabel={therapistOptions.find((o) => o.id === filters.therapist)?.label} />
      <FilterChip label="Service" value={filters.service} options={serviceOptions} onChange={setFilter('service')} selectedLabel={filters.service} />
      {noMember && (
        <span className="h-7 rounded-full inline-flex items-center text-[12.5px] font-medium border border-border bg-[#FAFAF9] text-text-primary">
          <span className="pl-2.5 pr-2">No membership</span>
          <button type="button" onClick={() => patchParams({ member: '', page: 1 })} aria-label="Clear No membership" className="h-full pr-2 -ml-1 text-[#8A8A90] hover:text-text-primary"><Icon name="X" size={12} /></button>
        </span>
      )}
      <FilterChip label="Last visit" value={filters.last} options={LAST_VISIT_OPTIONS} onChange={setFilter('last')} selectedLabel={LAST_VISIT_OPTIONS.find((o) => o.id === filters.last)?.label} />
      <div className="ml-auto flex items-center gap-2">
        <Menu trigger={(open, toggle) => (
          <button type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} className="h-7 px-2 rounded-md text-[12.5px] text-[#515152] inline-flex items-center gap-1.5 hover:bg-[#FAFAF9]">
            Sort <b className="text-text-primary font-medium">{SORTS[sort].label}</b><Icon name="ChevronDown" size={13} />
          </button>)}>
          {(close) => Object.entries(SORTS).filter(([id]) => id !== 'spent' || isMgrUp).map(([id, s]) => (
            <button key={id} type="button" onClick={() => { patchParams({ sort: id, dir: '' }); close(); }} className={`w-full text-left px-3 py-1.5 text-[13px] hover:bg-[#FAFAF9] flex justify-between ${sort === id ? 'font-medium' : ''}`}>
              {s.label}{sort === id && <Icon name="Check" size={13} />}
            </button>))}
        </Menu>
        <Menu trigger={(open, toggle) => (
          <button type="button" onClick={toggle} aria-label="Columns" aria-haspopup="menu" aria-expanded={open} className="w-[30px] h-[30px] border border-border rounded-md grid place-items-center text-[#515152] hover:bg-[#FAFAF9]"><Icon name="Columns" size={15} /></button>)}>
          {() => ['visits', 'spent', 'balance'].filter((k) => k !== 'spent' || isMgrUp).map((k) => (
            <label key={k} className="flex items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-[#FAFAF9] cursor-pointer capitalize">
              <input type="checkbox" checked={columns[k]} onChange={() => setColumns((c) => ({ ...c, [k]: !c[k] }))} />{k}
            </label>))}
        </Menu>
      </div>
    </div>
  );

  const th = { sort, dir, onSort };
  let body;
  if (loading) {
    body = Array.from({ length: 8 }).map((_, i) => (
      <tr key={i}><td colSpan={colCount} className="h-14 border-b border-[#F1F1EF]"><div className="h-8 rounded bg-[#F1F1EF] animate-pulse" /></td></tr>
    ));
  } else if (error) {
    body = null;
  } else {
    body = rows.map((c) => {
      const atRisk = c.segment === 'at-risk' || c.segment === 'lapsed';
      const next = c.nextBooking;
      return (
        <tr key={c.id} onClick={() => patchParams({ open: c.id })} tabIndex={0} aria-selected={c.id === openId || undefined} onKeyDown={(e) => { if (e.key === 'Enter') patchParams({ open: c.id }); }}
          className={`group cursor-pointer ${c.id === openId ? 'bg-[#F2F6F0]' : 'hover:bg-[#FAFAF9]'}`}>
          <td className={`h-14 border-b border-[#F1F1EF] pr-3 ${c.id === openId ? 'shadow-[inset_3px_0_0_0_#2D5A27]' : ''}`}>
            <div className="flex items-center gap-3 pl-2">
              <div className="w-8 h-8 rounded-full bg-[#F1F1EF] text-[#4A4A4F] text-[11.5px] font-semibold grid place-items-center flex-shrink-0">{initials(c.fullName)}</div>
              <div className="min-w-0">
                <div className="font-medium text-[13.5px] tracking-[-0.1px] flex items-center gap-1.5 text-text-primary">
                  <span className="truncate">{c.fullName}</span>
                  {c.inSpa ? <InSpaTag /> : c.segment === 'new' && <span className="h-5 rounded-full px-[7px] text-[11.5px] font-medium inline-flex items-center bg-[#EEF3EC] text-primary">New</span>}
                  {c.vip && <StarIcon />}
                </div>
                <div className="text-[12.5px] text-[#8A8A90] mt-0.5 truncate">{formatPhoneGrouped(c.phone)}</div>
                <div className="sm:hidden text-[12.5px] text-[#515152] truncate">{next ? `${relativeDayLabel(next.date, today)} · ${next.time}` : 'No upcoming booking'}</div>
              </div>
            </div>
          </td>
          <td className="h-14 border-b border-[#F1F1EF] pr-3 hidden sm:table-cell">
            {next ? (
              <>
                <div className="text-[13px] font-medium">{relativeDayLabel(next.date, today)}</div>
                <div className="text-[12.5px] text-[#515152] truncate max-w-[240px]">{[next.time && formatTime(next.time), next.service, next.therapist].filter(Boolean).join(' · ')}</div>
              </>
            ) : <span className="text-[13px] text-[#B4B4BA]">No upcoming booking</span>}
          </td>
          <td className="h-14 border-b border-[#F1F1EF] pr-3 hidden md:table-cell">
            {c.lastVisit ? (
              <>
                <div className="text-[13px] font-medium">
                  <span className={atRisk ? 'text-[#B45309]' : ''}>{relativeDayLabel(c.lastVisit.date, today)}</span>
                  {atRisk && <span className="text-[#515152] font-normal"> · {monthsSince(c.lastVisit.date, today)} months</span>}
                </div>
                <div className="text-[12.5px] text-[#8A8A90] truncate max-w-[220px]">{c.lastVisit.service}</div>
              </>
            ) : <span className="text-[13px] text-[#B4B4BA]">No visits yet</span>}
          </td>
          {columns.visits && <td className="h-14 border-b border-[#F1F1EF] pr-4 text-right text-[13px] tabular-nums hidden md:table-cell">{c.completedVisits}</td>}
          {showSpent && <td className="h-14 border-b border-[#F1F1EF] pr-4 text-right text-[13px] tabular-nums whitespace-nowrap hidden lg:table-cell">{c.spent > 0 ? npr(c.spent) : <span className="text-[#B4B4BA]">—</span>}</td>}
          {columns.balance && (
            <td className="h-14 border-b border-[#F1F1EF] text-right whitespace-nowrap hidden sm:table-cell">
              {c.balance > 0 ? (
                <span className="inline-flex items-center gap-[7px] text-[13px] font-medium text-text-primary tabular-nums"><i className="w-1.5 h-1.5 rounded-full bg-[#F59E0B]" />{npr(c.balance)}</span>
              ) : <span className="text-[#B4B4BA]">—</span>}
            </td>
          )}
          <td className="h-14 border-b border-[#F1F1EF] w-[88px] pl-3">
            <div className="flex gap-1.5 justify-end items-center text-[#8A8A90] opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity">
              {!readOnly && <button type="button" onClick={(e) => { e.stopPropagation(); bookFor(c); }} className="h-[26px] px-[9px] border border-border rounded-md bg-white text-[12px] font-medium text-text-primary hover:bg-[#FAFAF9]">Book</button>}
              <Icon name="ChevronRight" size={15} />
            </div>
          </td>
        </tr>
      );
    });
  }

  const [emptyTitle, emptyHint] = anyFilter ? ['No customers match', 'Try a different search or clear a filter.'] : (segment ? EMPTY_SEGMENT[segment] : EMPTY_TAB[tab]);

  return (
    <div className="h-full flex flex-col pt-1 overflow-hidden">
      {header}
      {spotlight}
      {strip}
      {views}
      {toolbar}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {error ? (
          <div className="border border-error/20 bg-error/5 rounded-lg p-4 flex items-center gap-3 text-[13px] text-error">
            <Icon name="AlertCircle" size={16} />{error}
            <button type="button" onClick={load} className="ml-auto underline font-medium">Retry</button>
          </div>
        ) : (
          <table className="w-full border-collapse table-fixed">
            <thead>
              <tr>
                <SortHeader id="name" label="Customer" {...th} />
                <SortHeader id="next" label="Next booking" {...th} />
                <SortHeader id="last" label="Last visit" {...th} />
                {columns.visits && <SortHeader id="visits" label="Visits" right {...th} />}
                {showSpent && <SortHeader id="spent" label="Spent" right {...th} />}
                {columns.balance && <SortHeader id="balance" label="Balance" right {...th} />}
                <th className="h-[34px] w-[88px] border-b border-border bg-white sticky top-0" />
              </tr>
            </thead>
            <tbody>{body}</tbody>
          </table>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="text-center py-16">
            <Icon name="Users" size={28} className="text-[#B4B4BA] mx-auto mb-3" />
            <p className="text-[14px] font-medium text-text-primary">{emptyTitle}</p>
            <p className="text-[13px] text-[#8A8A90] mt-1">{emptyHint}</p>
            {anyFilter && (
              <button type="button" onClick={() => { setFilters({ therapist: '', service: '', last: '' }); setSearchText(''); patchParams({ q: '', segment: '', member: '', page: 1 }); }} className="mt-3 text-[13px] font-medium text-primary hover:underline">Clear search and filters</button>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between h-[52px] flex-shrink-0 text-[12.5px] text-[#8A8A90] border-t border-border">
        <span className="tabular-nums">{filtered.length === 0 ? '0 customers' : `${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, filtered.length)} of ${filtered.length}`}</span>
        <div className="flex gap-1.5">
          <button type="button" aria-label="Previous page" disabled={safePage <= 1} onClick={() => patchParams({ page: safePage - 1 })} className="w-7 h-7 border border-border rounded-md grid place-items-center disabled:opacity-40 hover:bg-[#FAFAF9]"><Icon name="ChevronLeft" size={14} /></button>
          <button type="button" aria-label="Next page" disabled={safePage >= pageCount} onClick={() => patchParams({ page: safePage + 1 })} className="w-7 h-7 border border-border rounded-md grid place-items-center disabled:opacity-40 hover:bg-[#FAFAF9]"><Icon name="ChevronRight" size={14} /></button>
        </div>
      </div>
      <CustomerPanel
        customer={customerOpen}
        today={today}
        readOnly={readOnly}
        branchId={branchId}
        isAdmin={role === 'admin'}
        onClose={() => patchParams({ open: '' })}
        onNewBooking={() => customerOpen && bookFor(customerOpen)}
        onOpenProfile={() => customerOpen && openProfile(customerOpen)}
        onChanged={load}
      />
    </div>
  );
};

// "16:00" → "4:00pm"
function formatTime(t) {
  const [h, m] = String(t).split(':').map(Number);
  if (Number.isNaN(h)) return '';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m || 0).padStart(2, '0')}${h >= 12 ? 'pm' : 'am'}`;
}

export default CustomersList;
