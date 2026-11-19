import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FilterChip } from '../../../../components/ui/ListToolbarKit';
import { fetchVoucherActivity } from '../../../../services/api';
import { RANGES, rangeFor, rangeLead } from '../../../../services/membershipsView';
import { KINDS, buildActivity, activityTotals, activityWhen, matchesVoucherSearch, shortName, npr } from '../../../../services/vouchersView';
import { friendlyError } from '../../../../utils/friendlyError';
import { useMinWidth, useSlashFocus, useStickyBlock, thClass, SearchBox, ClearableChip, RangeMenu, isDate, csvDownload, EmptyBlock, ErrorBlock, leadNodes } from '../Area/listKit';
import { wordBranchCap } from '../../../../utils/industryTerms';

// Activity (V23, was "Redemptions"): everything that happened to vouchers in a date range (This month by default): sold, given
// free, redeemed, coupon used, extended, checked (the one-off review) and corrected, with who did it. Amounts are voucher VALUE;
// money taken shows only on a sale ("Paid …"). Filters: search, What happened, Branch, Staff, and one voucher (`?voucher=` from
// the panel). Row click opens that voucher's panel.
const VoucherActivityPanel = ({ vouchers, today, stickyTop, registerExport, onOpen, onLead }) => {
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
  const filters = { kind: sp.get('kind') || '', branch: sp.get('br') || '', staff: sp.get('by') || '', voucher: sp.get('voucher') || '' };

  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    setError(null);
    const { data, error: err } = await fetchVoucherActivity({ from, to });
    if (err) { setError(friendlyError(err, 'Failed to load voucher activity.')); return; }
    setRows(buildActivity(data));
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
    const branches = new Map();
    all.forEach((r) => {
      if (r.performerId && !staff.has(r.performerId)) staff.set(r.performerId, r.performerName || '—');
      if (r.branchId && !branches.has(r.branchId)) branches.set(r.branchId, r.branchName || '—');
    });
    const sorted = (m) => [...m].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
    return { kind: Object.entries(KINDS).map(([id, k]) => ({ id, label: k.label })), branch: sorted(branches), staff: sorted(staff) };
  }, [all]);
  const filtered = useMemo(() => all.filter((r) => {
    if (filters.kind && r.kind !== filters.kind) return false;
    if (filters.branch && r.branchId !== filters.branch) return false;
    if (filters.staff && r.performerId !== filters.staff) return false;
    if (filters.voucher && r.voucherId !== filters.voucher) return false;
    return matchesVoucherSearch({ voucherCode: r.code, guestName: r.guestName }, query);
  }), [all, query, filters.kind, filters.branch, filters.staff, filters.voucher]);
  const voucherLabel = filters.voucher ? ((vouchers || []).find((v) => v.id === filters.voucher)?.guestName || all.find((r) => r.voucherId === filters.voucher)?.guestName || 'One voucher') : '';

  // Lead: "October so far: NPR X sold · NPR Y given free · NPR Z redeemed" over what is listed.
  useEffect(() => {
    if (!rows) { onLead(' '); return; }
    const t = activityTotals(filtered);
    onLead(<>{rangeLead(rangeId, from, to)}{filters.voucher ? ` · ${voucherLabel}` : ''}: {leadNodes([{ strong: npr(t.sold) }, { text: ' sold · ' }, { strong: npr(t.free) }, { text: ' given free · ' }, { strong: npr(t.redeemed) }, { text: ' redeemed' }])}</>);
  }, [rows, filtered, rangeId, from, to, filters.voucher, voucherLabel, onLead]);
  useEffect(() => () => onLead(' '), [onLead]);

  const exportCsv = useCallback(() => {
    csvDownload(`voucher-activity-${from}_to_${to}.csv`, ['Date', 'Time', 'Guest', 'Code', 'What happened', 'Detail', `${wordBranchCap()}`, 'By', 'Voucher value', 'Paid'],
      filtered.map((r) => { const w = activityWhen(r, today); return [r.date, w.time, r.guestName, r.code, KINDS[r.kind]?.label, r.detail, r.branchName, r.performerName, r.amount, r.paid]; }));
  }, [filtered, from, to, today]);
  useEffect(() => { registerExport({ run: exportCsv, disabled: !rows || filtered.length === 0 }); }, [exportCsv, rows, filtered.length, registerExport]);
  useEffect(() => () => registerExport(null), [registerExport]);

  const { blockRef, blockH, sentinelRef, stuck } = useStickyBlock(stickyTop);
  const loading = !rows && !error;
  const chipValue = (k) => options[k].find((o) => o.id === filters[k])?.label;
  const chips = (
    <>
      <FilterChip label="What happened" value={filters.kind} options={options.kind} onChange={(v) => patch({ kind: v })} selectedLabel={chipValue('kind')} />
      <FilterChip label={`${wordBranchCap()}`} value={filters.branch} options={options.branch} onChange={(v) => patch({ br: v })} selectedLabel={chipValue('branch')} />
      <FilterChip label="Staff" value={filters.staff} options={options.staff} onChange={(v) => patch({ by: v })} selectedLabel={chipValue('staff')} />
      {filters.voucher && <ClearableChip label={`Voucher: ${voucherLabel}`} onClear={() => patch({ voucher: '' })} />}
    </>
  );
  const rangeMenu = <RangeMenu id={rangeId} from={from} to={to} today={today} onPick={(id, f, t) => patch(id === 'custom' ? { r: 'custom', from: f, to: t } : { r: id === 'month' ? '' : id, from: '', to: '' })} />;
  const searchBox = <SearchBox ref={searchRef} value={searchText} onChange={setSearchText} placeholder="Search guest or voucher code" ariaLabel="Search voucher activity" className="w-full sm:w-[260px]" />;

  const showWhen = isSm;
  const showBranch = isLg;
  const showBy = isLg;
  const colCount = (showWhen ? 1 : 0) + 1 + (isSm ? 1 : 0) + (showBranch ? 1 : 0) + (showBy ? 1 : 0) + 1;
  const th = thClass(stuck);
  const thTop = { top: stickyTop + blockH };
  const anyFilter = !!(query || filters.kind || filters.branch || filters.staff || filters.voucher);

  let body = null;
  if (loading) {
    body = Array.from({ length: 8 }).map((_, i) => (
      <tr key={i}><td colSpan={colCount} className="h-[58px] border-b border-[#F1F1EF]"><div className="h-8 rounded bg-[#F1F1EF] animate-pulse" /></td></tr>
    ));
  } else if (!error) {
    body = filtered.map((r) => {
      const w = activityWhen(r, today);
      const k = KINDS[r.kind] || { label: 'Other', tag: 'bg-[#F3F4F6] text-[#4B5563]' };
      return (
        <tr key={r.id} data-activity-id={r.id} data-kind={r.kind} tabIndex={0} onClick={() => onOpen(r.voucherId)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(r.voucherId); }}
          className="cursor-pointer hover:bg-[#FAFAF9] focus:outline-none focus-visible:bg-[#FAFAF9]">
          {showWhen && (
            <td className="h-[58px] border-b border-[#F1F1EF] pl-2 pr-3">
              <div className="text-[13px] font-medium text-text-primary whitespace-nowrap">{w.day}</div>
              {w.time && <div className="text-[12.5px] text-[#8A8A90] mt-0.5 tabular-nums">{w.time}</div>}
            </td>
          )}
          <td className={`h-[58px] border-b border-[#F1F1EF] pr-3 ${showWhen ? '' : 'pl-2'}`}>
            <div className="text-[13px] font-medium text-text-primary truncate">{r.guestName}</div>
            <div className="text-[12.5px] text-[#8A8A90] mt-0.5 truncate">{showWhen ? <span className="font-data">{r.code}</span> : `${w.day}${w.time ? ` ${w.time}` : ''} · ${k.label}`}</div>
          </td>
          {isSm && (
            <td className="h-[58px] border-b border-[#F1F1EF] pr-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`h-[20px] px-[7px] rounded-md text-[11.5px] font-medium inline-flex items-center whitespace-nowrap flex-shrink-0 ${k.tag}`} data-kind-tag>{k.label}</span>
                {isMd && <span className="text-[13px] text-[#515152] truncate">{r.detail}</span>}
              </div>
            </td>
          )}
          {showBranch && <td className="h-[58px] border-b border-[#F1F1EF] pr-3 text-[13px] text-[#515152] truncate">{r.branchName || '—'}</td>}
          {showBy && <td className="h-[58px] border-b border-[#F1F1EF] pr-3 text-[13px] text-[#515152] truncate">{r.performerName ? shortName(r.performerName) : '—'}</td>}
          <td className="h-[58px] border-b border-[#F1F1EF] pr-3 text-right">
            <span className={`text-[13px] font-semibold tabular-nums whitespace-nowrap ${r.amount > 0 ? 'text-[#15803D]' : r.amount < 0 ? 'text-text-primary' : 'text-[#B4B4BA]'}`} data-amount>
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
      {!isSm && <div className="flex items-center gap-2 pb-2 flex-wrap">{chips}</div>}

      {error ? <ErrorBlock error={error} onRetry={load} /> : (
        <table className="w-full border-collapse table-fixed">
          <colgroup>
            {showWhen && <col style={{ width: 104 }} />}
            <col style={{ width: isSm ? '19%' : undefined }} />
            {isSm && <col />}
            {showBranch && <col style={{ width: 104 }} />}
            {showBy && <col style={{ width: 104 }} />}
            <col style={{ width: 136 }} />
          </colgroup>
          <thead>
            <tr>
              {showWhen && <th scope="col" className={`${th} text-left pl-2`} style={thTop}>When</th>}
              <th scope="col" className={`${th} text-left ${showWhen ? '' : 'pl-2'}`} style={thTop}>Voucher</th>
              {isSm && <th scope="col" className={`${th} text-left`} style={thTop}>What happened</th>}
              {showBranch && <th scope="col" className={`${th} text-left`} style={thTop}>{wordBranchCap()}</th>}
              {showBy && <th scope="col" className={`${th} text-left`} style={thTop}>By</th>}
              <th scope="col" className={`${th} text-right pr-3`} style={thTop}>Voucher value</th>
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
      )}

      {!loading && !error && filtered.length === 0 && (all.length === 0
        ? <EmptyBlock icon="Ticket" title="No voucher activity in this period" hint="Vouchers sold, given, redeemed and extended show up here." action={rangeId !== 'all' ? { label: 'Show all time', run: () => patch({ r: 'all', from: '', to: '' }) } : null} />
        : <EmptyBlock icon="Ticket" title="Nothing matches" hint={anyFilter ? 'Try a different search or clear a filter.' : ''} action={{ label: 'Clear filters', run: () => { setSearchText(''); patch({ q: '', kind: '', br: '', by: '', voucher: '' }); } }} />)}
      {!loading && !error && filtered.length > 0 && (
        <div className="flex items-center h-[52px] text-[12.5px] text-[#8A8A90] tabular-nums">{filtered.length} entr{filtered.length === 1 ? 'y' : 'ies'}</div>
      )}
      <p className="text-[12.5px] text-[#8A8A90] leading-relaxed">
        Amounts are voucher value, not money. Money taken shows on each sale (&quot;Paid …&quot;) and in the daily closing; a free voucher brings in nothing, and redeeming is never new income.
      </p>
    </div>
  );
};

export default VoucherActivityPanel;
