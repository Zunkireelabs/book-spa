import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Icon from '../../../../components/AppIcon';
import ConfirmDialog from '../../../../components/ui/ConfirmDialog';
import { FilterChip, Menu } from '../../../../components/ui/ListToolbarKit';
import { useIndustry } from '../../../../hooks/useIndustry';
import { friendlyError } from '../../../../utils/friendlyError';
import {
  toggleTherapistActive, deleteTherapist, updateTherapistOrder, fetchTherapistBookingCounts,
} from '../../../../services/api';
import {
  STRIP_SEGMENTS, SORTS, inSegment, stripStats, needsYouNow, sortTherapists, matchesSearch, subLine,
} from '../../../../services/therapistsOverview';
import NeedsYouNow from '../Bookings/NeedsYouNow';
import {
  useMinWidth, useSlashFocus, useStickyBlock, thClass, LifecycleStrip, SearchBox, SortMenu, ClearableChip, Avatar, RowSwitch, csvDownload,
  EmptyBlock, ErrorBlock,
} from '../Area/listKit';
import TransferFromCalendarModal from '../calendar/TransferFromCalendarModal';
import TransferManagementModal from '../../../../components/ui/TransferManagementModal';
import { useAuth } from '../../../../contexts/AuthContext';
import { useBranch } from '../../../../contexts/BranchContext';
import TherapistPeekPanel from './TherapistPeekPanel';
import { toKathmanduParts } from '../calendar/calendarDates';
import { formatClockTime } from '../calendar/timeFormat';
import { TodayCell, BookingsCell, todayLabels } from './therapistBits';

const positionParts = (p) => (p ? p.split('/').map((x) => x.trim()).filter(Boolean) : []);
const NAME_MIN = 230;
const CELL = 'h-[58px] border-b border-[#F1F1EF] pr-3';

// One row. Sortable only in "Calendar order" with no filters (the grip appears on hover); clicking the row opens the peek.
const Row = ({ t, cols, rosterReadable, selected, sortable, canManage, busy, branchName, nowAtName, menuItems, onOpen, onToggle, stickyOffset }) => {
  const visitor = !!t.visiting;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: t.id, disabled: !sortable });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1, scrollMarginTop: stickyOffset };
  const dim = !t.isActive ? 'opacity-[.55]' : '';
  return (
    <tr ref={setNodeRef} style={style} data-therapist-id={t.id} tabIndex={0} aria-selected={selected || undefined}
      onClick={() => onOpen(t.id)} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(t.id); }}
      className={`group cursor-pointer focus:outline-none ${selected ? 'bg-[#F2F6F0]' : 'hover:bg-[#FAFAF9] focus-visible:bg-[#FAFAF9]'}`}>
      <td className={`${CELL} pr-0 ${selected ? 'shadow-[inset_3px_0_0_0_#2D5A27]' : ''}`}>
        {sortable && !visitor && (
          <button type="button" {...attributes} {...listeners} onClick={(e) => e.stopPropagation()} aria-label={`Drag ${t.name} to reorder`} title="Drag to change the Calendar order"
            className="ml-1 p-1 rounded cursor-grab active:cursor-grabbing text-[#B4B4BA] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-text-primary">
            <Icon name="GripVertical" size={15} />
          </button>
        )}
      </td>
      <td className={CELL}>
        <div className={`flex items-center gap-3 min-w-0 ${dim}`}>
          <Avatar name={t.name} size={34} />
          <div className="min-w-0">
            <div className="font-medium text-[13.5px] tracking-[-0.1px] text-text-primary flex items-center gap-1.5 min-w-0">
              <span className="truncate">{t.name}</span>
              {!t.isServiceStaff && <span className="h-[18px] px-1.5 rounded bg-[#F1F1EF] text-[10px] font-semibold uppercase text-[#8A8A90] inline-flex items-center flex-shrink-0">Support</span>}
            </div>
            <div className="text-[12.5px] text-[#8A8A90] mt-0.5 truncate">
              {visitor && t.transfer ? `From ${t.transfer.input.fromBranch || 'another branch'}` : (subLine(t) || '—')}{!cols.today && t.isActive ? ` · ${todayLabels(t).title}` : ''}
            </div>
          </div>
        </div>
      </td>
      {cols.branch && <td className={`${CELL} text-[13px] text-text-primary truncate`}>{branchName || '—'}</td>}
      {cols.nowAt && <td className={`${CELL} text-[13px] truncate ${t.nowAtBranchId && t.nowAtBranchId === t.branchId ? 'text-[#8A8A90]' : 'text-text-primary'}`} data-now-at>{nowAtName || '—'}{t.nowAtBranchId && t.nowAtBranchId !== t.branchId && t.transfer?.input?.revertAt ? ` until ${formatClockTime(toKathmanduParts(t.transfer.input.revertAt)?.time, false)}` : ''}</td>}
      {cols.today && <td className={CELL}>{t.isActive ? <TodayCell t={t} rosterReadable={rosterReadable} /> : <span className="text-[13px] text-[#8A8A90]">Inactive</span>}</td>}
      {cols.bookings && <td className={CELL}>{t.isActive ? <BookingsCell t={t} /> : <span className="text-[13px] text-[#8A8A90]">—</span>}</td>}
      {cols.services && (
        <td className={`${CELL} text-[13px] tabular-nums whitespace-nowrap`}>
          {t.isServiceStaff ? <><b className="font-semibold">{t.serviceCount}</b> <span className="text-[#8A8A90]">of {cols.totalServices}</span></> : <span className="text-[#8A8A90]">—</span>}
        </td>
      )}
      {cols.commission && (
        <td className={`${CELL} text-[13px] tabular-nums`} data-commission>
          {!visitor && t.rates && t.rates.servicePct != null ? (
            <><div className="font-medium">{t.rates.servicePct}%</div><div className="text-[12px] text-[#8A8A90]">{t.rates.productPct ? `${t.rates.productPct}% products` : '—'}</div></>
          ) : <span className="text-[#8A8A90]">—</span>}
        </td>
      )}
      {cols.phone && <td className={`${CELL} text-[13px] tabular-nums text-text-primary truncate`}>{t.phone || <span className="text-[#8A8A90]">—</span>}</td>}
      <td className={`${CELL} pr-2`} onClick={(e) => e.stopPropagation()}>
        {visitor ? <span className="text-[12px] text-[#8A8A90]">—</span> : canManage ? <RowSwitch checked={t.isActive} busy={busy} onChange={() => onToggle(t)} label={`${t.isActive ? 'Deactivate' : 'Activate'} ${t.name}`} />
          : <span className={`text-[12px] ${t.isActive ? 'text-primary' : 'text-[#8A8A90]'}`}>{t.isActive ? 'Active' : 'Inactive'}</span>}
      </td>
      <td className={`${CELL} pr-1`} onClick={(e) => e.stopPropagation()}>
        <Menu trigger={(open, toggle) => (
          <button type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-label={`Actions for ${t.name}`} data-row-menu
            className="w-7 h-7 rounded-md grid place-items-center text-[#8A8A90] hover:bg-black/[0.05] hover:text-text-primary"><Icon name="MoreHorizontal" size={16} /></button>)}>
          {(close) => menuItems(t).map((it, i) => (it.divider
            ? <div key={`d${i}`} className="border-t border-border my-1" />
            : (
              <button key={it.key} type="button" disabled={it.disabled} title={it.disabled ? it.reason : undefined} onClick={() => { close(); it.run(); }} data-menu-item={it.key}
                className={`w-full text-left px-3 py-1.5 text-[13px] hover:bg-[#FAFAF9] flex items-center gap-2.5 disabled:opacity-40 ${it.danger ? 'text-error' : 'text-text-primary'}`}>
                <Icon name={it.icon} size={14} className={it.danger ? 'text-error' : 'text-[#8A8A90]'} />{it.label}
              </button>)))}
        </Menu>
      </td>
    </tr>
  );
};

// A centred "can't be deleted" dialog: a therapist with any booking history is kept; the counts are shown BEFORE anything is attempted.
const CannotDeleteDialog = ({ t, counts, staffLabel, onCancel, onSeeBookings, onDeactivate, busy }) => (
  <div className="fixed inset-0 bg-text-primary/50 backdrop-blur-sm z-modal-overlay flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="cannot-delete-title">
    <div className="bg-surface rounded-spa-lg shadow-spa-modal w-full max-w-[420px] p-6 animate-fade-in">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-[#FEF3C7] grid place-items-center flex-shrink-0"><Icon name="AlertTriangle" size={20} className="text-[#B45309]" /></div>
        <div className="min-w-0">
          <h2 id="cannot-delete-title" className="text-[16px] font-semibold text-text-primary">{t.name} can't be deleted</h2>
          <p className="text-[13px] text-[#515152] mt-2 leading-relaxed">
            {t.name.split(' ')[0]} has booking history, and deleting would break those records. {t.isActive ? <>Deactivate instead: {t.name.split(' ')[0]} can't be picked for new bookings, and all history{t.rates ? ' and pay' : ''} stay.</> : <>They are already inactive, so they can't be picked for new bookings.</>}
            {counts.upcoming > 0 && <> Move the {counts.upcoming} upcoming booking{counts.upcoming === 1 ? '' : 's'} to someone else first, or keep {counts.upcoming === 1 ? 'it' : 'them'}.</>}
          </p>
        </div>
      </div>
      <dl className="mt-4 border border-border rounded-lg text-[13px]">
        <div className="flex justify-between px-3.5 h-[38px] items-center border-b border-[#F1F1EF]"><dt>Upcoming bookings</dt><dd className="tabular-nums font-medium">{counts.upcoming}{counts.upcoming > 0 && <span className="text-[#8A8A90] font-normal"> · stay on the calendar</span>}</dd></div>
        <div className="flex justify-between px-3.5 h-[38px] items-center border-b border-[#F1F1EF]"><dt>Past bookings</dt><dd className="tabular-nums font-medium">{counts.past}</dd></div>
        <div className="px-3.5 py-2.5 text-[12.5px] text-[#8A8A90]">Their commission history stays in Payroll either way.</div>
      </dl>
      <div className="flex items-center justify-end gap-2 mt-5 flex-wrap">
        <button type="button" onClick={onCancel} disabled={busy} className="h-9 px-3.5 rounded-md border border-border text-[13px] font-medium hover:bg-[#FAFAF9]">Cancel</button>
        {counts.upcoming > 0 && <button type="button" onClick={onSeeBookings} disabled={busy} className="h-9 px-3.5 rounded-md border border-border text-[13px] font-medium hover:bg-[#FAFAF9]">See {counts.upcoming} booking{counts.upcoming === 1 ? '' : 's'}</button>}
        {t.isActive && <button type="button" onClick={onDeactivate} disabled={busy} className="h-9 px-3.5 rounded-md bg-primary text-white text-[13px] font-medium hover:bg-primary/95 disabled:opacity-60">Deactivate</button>}
      </div>
      <p className="sr-only">{staffLabel}</p>
    </div>
  </div>
);

// Therapists list (V28): Today strip → Needs you now → sticky toolbar + headings → one row per person. `tab` is 'active' or 'inactive'.
const TherapistManagementPanel = ({
  tab, ov, error, onRetry, canManage, canSeeRates, isOverall, branchName, branchNameById, today, nowTime, stickyTop, registerExport, onChanged, notify,
  openId, onOpen, onCloseOpen, customPositions = [],
}) => {
  const navigate = useNavigate();
  const { orgSlug } = useParams();
  const { staffLabel, staffLabelPlural } = useIndustry();
  const { profile } = useAuth();
  const { branchId: scopeBranchId } = useBranch();
  const isAdmin = profile?.role === 'admin';
  const [sp, setSp] = useSearchParams();
  const isSm = useMinWidth(640);
  const isMd = useMinWidth(768);
  const isLg = useMinWidth(1024);
  const isXl = useMinWidth(1280);
  const [tableW, setTableW] = useState(0);
  const [wrapEl, wrapRef] = useState(null);
  useEffect(() => {
    if (!wrapEl || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setTableW(Math.round(wrapEl.getBoundingClientRect().width)));
    ro.observe(wrapEl);
    setTableW(Math.round(wrapEl.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, [wrapEl]);
  const active = tab === 'active';

  const seg = active && STRIP_SEGMENTS.some((s) => s.id === sp.get('seg')) ? sp.get('seg') : null;
  const query = sp.get('q') || '';
  const sortParam = sp.get('sort');
  const sort = sortParam && SORTS[sortParam] && ((sortParam !== 'branch' && sortParam !== 'nowat') || isOverall) ? sortParam : (isOverall ? 'branch' : 'calendar'); // Overall defaults to branch, then name
  const sorts = useMemo(() => (isOverall ? SORTS : Object.fromEntries(Object.entries(SORTS).filter(([id]) => id !== 'branch' && id !== 'nowat'))), [isOverall]);
  const filters = { position: sp.get('position') || '', type: sp.get('type') || '', gender: sp.get('gender') || '', branch: isOverall ? sp.get('branch') || '' : '' };
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
    const id = setTimeout(() => { if (searchText !== query) patch({ q: searchText }); }, 200);
    return () => clearTimeout(id);
  }, [searchText]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSearchText(query); }, [query]);
  useSlashFocus(searchRef);

  const loading = !ov && !error;
  const all = useMemo(() => (ov ? ov.therapists : []), [ov]);
  const tabList = useMemo(() => all.filter((t) => t.isActive === active), [all, active]);
  // Staff away on a transfer stay listed but are not part of today's availability counts.
  const presentList = useMemo(() => tabList.filter((t) => !t.transfer?.away), [tabList]);
  const stats = useMemo(() => (active && ov ? stripStats(presentList, { nowTime }) : {}), [active, ov, presentList, nowTime]);
  const segments = useMemo(() => STRIP_SEGMENTS.filter((s) => (s.id !== 'noroster' && s.id !== 'support') || (stats[s.id]?.count || 0) > 0).filter((s) => s.id !== 'noroster' || ov?.rosterReadable !== false), [stats, ov]);
  const needs = useMemo(() => (active && ov && !isOverall ? needsYouNow(presentList, { nowTime }) : null), [active, ov, isOverall, presentList, nowTime]);

  const positionOptions = useMemo(() => [...new Set(tabList.flatMap((t) => positionParts(t.position)).concat(customPositions))].sort().map((p) => ({ id: p, label: p })), [tabList, customPositions]);
  const genderOptions = useMemo(() => [...new Set(tabList.map((t) => t.gender).filter(Boolean))].sort().map((g) => ({ id: g, label: g })), [tabList]);
  const branchOptions = useMemo(() => Object.entries(branchNameById || {}).map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)), [branchNameById]);
  const typeOptions = [{ id: 'service', label: 'Service staff' }, { id: 'support', label: 'Support staff' }];

  const filtered = useMemo(() => sortTherapists(tabList.filter((t) => {
    if (seg && !inSegment(t, seg)) return false;
    if (filters.position && !positionParts(t.position).includes(filters.position)) return false;
    if (filters.type && (filters.type === 'service') !== t.isServiceStaff) return false;
    if (filters.gender && t.gender !== filters.gender) return false;
    if (filters.branch && t.branchId !== filters.branch) return false;
    return matchesSearch(t, query);
  }), sort, branchNameById), [tabList, seg, filters.position, filters.type, filters.gender, filters.branch, query, sort, branchNameById]);
  // Visiting today (ZNLY-113): listed apart under the home rows, not counted, read-only. Search narrows them; the other filters are home-list filters.
  const visitors = useMemo(() => (active && !isOverall && !seg && !filters.position && !filters.type && !filters.gender ? (ov?.visitors || []).filter((t) => matchesSearch(t, query)) : []),
    [active, isOverall, seg, filters.position, filters.type, filters.gender, ov, query]);
  const anyFilter = !!(seg || query || filters.position || filters.type || filters.gender || filters.branch);
  const sortable = active && canManage && !isOverall && sort === 'calendar' && !anyFilter;
  const clearAll = () => { setSearchText(''); patch({ q: '', position: '', type: '', gender: '', branch: '', seg: '' }, { push: true }); };

  // ── actions ──────────────────────────────────────────────────────────────────────────────────────────────────
  const [confirmToggle, setConfirmToggle] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [cannotDelete, setCannotDelete] = useState(null); // { t, counts }
  const [busy, setBusy] = useState(false);
  const [transferFor, setTransferFor] = useState(null);
  const [returnFor, setReturnFor] = useState(null); // admin: end a visitor's stay early (the same panel the profile uses)
  const [rowError, setRowError] = useState(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const doToggle = async (t, isActive) => {
    setBusy(true);
    setRowError(null);
    const res = await toggleTherapistActive({ therapistId: t.id, isActive });
    setBusy(false);
    setConfirmToggle(null);
    setCannotDelete(null);
    if (res.error) { setRowError(friendlyError(res.error, 'Could not update this person.')); return; }
    notify(`${t.name} is ${isActive ? 'active again' : 'inactive now'}`);
    onChanged();
  };
  const onToggle = (t) => { if (t.isActive) setConfirmToggle(t); else doToggle(t, true); };

  const askDelete = async (t) => {
    setRowError(null);
    const { data, error: err } = await fetchTherapistBookingCounts({ therapistId: t.id, today });
    if (err) { setRowError(friendlyError(err, 'Could not check this person\'s bookings.')); return; }
    if (data.total > 0) setCannotDelete({ t, counts: data }); else setConfirmDelete(t);
  };
  const doDelete = async () => {
    const t = confirmDelete;
    setBusy(true);
    const res = await deleteTherapist({ therapistId: t.id });
    setBusy(false);
    setConfirmDelete(null);
    if (res.error) {
      // The server guard is the real rule: bookings may have appeared since the pre-check.
      if (res.error.code === 'HAS_BOOKINGS') { const c = await fetchTherapistBookingCounts({ therapistId: t.id, today }); if (c.data) { setCannotDelete({ t, counts: c.data }); return; } }
      setRowError(friendlyError(res.error, 'Delete failed.'));
      return;
    }
    notify(`${t.name} deleted`);
    if (openId === t.id) onCloseOpen();
    onChanged();
  };

  const goCalendar = (t) => navigate({ search: `?view=calendar${t?.id ? `&therapist=${t.id}` : ''}` });
  const menuItems = (t) => {
    if (t.visiting) {
      // A visitor belongs to their home branch: never transfer / deactivate / delete here. Only the stay itself can be ended (admin).
      return [
        { key: 'profile', label: 'View profile', icon: 'User', run: () => navigate(`/${orgSlug}/staff/${t.id}`) },
        { key: 'calendar', label: 'See on calendar', icon: 'Calendar', run: () => goCalendar(t) },
        ...(canManage ? [{ key: 'attendance', label: 'Mark attendance', icon: 'Clock', run: () => navigate({ search: `?view=attendance&therapist=${t.id}` }) }] : []),
        ...(isAdmin && t.transfer ? [{ key: 'return', label: 'Return now', icon: 'ArrowRightLeft', run: () => { onCloseOpen(); setReturnFor(t); } }] : []),
      ];
    }
    const manage = canManage && !isOverall;
    return [
      { key: 'profile', label: 'Open full profile', icon: 'User', run: () => navigate(`/${orgSlug}/staff/${t.id}`) },
      { key: 'calendar', label: 'See on calendar', icon: 'Calendar', run: () => goCalendar(t), disabled: isOverall, reason: 'Pick a branch first.' },
      { key: 'attendance', label: 'Mark attendance', icon: 'Clock', run: () => navigate({ search: `?view=attendance&therapist=${t.id}` }), disabled: !manage || !t.isActive, reason: isOverall ? 'Pick a branch first.' : 'Only for active staff.' },
      ...(manage ? [
        { key: 'transfer', label: 'Transfer to branch…', icon: 'ArrowRightLeft', run: () => { onCloseOpen(); setTransferFor(t); } },
        { divider: true },
        { key: 'toggle', label: t.isActive ? 'Deactivate' : 'Activate', icon: t.isActive ? 'X' : 'Check', run: () => onToggle(t) },
        { key: 'delete', label: 'Delete…', icon: 'Trash2', danger: true, run: () => askDelete(t) },
      ] : []),
    ];
  };

  const handleDragEnd = async ({ active: a, over }) => {
    if (!over || a.id === over.id) return;
    const reordered = arrayMove(filtered, filtered.findIndex((t) => t.id === a.id), filtered.findIndex((t) => t.id === over.id));
    // Put the reordered active people back into the slots the active people held; inactive people keep their places.
    const everyone = all.slice().sort((x, y) => x.index - y.index);
    let k = 0;
    const orderedIds = everyone.map((t) => (t.isActive ? reordered[k++].id : t.id));
    const res = await updateTherapistOrder({ branchId: isOverall ? null : ov.therapists[0]?.branchId, orderedIds });
    if (res.error) setRowError(friendlyError(res.error, 'Could not save the new order.'));
    else notify('Calendar order saved');
    onChanged();
  };

  // ── export ───────────────────────────────────────────────────────────────────────────────────────────────────
  const exportCsv = useCallback(() => {
    const head = ['Name', 'Position', 'Gender', 'Type', ...(isOverall ? ['Branch', 'Now at'] : []), 'Today', 'Bookings today', 'Services', ...(canSeeRates ? ['Service commission %', 'Product commission %'] : []), 'Phone', 'Active'];
    const rows = filtered.map((t) => [t.name, t.position, t.gender, t.isServiceStaff ? 'Service' : 'Support', ...(isOverall ? [branchNameById?.[t.branchId] || '', branchNameById?.[t.nowAtBranchId] || ''] : []),
      t.isActive ? todayLabels(t).title : 'Inactive', t.bookings.count, t.isServiceStaff ? `${t.serviceCount} of ${ov.totalServices}` : '',
      ...(canSeeRates ? [t.rates?.servicePct ?? '', t.rates?.productPct ?? ''] : []), t.phone, t.isActive ? 'Yes' : 'No']);
    csvDownload(`${staffLabelPlural}-${isOverall ? 'all-branches' : branchName || 'branch'}-${active ? 'active' : 'inactive'}.csv`.toLowerCase().replace(/\s+/g, '-'), head, rows);
  }, [filtered, ov, canSeeRates, isOverall, branchName, branchNameById, staffLabelPlural, active]);
  useEffect(() => { registerExport({ run: exportCsv, disabled: !ov || filtered.length === 0 }); }, [exportCsv, ov, filtered.length, registerExport]);
  useEffect(() => () => registerExport(null), [registerExport]);

  // ── layout ───────────────────────────────────────────────────────────────────────────────────────────────────
  const { blockRef, sentinelRef, blockH, stuck, scrollToListTop } = useStickyBlock(stickyTop);
  const listKey = `${tab}|${seg}|${query}|${sort}|${filters.position}|${filters.type}|${filters.gender}|${filters.branch}`;
  const firstKey = useRef(true);
  useEffect(() => {
    if (firstKey.current) { firstKey.current = false; return; }
    if (stuck) scrollToListTop();
  }, [listKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Table is table-fixed with Name as the only flexible column, so optional columns are added by the width actually available (Name keeps >= NAME_MIN):
  // a viewport breakpoint can't know the sidebar and page padding, which is how Name collapsed to zero on a wide Overall window.
  const OPT = [ // in the order they are given up room, first = kept longest
    ['today', active && isSm, isLg ? 210 : 170], ['bookings', active && isMd, isLg ? 190 : 150], ['nowAt', isOverall && isMd, 150],
    ['services', isLg, 90], ['commission', isLg && canSeeRates, 120], ['phone', isXl, 130],
  ];
  const fit = {};
  let room = (tableW || (typeof window !== 'undefined' ? window.innerWidth : 1280)) - NAME_MIN - 28 - 70 - 40 - (isOverall ? 120 : 0);
  OPT.forEach(([id, want, w]) => { fit[id] = !!want && room >= w; if (fit[id]) room -= w; });
  const cols = { branch: isOverall, ...fit, totalServices: ov?.totalServices ?? 0 };
  const colCount = 3 + (cols.branch ? 1 : 0) + (cols.nowAt ? 1 : 0) + (cols.today ? 1 : 0) + (cols.bookings ? 1 : 0) + (cols.services ? 1 : 0) + (cols.commission ? 1 : 0) + (cols.phone ? 1 : 0) + 1;
  const th = thClass(stuck);
  const thTop = { top: stickyTop + blockH };
  const chipLabel = (opts, v) => opts.find((o) => o.id === v)?.label;

  const searchBox = <SearchBox ref={searchRef} value={searchText} onChange={setSearchText} placeholder="Search name or phone" ariaLabel={`Search ${staffLabelPlural.toLowerCase()}`} />;
  const chips = (
    <>
      {isOverall && <FilterChip label="Branch" value={filters.branch} options={branchOptions} onChange={(v) => patch({ branch: v })} selectedLabel={chipLabel(branchOptions, filters.branch)} />}
      <FilterChip label="Position" value={filters.position} options={positionOptions} onChange={(v) => patch({ position: v })} selectedLabel={chipLabel(positionOptions, filters.position)} />
      <FilterChip label="Type" value={filters.type} options={typeOptions} onChange={(v) => patch({ type: v })} selectedLabel={chipLabel(typeOptions, filters.type)} />
      <FilterChip label="Gender" value={filters.gender} options={genderOptions} onChange={(v) => patch({ gender: v })} selectedLabel={chipLabel(genderOptions, filters.gender)} />
      {seg && <ClearableChip label={STRIP_SEGMENTS.find((s) => s.id === seg).label} onClear={() => patch({ seg: '' })} />}
    </>
  );
  const sortMenu = <SortMenu sorts={sorts} value={sort} onChange={(id) => patch({ sort: id === (isOverall ? 'branch' : 'calendar') ? '' : id })} />;
  const toolbar = isSm
    ? <div className="flex items-center gap-2 pt-3.5 pb-2 flex-wrap">{searchBox}{chips}<div className="ml-auto">{sortMenu}</div></div>
    : <div className="pt-2.5 pb-2">{searchBox}</div>;

  const peekT = openId ? (all.find((t) => t.id === openId) || (ov?.visitors || []).find((t) => t.id === openId)) : null;

  let body = null;
  if (loading) {
    body = Array.from({ length: 7 }).map((_, i) => <tr key={i}><td colSpan={colCount} className="h-[58px] border-b border-[#F1F1EF]"><div className="h-8 rounded bg-[#F1F1EF] animate-pulse" /></td></tr>);
  } else if (!error) {
    const rows = filtered.map((t) => (
      <Row key={t.id} t={t} cols={cols} rosterReadable={ov.rosterReadable !== false} selected={t.id === openId} sortable={sortable} canManage={canManage && !isOverall} busy={busy} menuItems={menuItems}
        branchName={branchNameById?.[t.branchId]} nowAtName={branchNameById?.[t.nowAtBranchId]} onOpen={onOpen} onToggle={onToggle} stickyOffset={stickyTop + blockH + 40} />
    ));
    body = sortable
      ? <SortableContext items={filtered.map((t) => t.id)} strategy={verticalListSortingStrategy}>{rows}</SortableContext>
      : rows;
  }
  const visitorRows = visitors.map((t) => (
    <Row key={t.id} t={t} cols={cols} rosterReadable={ov.rosterReadable !== false} selected={t.id === openId} sortable={false} canManage={false} busy={false} menuItems={menuItems}
      branchName={branchNameById?.[t.branchId]} onOpen={onOpen} onToggle={() => {}} stickyOffset={stickyTop + blockH + 40} />
  ));

  return (
    <div>
      {active && (
        <LifecycleStrip segments={segments} stats={stats} selected={seg} loading={loading} ariaLabel="Today"
          onPick={(id, on) => patch({ seg: on ? '' : id }, { push: true })} />
      )}
      {needs && (
        <div className="mt-3 -mb-3">
          <NeedsYouNow items={[{ id: 'attendance', text: isMd ? needs.text : needs.short, action: isMd ? 'Open attendance' : 'Open', dot: '#F59E0B' }]} active="" onPick={() => navigate({ search: '?view=attendance' })} tailText="Everyone else is on time" />
        </div>
      )}
      <div ref={sentinelRef} aria-hidden="true" className="h-px mt-0.5" />
      <div ref={blockRef} className="sticky z-sticky-filter bg-white" style={{ top: stickyTop }}>{toolbar}</div>
      {!isSm && <div className="flex items-center gap-2 pb-2 flex-wrap">{chips}<div className="ml-auto">{sortMenu}</div></div>}

      {rowError && (
        <div className="flex items-center gap-2 p-3 mb-2 bg-error/10 border border-error/20 rounded-spa text-error text-sm" role="alert">
          <Icon name="AlertCircle" size={16} /><span>{rowError}</span>
          <button type="button" onClick={() => setRowError(null)} className="ml-auto" aria-label="Dismiss"><Icon name="X" size={14} /></button>
        </div>
      )}

      {error ? <ErrorBlock error={error} onRetry={onRetry} /> : (
        <div ref={wrapRef}><DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <table className="w-full border-collapse table-fixed">
            <colgroup>
              <col style={{ width: 28 }} />
              <col />
              {cols.branch && <col style={{ width: 120 }} />}
              {cols.nowAt && <col style={{ width: 150 }} />}
              {cols.today && <col style={{ width: isLg ? 210 : 170 }} />}
              {cols.bookings && <col style={{ width: isLg ? 190 : 150 }} />}
              {cols.services && <col style={{ width: 90 }} />}
              {cols.commission && <col style={{ width: 120 }} />}
              {cols.phone && <col style={{ width: 130 }} />}
              <col style={{ width: 70 }} />
              <col style={{ width: 40 }} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className={th} style={thTop}><span className="sr-only">Reorder</span></th>
                <th scope="col" className={`${th} text-left`} style={thTop}>Name</th>
                {cols.branch && <th scope="col" className={`${th} text-left`} style={thTop}>Branch</th>}
                {cols.nowAt && <th scope="col" className={`${th} text-left`} style={thTop}>Now at</th>}
                {cols.today && <th scope="col" className={`${th} text-left`} style={thTop}>Today</th>}
                {cols.bookings && <th scope="col" className={`${th} text-left`} style={thTop}>Bookings today</th>}
                {cols.services && <th scope="col" className={`${th} text-left`} style={thTop}>Services</th>}
                {cols.commission && <th scope="col" className={`${th} text-left`} style={thTop}>Commission</th>}
                {cols.phone && <th scope="col" className={`${th} text-left`} style={thTop}>Phone</th>}
                <th scope="col" className={`${th} text-left`} style={thTop}>Active</th>
                <th scope="col" className={th} style={thTop}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>{body}</tbody>
            {!loading && !error && visitors.length > 0 && (
              <tbody data-visiting-group>
                <tr><td colSpan={colCount} className="h-9 pt-3 border-b border-[#F1F1EF] text-[11.5px] font-medium uppercase tracking-[.05em] text-[#8A8A90]">Visiting today · {visitors.length}</td></tr>
                {visitorRows}
              </tbody>
            )}
          </table>
        </DndContext></div>
      )}

      {!loading && !error && filtered.length === 0 && (tabList.length === 0
        ? <EmptyBlock icon="Users" title={active ? `No ${staffLabelPlural.toLowerCase()} yet` : `No inactive ${staffLabelPlural.toLowerCase()}`}
          hint={active ? (canManage && !isOverall ? `Add the first ${staffLabel.toLowerCase()} with the button above.` : `${staffLabelPlural} appear here once a manager adds them.`) : 'Anyone you deactivate is kept here with their history.'} />
        : <EmptyBlock icon="Users" title={`No ${staffLabelPlural.toLowerCase()} match`} hint="Try a different search or clear a filter." action={{ label: 'Clear filters', run: clearAll }} />)}
      {!loading && !error && filtered.length > 0 && (
        <div className="flex items-center h-[52px] text-[12.5px] text-[#8A8A90] tabular-nums">
          {anyFilter ? `${filtered.length} of ${tabList.length}` : filtered.length} {(filtered.length === 1 ? staffLabel : staffLabelPlural).toLowerCase()}
          {sortable && <span className="ml-1">· Drag a row's grip to change the order they appear on the Calendar.</span>}
          {active && !sortable && canManage && !isOverall && (anyFilter || sort !== 'calendar') && <span className="ml-1">· Reordering is available in Calendar order with no filters.</span>}
        </div>
      )}

      {peekT && !transferFor && !returnFor && (
        <TherapistPeekPanel key={peekT.id} t={peekT} branchName={peekT.visiting ? branchName : (branchNameById?.[peekT.branchId] || branchName)} totalServices={ov.totalServices} canSeeRates={canSeeRates}
          ratesReadable={ov.ratesReadable} rosterReadable={ov.rosterReadable !== false} nowTime={nowTime} today={today} menuItems={menuItems(peekT)} onOpenCalendar={() => goCalendar(peekT)} onClose={onCloseOpen} />
      )}

      {transferFor && (
        <TransferFromCalendarModal variant="panel" therapistId={transferFor.id} therapistName={transferFor.name} currentBranchId={transferFor.branchId} defaultDate={today} defaultTime=""
          onClose={() => setTransferFor(null)} onSuccess={() => { setTransferFor(null); notify(`${transferFor.name} transferred`); onChanged(); }} />
      )}

      {returnFor && (
        <TransferManagementModal variant="panel" therapistId={returnFor.id} therapistName={returnFor.name} currentBranchId={scopeBranchId}
          onClose={() => setReturnFor(null)} onSuccess={(msg) => { setReturnFor(null); notify(msg || `${returnFor.name} returned`); onChanged(); }} />
      )}

      {confirmToggle && (
        <ConfirmDialog title={`Deactivate ${staffLabel.toLowerCase()}?`} message={`"${confirmToggle.name}" will be hidden from new bookings but stay in every past record.`}
          confirmLabel="Deactivate" requireReason={false} isSubmitting={busy} onConfirm={() => doToggle(confirmToggle, false)} onClose={() => !busy && setConfirmToggle(null)} />
      )}
      {confirmDelete && (
        <ConfirmDialog title={`Delete ${staffLabel.toLowerCase()}?`} message={`"${confirmDelete.name}" has no bookings, so they can be deleted. This can't be undone.`}
          confirmLabel="Delete" requireReason={false} isSubmitting={busy} onConfirm={doDelete} onClose={() => !busy && setConfirmDelete(null)} />
      )}
      {cannotDelete && (
        <CannotDeleteDialog t={cannotDelete.t} counts={cannotDelete.counts} staffLabel={staffLabel} busy={busy}
          onCancel={() => setCannotDelete(null)} onDeactivate={() => doToggle(cannotDelete.t, false)}
          onSeeBookings={() => { setCannotDelete(null); navigate({ search: '?view=bookings' }); }} />
      )}
    </div>
  );
};

export default TherapistManagementPanel;
