import { NEPAL_TZ } from '../../../../utils/nepalTime';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ScrollRow from '../../../../components/ui/ScrollRow';
import { useSearchParams } from 'react-router-dom';
import Icon from '../../../../components/AppIcon';
import { FilterChip } from '../../../../components/ui/ListToolbarKit';
import { fetchMembershipActivity } from '../../../../services/api';
import {
  KINDS, RANGES, extensionNote, rangeFor, rangeLead, activityTotals, whenLabel, kindLabel, shortName, npr,
} from '../../../../services/membershipsView';
import { friendlyError } from '../../../../utils/friendlyError';
import { useMinWidth, useSlashFocus, useStickyBlock, thClass, SearchBox, ClearableChip, csvDownload, EmptyBlock, ErrorBlock, leadNodes, RangeMenu, isDate } from '../Area/listKit';
import { wordBranchCap } from '../../../../utils/industryTerms';

const detailOf = (r) => {
  if (r.kind === 'deduction') return [r.service, r.bookingNumber].filter(Boolean).join(' · ') || r.notes || '';
  if (r.kind === 'deposit') return [r.paymentMode, r.notes].filter(Boolean).join(' · ');
  if (r.kind === 'extension') return extensionNote(r.notes);
  return r.notes || '';
};

// Wallet activity (V21): every wallet movement in a date range (This month by default): money added, spent, birthday gifts,
// adjustments and extensions, with who did it. Filters: search, Type, Tier, Staff, and a member (from the panel's "See all").
// Row click opens that member's panel.
const WalletUsagePanel = ({ members, tiers, today, stickyTop, registerExport, onOpen, onLead }) => {
  const [sp, setSp] = useSearchParams();
  const isSm = useMinWidth(640);
  const isMd = useMinWidth(768);
  const isLg = useMinWidth(1024);
  const spRef = useRef(sp);
  spRef.current = sp;
  const patch = useCallback((obj) => {
    const next = new URLSearchParams(spRef.current);
    Object.entries(obj).forEach(([k, v]) => { if (v == null || v === '') next.delete(k); else next.set(k, String(v)); });
    spRef.current = next;
    setSp(next, { replace: true });
  }, [setSp]);

  const rParam = sp.get('r');
  const custom = rParam === 'custom' && isDate(sp.get('from')) && isDate(sp.get('to'));
  const rangeId = custom ? 'custom' : (RANGES.some((r) => r.id === rParam) ? rParam : 'month');
  const { from, to } = custom ? { from: sp.get('from'), to: sp.get('to') } : rangeFor(rangeId, today);
  const query = sp.get('q') || '';
  const filters = { kind: sp.get('kind') || '', tier: sp.get('tier') || '', staff: sp.get('by') || '', member: sp.get('member') || '' };

  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    setError(null);
    const { data, error: err } = await fetchMembershipActivity({ from, to });
    if (err) { setError(friendlyError(err, 'Failed to load wallet activity.')); return; }
    setRows(data || []);
  }, [from, to]);
  useEffect(() => { setRows(null); load(); }, [load]);

  const [searchText, setSearchText] = useState(query);
  const searchRef = useRef(null);
  useEffect(() => {
    const t = setTimeout(() => { if (searchText !== query) patch({ q: searchText }); }, 200);
    return () => clearTimeout(t);
  }, [searchText]); // eslint-disable-line react-hooks/exhaustive-deps
  useSlashFocus(searchRef);

  const all = useMemo(() => rows || [], [rows]);
  const options = useMemo(() => {
    const staff = new Map();
    all.forEach((r) => { if (r.performerId && !staff.has(r.performerId)) staff.set(r.performerId, r.performerName || '—'); });
    return {
      kind: Object.entries(KINDS).map(([id, k]) => ({ id, label: k.label })),
      tier: (tiers || []).map((t) => ({ id: t.id, label: t.name })),
      staff: [...staff].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)),
    };
  }, [all, tiers]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((r) => {
      if (filters.kind && r.kind !== filters.kind) return false;
      if (filters.tier && r.tierId !== filters.tier) return false;
      if (filters.staff && r.performerId !== filters.staff) return false;
      if (filters.member && r.membershipId !== filters.member) return false;
      return !q || `${r.memberName} ${r.cardNo || ''}`.toLowerCase().includes(q);
    });
  }, [all, query, filters.kind, filters.tier, filters.staff, filters.member]);
  const memberName = filters.member ? ((members || []).find((m) => m.id === filters.member)?.customerName || all.find((r) => r.membershipId === filters.member)?.memberName || 'One member') : '';

  // Lead: "October so far: NPR X added to wallets · NPR Y spent from them" over what is listed.
  useEffect(() => {
    if (!rows) { onLead(' '); return; }
    const t = activityTotals(filtered);
    onLead(<>{rangeLead(rangeId, from, to)}{filters.member ? ` · ${memberName}` : ''}: {leadNodes([{ strong: npr(t.added) }, { text: ' added to wallets · ' }, { strong: npr(t.spent) }, { text: ' spent from them' }])}</>);
  }, [rows, filtered, rangeId, from, to, filters.member, memberName, onLead]);
  useEffect(() => () => onLead(' '), [onLead]);

  const exportCsv = useCallback(() => {
    csvDownload(`wallet-activity-${from}_to_${to}.csv`, ['When', 'Member', 'Card', 'Tier', 'Type', 'Detail', 'By', `${wordBranchCap()}`, 'Amount'],
      filtered.map((r) => [new Date(r.createdAt).toLocaleString('en-GB', { timeZone: NEPAL_TZ }), r.memberName, r.cardNo, r.tierName, kindLabel(r.kind), detailOf(r), r.performerName, r.branchName, r.amount]));
  }, [filtered, from, to]);
  useEffect(() => { registerExport({ run: exportCsv, disabled: !rows || filtered.length === 0 }); }, [exportCsv, rows, filtered.length, registerExport]);
  useEffect(() => () => registerExport(null), [registerExport]);

  const { blockRef, blockH, sentinelRef, stuck } = useStickyBlock(stickyTop);
  const loading = !rows && !error;
  const chipValue = (k) => options[k].find((o) => o.id === filters[k])?.label;
  const chips = (
    <>
      <FilterChip label="Type" value={filters.kind} options={options.kind} onChange={(v) => patch({ kind: v })} selectedLabel={chipValue('kind')} />
      <FilterChip label="Tier" value={filters.tier} options={options.tier} onChange={(v) => patch({ tier: v })} selectedLabel={chipValue('tier')} />
      <FilterChip label="Staff" value={filters.staff} options={options.staff} onChange={(v) => patch({ by: v })} selectedLabel={chipValue('staff')} />
      {filters.member && <ClearableChip label={`Member: ${memberName}`} onClear={() => patch({ member: '' })} />}
    </>
  );
  const rangeMenu = <RangeMenu id={rangeId} from={from} to={to} today={today} onPick={(id, f, t) => patch(id === 'custom' ? { r: 'custom', from: f, to: t } : { r: id === 'month' ? '' : id, from: '', to: '' })} />;
  const searchBox = <SearchBox ref={searchRef} value={searchText} onChange={setSearchText} placeholder="Search member or card no." ariaLabel="Search wallet activity" className="w-full sm:w-[260px]" />;

  const showBy = isLg;
  const showWhen = isSm;
  const colCount = (showWhen ? 1 : 0) + 1 + (isSm ? 1 : 0) + (showBy ? 1 : 0) + 1;
  const th = thClass(stuck);
  const thTop = { top: stickyTop + blockH };
  const anyFilter = !!(query || filters.kind || filters.tier || filters.staff || filters.member);

  let body = null;
  if (loading) {
    body = Array.from({ length: 8 }).map((_, i) => (
      <tr key={i}><td colSpan={colCount} className="h-[58px] border-b border-[#F1F1EF]"><div className="h-8 rounded bg-[#F1F1EF] animate-pulse" /></td></tr>
    ));
  } else if (!error) {
    body = filtered.map((r) => {
      const w = whenLabel(r.createdAt, today);
      const k = KINDS[r.kind] || { label: 'Other', tag: 'bg-[#F3F4F6] text-[#4B5563]' };
      const detail = detailOf(r);
      return (
        <tr key={r.id} data-activity-id={r.id} data-kind={r.kind} tabIndex={0} onClick={() => onOpen(r.membershipId)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(r.membershipId); }}
          className="cursor-pointer hover:bg-[#FAFAF9] focus:outline-none focus-visible:bg-[#FAFAF9]">
          {showWhen && (
            <td className="h-[58px] border-b border-[#F1F1EF] pl-2 pr-3">
              <div className="text-[13px] font-medium text-text-primary whitespace-nowrap">{w.day}</div>
              <div className="text-[12.5px] text-[#8A8A90] mt-0.5 tabular-nums">{w.time}</div>
            </td>
          )}
          <td className={`h-[58px] border-b border-[#F1F1EF] pr-3 ${showWhen ? '' : 'pl-2'}`}>
            <div className="text-[13px] font-medium text-text-primary truncate">{r.memberName}</div>
            <div className="text-[12.5px] text-[#8A8A90] mt-0.5 truncate">{showWhen ? <span className="font-data">{r.cardNo || '—'}</span> : `${w.day} ${w.time} · ${k.label}`}</div>
          </td>
          {isMd && (
            <td className="h-[58px] border-b border-[#F1F1EF] pr-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`h-[22px] px-1.5 rounded-md text-[11.5px] font-medium inline-flex items-center whitespace-nowrap flex-shrink-0 ${k.tag}`} data-kind-tag>{k.label}</span>
                <span className="text-[13px] text-[#515152] truncate">{detail}</span>
              </div>
            </td>
          )}
          {!isMd && isSm && (
            <td className="h-[58px] border-b border-[#F1F1EF] pr-3">
              <span className={`h-[22px] px-1.5 rounded-md text-[11.5px] font-medium inline-flex items-center whitespace-nowrap ${k.tag}`}>{k.label}</span>
            </td>
          )}
          {showBy && <td className="h-[58px] border-b border-[#F1F1EF] pr-3 text-[13px] text-[#515152] truncate">{r.performerName ? shortName(r.performerName) : '—'}</td>}
          <td className="h-[58px] border-b border-[#F1F1EF] pr-2 text-right">
            <span className={`text-[13px] font-semibold tabular-nums whitespace-nowrap ${r.amount > 0 ? 'text-[#2D7A32]' : r.amount < 0 ? 'text-text-primary' : 'text-[#B4B4BA]'}`} data-amount>
              {r.amount === 0 ? '—' : `${r.amount > 0 ? '+' : '−'} ${npr(Math.abs(r.amount))}`}
            </span>
          </td>
        </tr>
      );
    });
  }

  return (
    <div>
      <div ref={sentinelRef} aria-hidden="true" className="h-px" />
      <div ref={blockRef} className="sticky z-sticky-filter bg-white" style={{ top: stickyTop }}>
        <div className="flex items-center gap-2 pt-[18px] pb-2 flex-wrap">
          {rangeMenu}
          {searchBox}
          {isSm && chips}
        </div>
      </div>
      {!isSm && <ScrollRow className="pb-2" wrapperClassName="pb-0">{chips}</ScrollRow>}

      {error ? <ErrorBlock error={error} onRetry={load} /> : (
        <table className="w-full border-collapse table-fixed">
          <colgroup>
            {showWhen && <col style={{ width: 112 }} />}
            <col style={{ width: isMd ? '20%' : undefined }} />
            {(isMd || isSm) && <col style={{ width: isMd ? undefined : 120 }} />}
            {showBy && <col style={{ width: 120 }} />}
            <col style={{ width: 130 }} />
          </colgroup>
          <thead>
            <tr>
              {showWhen && <th scope="col" className={`${th} text-left pl-2`} style={thTop}>When</th>}
              <th scope="col" className={`${th} text-left ${showWhen ? '' : 'pl-2'}`} style={thTop}>Member</th>
              {(isMd || isSm) && <th scope="col" className={`${th} text-left`} style={thTop}>What happened</th>}
              {showBy && <th scope="col" className={`${th} text-left`} style={thTop}>By</th>}
              <th scope="col" className={`${th} text-right pr-2`} style={thTop}>Wallet</th>
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
      )}

      {!loading && !error && filtered.length === 0 && (all.length === 0
        ? <EmptyBlock icon="Wallet" title="No wallet activity in this period" hint="Money added, spent and gifts given show up here." action={rangeId !== 'all' ? { label: 'Show all time', run: () => patch({ r: 'all', from: '', to: '' }) } : null} />
        : <EmptyBlock icon="Wallet" title="Nothing matches" hint={anyFilter ? 'Try a different search or clear a filter.' : ''} action={{ label: 'Clear filters', run: () => { setSearchText(''); patch({ q: '', kind: '', tier: '', by: '', member: '' }); } }} />)}
      {!loading && !error && filtered.length > 0 && (
        <div className="flex items-center h-[52px] text-[12.5px] text-[#8A8A90] tabular-nums">{filtered.length} entr{filtered.length === 1 ? 'y' : 'ies'}</div>
      )}
    </div>
  );
};

export default WalletUsagePanel;
