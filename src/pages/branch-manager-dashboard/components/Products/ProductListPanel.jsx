import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import ScrollRow from '../../../../components/ui/ScrollRow';
import { useSearchParams } from 'react-router-dom';
import Icon from '../../../../components/AppIcon';
import { FilterChip } from '../../../../components/ui/ListToolbarKit';
import {
  SORTS, STATUS, SEGMENTS, NEED_FILTERS, segmentById, stripStats, needsItems, sortProducts, matchesProductSearch, marginRange, sizesText, sizeCount, npr,
} from '../../../../services/productsView';
import NeedsYouNow from '../Bookings/NeedsYouNow';
import {
  useMinWidth, useSlashFocus, isTyping, useStickyBlock, thClass, LifecycleStrip, SearchBox, SortMenu, ClearableChip, StatusPill, MiniButton, csvDownload,
  EmptyBlock, ErrorBlock,
} from '../Area/listKit';
import { ProductThumb, Tag, StockMeter } from './productBits';
import { wordBranches } from '../../../../utils/industryTerms';

const uniqueOptions = (rows, pick) => {
  const seen = new Map();
  rows.forEach((p) => { const v = pick(p); if (v && !seen.has(v.id)) seen.set(v.id, v.label); });
  return [...seen].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
};

// Products (V25): lifecycle strip (In stock / Running low / Out / Not tracked / Off sale) → Needs you now → sticky toolbar + column headings →
// one row per product. Row click opens the product in the right-hand panel (page-level, `?open=`). List state lives in the URL.
// Managers/admins also see Supplier + Margin; staff see neither (and no cost anywhere).
const ProductListPanel = ({
  rows, catalog, error, onRetry, readOnly, canManage, canCost, canSell, isOverall, branchName, stickyTop, registerExport, onOpen, openId, onAction, sendFromIds = null,
}) => {
  const [sp, setSp] = useSearchParams();
  const isSm = useMinWidth(640);
  const isMd = useMinWidth(768);
  const isLg = useMinWidth(1024);
  const isXl = useMinWidth(1280);
  const here = isOverall ? `in all ${wordBranches()}` : `here`;

  const seg = segmentById(sp.get('seg')) ? sp.get('seg') : null;
  const query = sp.get('q') || '';
  const sort = SORTS[sp.get('sort')] ? sp.get('sort') : 'attention';
  const filters = { category: sp.get('category') || '', supplier: sp.get('supplier') || '', brand: sp.get('brand') || '' };
  const need = NEED_FILTERS[sp.get('need')] ? sp.get('need') : '';
  const spRef = useRef(sp);
  spRef.current = sp;
  const patch = useCallback((obj, { push = false } = {}) => {
    const next = new URLSearchParams(spRef.current);
    Object.entries(obj).forEach(([k, v]) => { if (v == null || v === '') next.delete(k); else next.set(k, String(v)); });
    spRef.current = next;
    setSp(next, { replace: !push });
  }, [setSp]);

  const [searchText, setSearchText] = React.useState(query);
  const searchRef = useRef(null);
  useEffect(() => {
    const t = setTimeout(() => { if (searchText !== query) patch({ q: searchText }); }, 200);
    return () => clearTimeout(t);
  }, [searchText]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSearchText(query); }, [query]);
  useSlashFocus(searchRef);

  const all = useMemo(() => rows || [], [rows]);
  const stats = useMemo(() => stripStats(all), [all]);
  const options = useMemo(() => ({
    category: uniqueOptions(all, (p) => (p.category ? { id: p.category, label: p.category } : null)),
    supplier: uniqueOptions(all, (p) => (p.supplierId ? { id: p.supplierId, label: p.supplierName || '—' } : null)),
    brand: uniqueOptions(all, (p) => (p.brand ? { id: p.brand, label: p.brand } : null)),
  }), [all]);
  const filtered = useMemo(() => {
    const segment = seg ? segmentById(seg) : null;
    const needF = need ? NEED_FILTERS[need] : null;
    const list = all.filter((p) => {
      if (segment && !segment.test(p)) return false;
      if (needF && !needF.test(p)) return false;
      if (filters.category && p.category !== filters.category) return false;
      if (filters.supplier && p.supplierId !== filters.supplier) return false;
      if (filters.brand && p.brand !== filters.brand) return false;
      return matchesProductSearch(p, query);
    });
    return sortProducts(list, sort);
  }, [all, seg, need, filters.category, filters.supplier, filters.brand, query, sort]);

  // Needs you now. Managers act (Receive / Move here); everyone else just narrows the list.
  const needs = useMemo(() => (isOverall ? [] : needsItems(all, { canManage, canSendFrom: (id) => !sendFromIds || sendFromIds.has(id) })), [all, canManage, isOverall, sendFromIds]);
  const needsActive = need;
  const onNeed = (id) => {
    if (!id) { patch({ need: '' }, { push: true }); return; }
    const it = needs.find((n) => n.id === id);
    if (id === 'out' && it?.product && canManage) { onAction('move', { product: it.product, from: it.from }); return; }
    if (id === 'low' && canManage) {
      const list = all.filter((p) => p.trackStock && p.isActive && NEED_FILTERS.low.test(p));
      if (list.length === 1) { onAction('receive', { product: list[0] }); return; }
    }
    patch({ need: id }, { push: true });
  };

  const rowAction = (p) => {
    if (readOnly) return null;
    if (canManage && !isOverall && p.trackStock && (p.status === 'low' || p.status === 'out')) return { label: 'Receive', primary: true, run: () => onAction('receive', { product: p }) };
    if (!canManage && canSell && !isOverall && p.isActive && p.sellAtCheckout && (!p.trackStock || p.stockHere > 0)) return { label: 'Sell', icon: 'ShoppingCart', run: () => onAction('sell', { product: p }) };
    return null;
  };

  const exportCsv = useCallback(() => {
    const head = ['Name', 'Brand', 'Size', 'Category', 'Barcode', 'SKU', 'Supplier', ...(canCost ? ['Cost'] : []), 'Retail price', 'Low at', 'Reorder qty', 'Stock'];
    const lines = [];
    filtered.forEach((p) => p.variants.forEach((v) => {
      lines.push([p.name, p.brand, v.name, p.category, v.barcode, v.sku, p.supplierName, ...(canCost ? [v.lastCost ?? v.avgCost ?? ''] : []), v.price, v.low ?? '', v.reorder ?? '', p.trackStock ? v.qty : '']);
    }));
    csvDownload(`products-${isOverall ? 'all-branches' : branchName || 'branch'}.csv`.toLowerCase().replace(/\s+/g, '-'), head, lines);
  }, [filtered, canCost, isOverall, branchName]);
  useEffect(() => { registerExport({ run: exportCsv, disabled: !rows || filtered.length === 0 }); }, [exportCsv, rows, filtered.length, registerExport]);
  useEffect(() => () => registerExport(null), [registerExport]);

  const { blockRef, sentinelRef, blockH, stuck, scrollToListTop } = useStickyBlock(stickyTop);
  const listKey = `${seg}|${need}|${query}|${sort}|${filters.category}|${filters.supplier}|${filters.brand}`;
  const firstKey = useRef(true);
  useEffect(() => {
    if (firstKey.current) { firstKey.current = false; return; }
    if (stuck) scrollToListTop();
  }, [listKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!openId) return undefined;
    const onKey = (e) => {
      if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || isTyping(e.target)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"], .z-modal-overlay')) return;
      const i = filtered.findIndex((p) => p.id === openId);
      const nxt = i < 0 ? null : filtered[i + (e.key === 'ArrowDown' ? 1 : -1)];
      if (!nxt) return;
      e.preventDefault();
      onOpen(nxt.id);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openId, filtered, onOpen]);
  useEffect(() => {
    if (openId) document.querySelector(`tr[data-product-id="${openId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [openId]);

  const loading = !rows && !error;
  const chipValue = (k) => options[k].find((o) => o.id === filters[k])?.label;
  const chips = (
    <>
      <FilterChip label="Category" value={filters.category} options={options.category} onChange={(v) => patch({ category: v })} selectedLabel={chipValue('category')} />
      {canCost && <FilterChip label="Supplier" value={filters.supplier} options={options.supplier} onChange={(v) => patch({ supplier: v })} selectedLabel={chipValue('supplier')} />}
      <FilterChip label="Brand" value={filters.brand} options={options.brand} onChange={(v) => patch({ brand: v })} selectedLabel={chipValue('brand')} />
      {need && <ClearableChip label={NEED_FILTERS[need].label} onClear={() => patch({ need: '' })} />}
    </>
  );
  const sortMenu = <SortMenu sorts={SORTS} value={sort} onChange={(id) => patch({ sort: id === 'attention' ? '' : id })} />;
  const searchBox = <SearchBox ref={searchRef} value={searchText} onChange={setSearchText} placeholder="Search product, brand or SKU" ariaLabel="Search products" />;
  const toolbar = isSm
    ? <div className="flex items-center gap-2 pt-3.5 pb-2 flex-wrap">{searchBox}{chips}<div className="ml-auto">{sortMenu}</div></div>
    : <div className="pt-2.5 pb-2">{searchBox}</div>;

  const showCategory = isLg;
  const showSupplier = isXl && canCost;
  const showPrice = isMd;
  const showMargin = isLg && canCost;
  const showStatus = isSm;
  const showActions = isLg;
  const colCount = 2 + (showCategory ? 1 : 0) + (showSupplier ? 1 : 0) + (showPrice ? 1 : 0) + (showMargin ? 1 : 0) + (showStatus ? 1 : 0);
  const th = thClass(stuck);
  const thTop = { top: stickyTop + blockH };
  const anyFilter = !!(query || filters.category || filters.supplier || filters.brand || need);
  const clearAll = () => { setSearchText(''); patch({ q: '', category: '', supplier: '', brand: '', need: '', seg: '' }, { push: true }); };

  let body = null;
  if (loading) {
    body = Array.from({ length: 7 }).map((_, i) => (
      <tr key={i}><td colSpan={colCount} className="h-[58px] border-b border-[#F1F1EF]"><div className="h-8 rounded bg-[#F1F1EF] animate-pulse" /></td></tr>
    ));
  } else if (!error) {
    body = filtered.map((p) => {
      const selected = p.id === openId;
      const action = showActions ? rowAction(p) : null;
      const n = sizeCount(p);
      const sub = [p.brand, sizesText(p)].filter(Boolean).join(' · ') || p.category || '';
      const w = p.weakest;
      const single = p.variants.filter((v) => v.active).length <= 1;
      const v0 = p.variants.find((v) => v.active) || p.variants[0];
      const meterQty = w ? w.qty : single ? (v0?.qty ?? 0) : p.stockHere;
      const meterLow = w ? w.low : single ? (v0?.low ?? null) : p.variants.reduce((s, v) => s + (v.active && v.low ? v.low : 0), 0) || null;
      const elsewhere = isOverall ? '' : p.othersTotal > 0 ? `+${p.othersTotal} at ${p.others.length === 1 ? p.others[0].name : `${p.others.length} branches`}` : 'none elsewhere';
      const stockSub = w && !single ? `${w.name || 'One size'} is low · ${w.qty} of ${w.low}` : elsewhere;
      const margin = canCost && p.sellAtCheckout ? marginRange(p.margins || []) : '—';
      return (
        <tr key={p.id} data-product-id={p.id} data-status={p.status} tabIndex={0} aria-selected={selected || undefined}
          onClick={() => onOpen(p.id)} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(p.id); }}
          style={{ scrollMarginTop: stickyTop + blockH + 40 }}
          className={`group cursor-pointer focus:outline-none ${selected ? 'bg-[#F2F6F0]' : 'hover:bg-[#FAFAF9] focus-visible:bg-[#FAFAF9]'}`}>
          <td className={`h-[58px] border-b border-[#F1F1EF] pr-3 ${selected ? 'shadow-[inset_3px_0_0_0_#2D5A27]' : ''}`}>
            <div className={`pl-2 flex items-center gap-3 min-w-0 ${!p.isActive ? 'opacity-[.55]' : ''}`}>
              <ProductThumb product={p} size={36} />
              <div className="min-w-0">
                <div className="font-medium text-[13.5px] tracking-[-0.1px] text-text-primary flex items-center gap-1.5 min-w-0">
                  <span className="truncate">{p.name}</span>
                  {p.proUse && <Tag>PRO USE</Tag>}
                  {n > 0 && <Tag>{n} SIZES</Tag>}
                  {!p.isActive && <Tag>OFF</Tag>}
                </div>
                <div className="text-[12.5px] text-[#8A8A90] mt-0.5 truncate">{sub || '—'}{!showCategory && p.category ? ` · ${p.category}` : ''}</div>
              </div>
            </div>
          </td>
          {showCategory && <td className="h-[58px] border-b border-[#F1F1EF] pr-3 text-[13px] text-text-primary truncate">{p.category || '—'}</td>}
          {showSupplier && <td className="h-[58px] border-b border-[#F1F1EF] pr-3 text-[13px] text-text-primary truncate">{p.supplierName || '—'}</td>}
          <td className="h-[58px] border-b border-[#F1F1EF] pr-3">
            {!p.trackStock ? <span className="text-[13px] text-[#8A8A90]">Not counted</span> : (
              <div className="flex flex-col gap-1">
                <div className="text-[13px] text-text-primary tabular-nums whitespace-nowrap truncate" data-stock>
                  <b className={`font-semibold ${p.status === 'out' ? 'text-[#991B1B]' : p.status === 'low' ? 'text-[#B45309]' : ''}`}>{p.stockHere}</b>{' '}
                  <span className="text-[#8A8A90]">
                    {single ? `left${meterLow != null ? ` · low at ${meterLow}` : ''}${isOverall ? ' in total' : ''}` : `left in ${p.variants.filter((v) => v.active).length} sizes`}
                  </span>
                </div>
                <StockMeter qty={meterQty} low={meterLow} status={p.status} width={isSm ? 150 : 100} />
                <div className="text-[12px] text-[#8A8A90] tabular-nums truncate">{stockSub}</div>
              </div>
            )}
          </td>
          {showPrice && (
            <td className="h-[58px] border-b border-[#F1F1EF] pr-3 text-right text-[13px] tabular-nums whitespace-nowrap">
              {!p.sellAtCheckout ? <span className="text-[#8A8A90]">Not sold</span> : <>{p.priceVaries && <span className="text-[#8A8A90]">from </span>}<span className="text-text-primary">{npr(p.priceFrom)}</span></>}
            </td>
          )}
          {showMargin && <td className="h-[58px] border-b border-[#F1F1EF] pr-3 text-right text-[13px] tabular-nums text-text-primary whitespace-nowrap">{margin}</td>}
          {showStatus && (
            <td className="h-[58px] border-b border-[#F1F1EF] pl-2">
              <div className="flex items-center gap-2 justify-start">
                <StatusPill status={p.status} config={STATUS} />
                {action && (
                  <span className={`${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'} transition-opacity`}>
                    <MiniButton primary={!!action.primary} icon={action.icon ? <Icon name={action.icon} size={13} /> : <Icon name="Download" size={13} />} data-row-action={action.label}
                      onClick={(e) => { e.stopPropagation(); action.run(); }}>{action.label}</MiniButton>
                  </span>
                )}
              </div>
            </td>
          )}
          <td className="h-[58px] border-b border-[#F1F1EF] pr-1 text-[#8A8A90]"><Icon name="ChevronRight" size={15} /></td>
        </tr>
      );
    });
  }

  return (
    <div>
      <LifecycleStrip segments={SEGMENTS} stats={stats} selected={seg} loading={loading} ariaLabel="Stock status"
        onPick={(id, on) => patch({ seg: on ? '' : id, need: '' }, { push: true })} />
      {!loading && !error && !isOverall && needs.length > 0 && (
        <div className="mt-3 -mb-3"><NeedsYouNow items={needs} active={needsActive} onPick={onNeed} tailText="Everything else is stocked" emptyText="Everything is stocked" /></div>
      )}
      {!loading && !error && !isOverall && needs.length === 0 && all.some((p) => p.trackStock) && (
        <div className="mt-3 -mb-3"><NeedsYouNow items={[]} active="" onPick={onNeed} emptyText="Everything is stocked" /></div>
      )}
      <div ref={sentinelRef} aria-hidden="true" className="h-px mt-0.5" />
      <div ref={blockRef} className="sticky z-sticky-filter bg-white" style={{ top: stickyTop }}>{toolbar}</div>
      {!isSm && <ScrollRow className="pb-2" wrapperClassName="pb-0">{chips}{sortMenu}</ScrollRow>}

      {error ? <ErrorBlock error={error} onRetry={onRetry} /> : (
        <table className="w-full border-collapse table-fixed">
          <colgroup>
            <col />
            {showCategory && <col style={{ width: '12%' }} />}
            {showSupplier && <col style={{ width: '13%' }} />}
            <col style={{ width: isSm ? 190 : 130 }} />
            {showPrice && <col style={{ width: 128 }} />}
            {showMargin && <col style={{ width: 84 }} />}
            {showStatus && <col style={{ width: showActions ? 196 : 132 }} />}
            <col style={{ width: 28 }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className={`${th} text-left pl-2`} style={thTop}>Product</th>
              {showCategory && <th scope="col" className={`${th} text-left`} style={thTop}>Category</th>}
              {showSupplier && <th scope="col" className={`${th} text-left`} style={thTop}>Supplier</th>}
              <th scope="col" className={`${th} text-left`} style={thTop}>In stock {here}</th>
              {showPrice && <th scope="col" className={`${th} text-right pr-3`} style={thTop}>Retail price</th>}
              {showMargin && <th scope="col" className={`${th} text-right pr-3`} style={thTop}>Margin</th>}
              {showStatus && <th scope="col" className={`${th} text-left pl-2`} style={thTop}>Status</th>}
              <th scope="col" className={th} style={thTop}><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
      )}

      {!loading && !error && filtered.length === 0 && (all.length === 0
        ? <EmptyBlock icon="Package" title="Nothing here yet" hint={canManage ? 'Add the first one with New product, or bring a list in with Import.' : 'Products appear here once a manager adds them.'} />
        : <EmptyBlock icon="Package" title="No products match" hint={anyFilter ? 'Try a different search or clear a filter.' : `Nothing is in “${segmentById(seg)?.label}” right now.`} action={{ label: 'Clear filters', run: clearAll }} />)}
      {!loading && !error && filtered.length > 0 && (
        <div className="flex items-center h-[52px] text-[12.5px] text-[#8A8A90] tabular-nums">
          {filtered.length} product{filtered.length === 1 ? '' : 's'}
          {canManage && !isOverall && <span className="ml-1">· Selling and refunds update stock by themselves; everything else is Receive, Remove, Move or Count.</span>}
        </div>
      )}
    </div>
  );
};

export default ProductListPanel;
