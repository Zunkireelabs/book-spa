import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import { fetchSupplierLastReceived } from '../../../../services/api';
import { npr } from '../../../../services/productsView';
import { useMinWidth, useSlashFocus, useStickyBlock, thClass, SearchBox, Avatar, shortDate, csvDownload, EmptyBlock, ErrorBlock, PrimaryButton } from '../Area/listKit';

// Suppliers (V25): who you buy from, how many products they supply, what that stock is worth here at cost, and when you last received
// from them. Row click opens the supplier panel. Managers/admins/viewers only.
const SuppliersPanel = ({ catalog, rows, today, isOverall, canManage, stickyTop, registerExport, onOpen, onNew, refreshKey, error, onRetry }) => {
  const isSm = useMinWidth(640);
  const isMd = useMinWidth(768);
  const [query, setQuery] = useState('');
  const [last, setLast] = useState(null);
  const searchRef = useRef(null);
  useSlashFocus(searchRef);
  useEffect(() => {
    let live = true;
    fetchSupplierLastReceived().then(({ data }) => { if (live) setLast(data || {}); });
    return () => { live = false; };
  }, [refreshKey]);

  const list = useMemo(() => {
    const by = new Map();
    rows.forEach((p) => { if (p.supplierId) { const e = by.get(p.supplierId) || { n: 0, value: 0 }; e.n += 1; e.value += p.stockValue || 0; by.set(p.supplierId, e); } });
    const q = query.trim().toLowerCase();
    return catalog.suppliers.map((s) => ({
      id: s.id, name: s.name, contactName: s.contact_name || '', phone: s.phone || '', email: s.email || '', notes: s.notes || '', isActive: s.is_active !== false,
      products: by.get(s.id)?.n || 0, value: by.get(s.id)?.value || 0, lastReceived: last?.[s.id] || null,
    })).filter((s) => !q || `${s.name} ${s.contactName} ${s.phone}`.toLowerCase().includes(q))
      .sort((a, b) => (Number(b.isActive) - Number(a.isActive)) || a.name.localeCompare(b.name));
  }, [catalog.suppliers, rows, last, query]);

  const exportCsv = useCallback(() => {
    csvDownload('suppliers.csv', ['Supplier', 'Contact', 'Phone', 'Email', 'Products', 'Stock value at cost', 'Last received', 'Active'],
      list.map((s) => [s.name, s.contactName, s.phone, s.email, s.products, s.value, s.lastReceived ? s.lastReceived.slice(0, 10) : '', s.isActive ? 'Yes' : 'No']));
  }, [list]);
  useEffect(() => { registerExport({ run: exportCsv, disabled: list.length === 0 }); }, [exportCsv, list.length, registerExport]);
  useEffect(() => () => registerExport(null), [registerExport]);

  const { blockRef, sentinelRef, blockH, stuck } = useStickyBlock(stickyTop);
  const th = thClass(stuck);
  const thTop = { top: stickyTop + blockH };
  const sub = (s) => [s.contactName, s.phone].filter(Boolean).join(' · ') || s.email || '—';

  return (
    <div>
      <div ref={sentinelRef} aria-hidden="true" className="h-px mt-0.5" />
      <div ref={blockRef} className="sticky z-sticky-filter bg-white" style={{ top: stickyTop }}>
        <div className="flex items-center gap-2 pt-3.5 pb-2 flex-wrap">
          <SearchBox ref={searchRef} value={query} onChange={setQuery} placeholder="Search supplier" ariaLabel="Search suppliers" />
          {canManage && <div className="ml-auto"><PrimaryButton icon="Plus" onClick={onNew} data-new-supplier>New supplier</PrimaryButton></div>}
        </div>
      </div>
      {error ? <ErrorBlock error={error} onRetry={onRetry} /> : (
        <table className="w-full border-collapse table-fixed">
          <colgroup>
            <col />{isSm && <col style={{ width: 100 }} />}{isMd && <col style={{ width: 170 }} />}{isMd && <col style={{ width: 130 }} />}<col style={{ width: 28 }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className={`${th} text-left pl-2`} style={thTop}>Supplier</th>
              {isSm && <th scope="col" className={`${th} text-right pr-3`} style={thTop}>Products</th>}
              {isMd && <th scope="col" className={`${th} text-right pr-3`} style={thTop}>Stock {isOverall ? '' : 'here, '}at cost</th>}
              {isMd && <th scope="col" className={`${th} text-right pr-3`} style={thTop}>Last received</th>}
              <th scope="col" className={th} style={thTop}><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id} data-supplier-id={s.id} tabIndex={0} onClick={() => onOpen(s.id)} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(s.id); }}
                className="cursor-pointer hover:bg-[#FAFAF9] focus:outline-none focus-visible:bg-[#FAFAF9]">
                <td className="h-[58px] border-b border-[#F1F1EF] pl-2 pr-3">
                  <div className={`flex items-center gap-3 min-w-0 ${s.isActive ? '' : 'opacity-[.55]'}`}>
                    <Avatar name={s.name} size={32} />
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-medium text-text-primary truncate">{s.name}{!s.isActive && <span className="ml-2 text-[11px] text-[#8A8A90] font-normal">Inactive</span>}</div>
                      <div className="text-[12.5px] text-[#8A8A90] truncate">{sub(s)}</div>
                    </div>
                  </div>
                </td>
                {isSm && <td className="h-[58px] border-b border-[#F1F1EF] pr-3 text-right text-[13px] tabular-nums">{s.products}</td>}
                {isMd && <td className="h-[58px] border-b border-[#F1F1EF] pr-3 text-right text-[13px] tabular-nums">{s.products ? npr(s.value) : '—'}</td>}
                {isMd && <td className="h-[58px] border-b border-[#F1F1EF] pr-3 text-right text-[13px] tabular-nums text-[#515152]">{s.lastReceived ? shortDate(s.lastReceived, today) : '—'}</td>}
                <td className="h-[58px] border-b border-[#F1F1EF] pr-1 text-[#8A8A90]"><Icon name="ChevronRight" size={15} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!error && list.length === 0 && (catalog.suppliers.length === 0
        ? <EmptyBlock icon="Truck" title="No suppliers yet" hint={canManage ? 'Add who you buy from, then pick them when you receive stock.' : 'Suppliers appear here once a manager adds them.'} action={canManage ? { label: 'New supplier', run: onNew } : null} />
        : <EmptyBlock icon="Truck" title="No suppliers match" hint="Try a different search." action={{ label: 'Clear search', run: () => setQuery('') }} />)}
      {!error && list.length > 0 && <p className="text-[12.5px] text-[#8A8A90] py-4">Stock orders to suppliers (order, then receive in part or in full) come next.</p>}
    </div>
  );
};

export default SuppliersPanel;
