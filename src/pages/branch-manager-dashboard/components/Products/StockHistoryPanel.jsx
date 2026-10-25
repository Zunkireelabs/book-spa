import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '../../../../components/AppIcon';
import { FilterChip, Menu } from '../../../../components/ui/ListToolbarKit';
import { useIndustry } from '../../../../hooks/useIndustry';
import { fetchStockMovements } from '../../../../services/api';
import {
  REASONS, reasonLabel, monthBounds, monthLabel, monthName, recentMonths, movementTotals, movementLeadParts, whenLabel, nepalDate, nepalTime, npr,
} from '../../../../services/productsView';
import { friendlyError } from '../../../../utils/friendlyError';
import { useMinWidth, useSlashFocus, useStickyBlock, thClass, SearchBox, csvDownload, EmptyBlock, ErrorBlock } from '../Area/listKit';

// Stock history (V25): the one ledger. One row per change: when, product + size, ±change, reason, by, details, left after. Read-only;
// a mistake is fixed with a new "Count corrected" line. One month at a time (branch = the page's branch). Managers/admins/viewers only.
const StockHistoryPanel = ({ catalog, branchId, branchName, isOverall, today, canCost, stickyTop, registerExport, onLead, refreshKey }) => {
  const { sessionLabel, sessionLabelPlural } = useIndustry();
  const [sp, setSp] = useSearchParams();
  const isSm = useMinWidth(640);
  const isMd = useMinWidth(768);
  const month = /^\d{4}-\d{2}$/.test(sp.get('m') || '') ? sp.get('m') : today.slice(0, 7);
  const reason = REASONS[sp.get('reason')] ? sp.get('reason') : '';
  const productId = sp.get('product') || '';
  const who = sp.get('who') || '';
  const query = sp.get('q') || '';
  const spRef = useRef(sp);
  spRef.current = sp;
  const patch = useCallback((obj, { push = false } = {}) => {
    const next = new URLSearchParams(spRef.current);
    Object.entries(obj).forEach(([k, v]) => { if (v == null || v === '') next.delete(k); else next.set(k, String(v)); });
    spRef.current = next;
    setSp(next, { replace: !push });
  }, [setSp]);

  const [moves, setMoves] = useState(null);
  const [error, setError] = useState(null);
  const [searchText, setSearchText] = useState(query);
  const searchRef = useRef(null);
  useEffect(() => { const t = setTimeout(() => { if (searchText !== query) patch({ q: searchText }); }, 200); return () => clearTimeout(t); }, [searchText]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSearchText(query); }, [query]);
  useSlashFocus(searchRef);

  const load = useCallback(async () => {
    const [from, to] = monthBounds(month);
    const { data, error: err } = await fetchStockMovements({ branchId: isOverall ? null : branchId, from, to, limit: 2000 });
    if (err) { setError(friendlyError(err, 'Could not load the stock history.')); setMoves([]); return; }
    setError(null);
    setMoves(data || []);
  }, [month, branchId, isOverall]);
  useEffect(() => { setMoves(null); load(); }, [load, refreshKey]);

  const branchLabel = isOverall ? 'across all branches' : `at ${branchName}`;
  const totals = useMemo(() => movementTotals(moves || []), [moves]);
  useEffect(() => {
    if (!moves) { onLead(' '); return; }
    onLead(movementLeadParts(totals, { branchLabel, monthName: monthName(month), sessionsLabel: sessionLabelPlural.toLowerCase(), canCost }));
  }, [moves, totals, branchLabel, month, sessionLabelPlural, canCost, onLead]);

  const options = useMemo(() => ({
    reason: Object.keys(REASONS).map((id) => ({ id, label: reasonLabel(id, { sessionLabel }) })),
    product: [...new Map((moves || []).map((m) => [m.productId, m.productName])).entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)),
    who: [...new Map((moves || []).filter((m) => m.performedBy).map((m) => [m.performedBy, m.byName || '—'])).entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)),
  }), [moves, sessionLabel]);
  // A product filter that came from the product panel ("See all") must stay selectable even when it has no rows this month.
  const productOptions = productId && !options.product.some((o) => o.id === productId)
    ? [{ id: productId, label: catalog.products.find((p) => p.id === productId)?.name || 'Product' }, ...options.product] : options.product;

  const filtered = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return (moves || []).filter((m) => {
      if (reason && m.reason !== reason) return false;
      if (productId && m.productId !== productId) return false;
      if (who && m.performedBy !== who) return false;
      if (!words.length) return true;
      const hay = `${m.productName} ${m.variantName} ${m.sku} ${m.note} ${m.customerName} ${m.supplierName} ${m.byName}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [moves, reason, productId, who, query]);

  const branchOf = (id) => catalog.branches.find((b) => b.id === id)?.name || '';
  const detailsOf = (m) => {
    if (m.reason === 'sale' || m.reason === 'refund') return [m.customerName || 'Walk-in', m.paymentMode, m.note && m.reason === 'refund' ? `“${m.note}”` : ''].filter(Boolean).join(' · ');
    if (m.reason === 'transfer_out') return `To ${branchOf(m.toBranchId)}${m.note ? ` · “${m.note}”` : ''}`;
    if (m.reason === 'transfer_in') return `From ${branchOf(m.fromBranchId)}${m.note ? ` · “${m.note}”` : ''}`;
    if (m.reason === 'received' || m.reason === 'import_opening') {
      return [m.supplierName, m.note, canCost && m.unitCost != null ? `${npr(m.unitCost)} each` : ''].filter(Boolean).join(' · ');
    }
    return m.note ? `“${m.note}”` : '';
  };
  const reasonText = (m) => {
    if (m.reason === 'transfer_out') return `Moved to ${branchOf(m.toBranchId) || '…'}`;
    if (m.reason === 'transfer_in') return `Moved from ${branchOf(m.fromBranchId) || '…'}`;
    return reasonLabel(m.reason, { sessionLabel });
  };

  const exportCsv = useCallback(() => {
    csvDownload(`stock-history-${month}.csv`, ['Date', 'Time', 'Branch', 'Product', 'Size', 'Change', 'Reason', 'By', 'Details', 'Left after'],
      filtered.map((m) => [nepalDate(m.createdAt), nepalTime(m.createdAt), m.branchName, m.productName, m.variantName, m.delta, reasonText(m), m.byName, detailsOf(m), m.qtyAfter]));
  }, [filtered, month]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { registerExport({ run: exportCsv, disabled: !moves || filtered.length === 0 }); }, [exportCsv, moves, filtered.length, registerExport]);
  useEffect(() => () => registerExport(null), [registerExport]);

  const { blockRef, sentinelRef, blockH, stuck } = useStickyBlock(stickyTop);
  const months = recentMonths(today, 12);
  const loading = !moves && !error;
  const th = thClass(stuck);
  const thTop = { top: stickyTop + blockH };
  const colCount = 3 + (isSm ? 1 : 0) + (isMd ? 2 : 0) + 1;
  const anyFilter = !!(reason || productId || who || query);

  const monthMenu = (
    <Menu trigger={(open, toggle) => (
      <button type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} data-month
        className="h-[34px] px-3 rounded-[7px] border border-border bg-white text-[13px] font-medium inline-flex items-center gap-2 hover:bg-[#FAFAF9] whitespace-nowrap">
        <Icon name="Calendar" size={14} className="text-[#8A8A90]" />{monthLabel(month)}<Icon name="ChevronDown" size={13} className="text-[#8A8A90]" />
      </button>)}>
      {(close) => (
        <div className="min-w-[190px] max-h-72 overflow-y-auto">
          {months.map((k) => (
            <button key={k} type="button" onClick={() => { patch({ m: k === today.slice(0, 7) ? '' : k }); close(); }} className={`w-full text-left px-3 py-1.5 text-[13px] hover:bg-[#FAFAF9] flex justify-between ${k === month ? 'font-medium' : ''}`}>
              {monthLabel(k)}{k === month && <Icon name="Check" size={13} />}
            </button>
          ))}
        </div>
      )}
    </Menu>
  );
  const label = (list, id) => list.find((o) => o.id === id)?.label;
  const toolbar = (
    <div className="flex items-center gap-2 pt-3.5 pb-2 flex-wrap">
      <SearchBox ref={searchRef} value={searchText} onChange={setSearchText} placeholder="Search product, note or customer" ariaLabel="Search stock history" />
      <FilterChip label="Reason" value={reason} options={options.reason} onChange={(v) => patch({ reason: v })} selectedLabel={label(options.reason, reason)} />
      <FilterChip label="Product" value={productId} options={productOptions} onChange={(v) => patch({ product: v })} selectedLabel={label(productOptions, productId)} />
      <FilterChip label="Who" value={who} options={options.who} onChange={(v) => patch({ who: v })} selectedLabel={label(options.who, who)} />
      <div className="ml-auto">{monthMenu}</div>
    </div>
  );

  return (
    <div>
      <div ref={sentinelRef} aria-hidden="true" className="h-px mt-0.5" />
      <div ref={blockRef} className="sticky z-sticky-filter bg-white" style={{ top: stickyTop }}>{toolbar}</div>
      {error ? <ErrorBlock error={error} onRetry={load} /> : (
        <table className="w-full border-collapse table-fixed">
          <colgroup>
            <col style={{ width: 92 }} /><col />
            <col style={{ width: 70 }} />
            {isSm && <col style={{ width: 170 }} />}
            {isMd && <col style={{ width: 110 }} />}
            {isMd && <col style={{ width: '28%' }} />}
            <col style={{ width: 76 }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className={`${th} text-left pl-2`} style={thTop}>When</th>
              <th scope="col" className={`${th} text-left`} style={thTop}>Product</th>
              <th scope="col" className={`${th} text-right pr-3`} style={thTop}>Change</th>
              {isSm && <th scope="col" className={`${th} text-left`} style={thTop}>Reason</th>}
              {isMd && <th scope="col" className={`${th} text-left`} style={thTop}>By</th>}
              {isMd && <th scope="col" className={`${th} text-left`} style={thTop}>Details</th>}
              <th scope="col" className={`${th} text-right pr-2`} style={thTop}>Left after</th>
            </tr>
          </thead>
          <tbody>
            {loading ? Array.from({ length: 6 }).map((_, i) => <tr key={i}><td colSpan={colCount} className="h-[58px] border-b border-[#F1F1EF]"><div className="h-8 rounded bg-[#F1F1EF] animate-pulse" /></td></tr>)
              : filtered.map((m) => (
                <tr key={m.id} data-movement={m.reason}>
                  <td className="h-[58px] border-b border-[#F1F1EF] pl-2 align-middle">
                    <div className="text-[13px] font-medium text-text-primary tabular-nums">{whenLabel(m.createdAt, today)}</div>
                    <div className="text-[12.5px] text-[#8A8A90] tabular-nums">{nepalTime(m.createdAt)}</div>
                  </td>
                  <td className="h-[58px] border-b border-[#F1F1EF] pr-3 align-middle min-w-0">
                    <div className="text-[13.5px] font-medium text-text-primary truncate">{m.productName}</div>
                    <div className="text-[12.5px] text-[#8A8A90] truncate">{[m.variantName, isOverall ? m.branchName : ''].filter(Boolean).join(' · ') || '—'}{!isSm ? ` · ${reasonText(m)}` : ''}</div>
                  </td>
                  <td className={`h-[58px] border-b border-[#F1F1EF] pr-3 text-right text-[14px] font-semibold tabular-nums ${m.delta > 0 ? 'text-[#15803D]' : 'text-text-primary'}`}>{m.delta > 0 ? '+' : '−'}{Math.abs(m.delta)}</td>
                  {isSm && (
                    <td className="h-[58px] border-b border-[#F1F1EF] pr-3">
                      <span className={`h-[22px] rounded-md px-2 text-[11.5px] font-medium inline-flex items-center whitespace-nowrap ${REASONS[m.reason]?.pill || ''}`}>{reasonText(m)}</span>
                    </td>
                  )}
                  {isMd && <td className="h-[58px] border-b border-[#F1F1EF] pr-3 text-[13px] text-text-primary truncate">{m.byName || '—'}</td>}
                  {isMd && <td className="h-[58px] border-b border-[#F1F1EF] pr-3 text-[13px] text-text-primary truncate">{detailsOf(m)}</td>}
                  <td className="h-[58px] border-b border-[#F1F1EF] pr-2 text-right text-[13px] tabular-nums text-text-primary">{m.qtyAfter}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
      {!loading && !error && filtered.length === 0 && (
        <EmptyBlock icon="ClipboardList" title={moves.length === 0 ? `No stock changes in ${monthLabel(month)}` : 'No changes match'}
          hint={moves.length === 0 ? 'Receiving, selling, moving and counting all show up here.' : 'Try a different search or clear a filter.'}
          action={anyFilter ? { label: 'Clear filters', run: () => { setSearchText(''); patch({ q: '', reason: '', product: '', who: '' }, { push: true }); } } : null} />
      )}
      {!loading && !error && filtered.length > 0 && (
        <p className="text-[12.5px] text-[#8A8A90] py-4">Every change to stock is listed here, with who made it and why. Nothing can be edited or deleted; a mistake is fixed with a new “Count corrected” line.</p>
      )}
    </div>
  );
};

export default StockHistoryPanel;
