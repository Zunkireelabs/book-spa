import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import { FilterChip } from '../../../../components/ui/ListToolbarKit';
import { setVoucherTypeActive } from '../../../../services/api';
import { typeStats, handedOutSub, npr } from '../../../../services/vouchersView';
import { categoryLabel } from '../../../../services/membershipsView';
import { friendlyError } from '../../../../utils/friendlyError';
import { useMinWidth, useSlashFocus, useStickyBlock, thClass, SearchBox, MiniButton, RowSwitch, csvDownload, EmptyBlock, ErrorBlock } from '../Area/listKit';
import { KindTag } from './voucherBits';

const isCouponType = (t) => t.percent_off != null;
const KIND_OPTIONS = [{ id: 'value', label: 'Money or service value' }, { id: 'coupon', label: '% off coupon' }];

// Voucher types (V23): worth, "usually" sold or given free, what member discount it counts as, how many were handed out, what is
// still owed on them, and On sale. Admins edit a type in the side panel (row click) and switch it on/off in the row; everyone
// else reads. Sell / Give opens New voucher with that type.
const VoucherTypesPanel = ({ vouchers, types, today, error, onRetry, onChanged, readOnly, isAdmin, stickyTop, registerExport, notify, onIssue, onEditType }) => {
  const isSm = useMinWidth(640);
  const isMd = useMinWidth(768);
  const isLg = useMinWidth(1024);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('');
  const [cat, setCat] = useState('');
  const [busy, setBusy] = useState(null);
  const searchRef = useRef(null);
  useSlashFocus(searchRef);
  const { blockRef, sentinelRef, blockH, stuck } = useStickyBlock(stickyTop);

  const stats = useMemo(() => typeStats(vouchers || [], today), [vouchers, today]);
  const cats = useMemo(() => [...new Set((types || []).map((t) => t.category))].map((id) => ({ id, label: categoryLabel(id) })), [types]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (types || []).filter((t) => (!kind || (kind === 'coupon') === isCouponType(t)) && (!cat || t.category === cat)
      && (!q || `${t.name} ${t.code_prefix}`.toLowerCase().includes(q)))
      .sort((a, b) => Number(b.is_active) - Number(a.is_active) || (Number(a.display_order) || 0) - (Number(b.display_order) || 0) || a.name.localeCompare(b.name));
  }, [types, query, kind, cat]);

  const toggle = async (t, on) => {
    setBusy(t.id);
    const { error: err } = await setVoucherTypeActive({ id: t.id, isActive: on });
    setBusy(null);
    if (err) { notify(friendlyError(err, 'Could not change the type.'), 'error'); return; }
    notify(on ? `${t.name} is on sale` : `${t.name} is off sale`);
    onChanged();
  };

  const exportCsv = useCallback(() => {
    csvDownload(`voucher-types-${today}.csv`, ['Type', 'Code prefix', 'Worth', '% off', 'Usually', 'Counts as', 'Handed out', 'Sold', 'Given free', 'Still owed', 'Open coupons', 'On sale'],
      rows.map((t) => { const s = stats[t.id] || {}; return [t.name, t.code_prefix, isCouponType(t) ? '' : t.standard_price, isCouponType(t) ? t.percent_off : '', t.default_issue_kind === 'free' ? 'Given free' : 'Sold', categoryLabel(t.category), s.total || 0, s.sold || 0, s.free || 0, s.owed || 0, s.openCoupons || 0, t.is_active ? 'Yes' : 'No']; }));
  }, [rows, stats, today]);
  useEffect(() => { registerExport({ run: exportCsv, disabled: !types || rows.length === 0 }); }, [exportCsv, types, rows.length, registerExport]);
  useEffect(() => () => registerExport(null), [registerExport]);

  const loading = !types && !error;
  const th = thClass(stuck);
  const thTop = { top: stickyTop + blockH };
  const colCount = 3 + (isMd ? 1 : 0) + (isLg ? 2 : 0) + (isSm ? 1 : 0) + 1;

  return (
    <div>
      <div ref={sentinelRef} aria-hidden="true" className="h-px" />
      <div ref={blockRef} className="sticky z-sticky-filter bg-white" style={{ top: stickyTop }}>
        <div className="flex items-center gap-2 pt-[18px] pb-2 flex-wrap">
          <SearchBox ref={searchRef} value={query} onChange={setQuery} placeholder="Search voucher types" ariaLabel="Search voucher types" />
          {isSm && <FilterChip label="Kind" value={kind} options={KIND_OPTIONS} onChange={setKind} selectedLabel={KIND_OPTIONS.find((o) => o.id === kind)?.label} />}
          {isSm && <FilterChip label="Counts as" value={cat} options={cats} onChange={setCat} selectedLabel={cats.find((o) => o.id === cat)?.label} />}
          {isAdmin && !readOnly && (
            <button type="button" onClick={() => onEditType(null)} className="ml-auto h-8 px-3 rounded-md border border-border bg-white text-[13px] font-medium inline-flex items-center gap-1.5 hover:bg-[#FAFAF9]" data-new-type>
              <Icon name="Plus" size={14} />New voucher type
            </button>
          )}
        </div>
      </div>

      {error ? <ErrorBlock error={error} onRetry={onRetry} /> : (
        <table className="w-full border-collapse table-fixed">
          <colgroup>
            <col />
            <col style={{ width: isSm ? 116 : 96 }} />
            {isMd && <col style={{ width: 112 }} />}
            {isLg && <col style={{ width: 96 }} />}
            <col style={{ width: isSm ? 130 : 96 }} />
            {isLg && <col style={{ width: 130 }} />}
            {isSm && <col style={{ width: 84 }} />}
            <col style={{ width: isLg && !readOnly ? 84 : 28 }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className={`${th} text-left pl-2`} style={thTop}>Voucher type</th>
              <th scope="col" className={`${th} text-left`} style={thTop}>Worth</th>
              {isMd && <th scope="col" className={`${th} text-left`} style={thTop}>Usually</th>}
              {isLg && <th scope="col" className={`${th} text-left`} style={thTop}>Counts as</th>}
              <th scope="col" className={`${th} text-right pr-3`} style={thTop}>Handed out</th>
              {isLg && <th scope="col" className={`${th} text-right pr-3`} style={thTop}>Still owed</th>}
              {isSm && <th scope="col" className={`${th} text-left pl-4`} style={thTop}>On sale</th>}
              <th scope="col" className={th} style={thTop}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {loading && Array.from({ length: 6 }).map((_, i) => (
              <tr key={i}><td colSpan={colCount} className="h-[58px] border-b border-[#F1F1EF]"><div className="h-8 rounded bg-[#F1F1EF] animate-pulse" /></td></tr>
            ))}
            {!loading && rows.map((t) => {
              const s = stats[t.id];
              const coupon = isCouponType(t);
              const fade = t.is_active ? '' : 'opacity-[.55]';
              const usuallyFree = t.default_issue_kind === 'free';
              const canIssue = !readOnly && t.is_active; // this page is manager / admin (+ read-only viewer), who can sell and give
              const open = () => { if (isAdmin && !readOnly) onEditType(t); };
              return (
                <tr key={t.id} data-type-id={t.id} tabIndex={isAdmin && !readOnly ? 0 : -1} onClick={open} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) open(); }}
                  className={`group ${isAdmin && !readOnly ? 'cursor-pointer' : ''} hover:bg-[#FAFAF9] focus:outline-none focus-visible:bg-[#FAFAF9]`}>
                  <td className="h-[58px] border-b border-[#F1F1EF] pr-3">
                    <div className={`pl-2 min-w-0 ${fade}`}>
                      <div className="font-medium text-[13.5px] text-text-primary flex items-center gap-1.5 min-w-0"><span className="truncate">{t.name}</span>{coupon && <KindTag kind="coupon" />}</div>
                      <div className="text-[12.5px] text-[#8A8A90] mt-0.5 truncate">Codes <span className="font-data">{t.code_prefix}-0001…</span></div>
                    </div>
                  </td>
                  <td className={`h-[58px] border-b border-[#F1F1EF] pr-3 text-[13px] font-semibold tabular-nums whitespace-nowrap ${fade}`}>
                    {coupon ? <><span className="text-[#4338CA]">{Number(t.percent_off)}% off</span><div className="text-[12.5px] text-[#8A8A90] font-normal">one visit</div></> : npr(t.standard_price)}
                  </td>
                  {isMd && <td className={`h-[58px] border-b border-[#F1F1EF] pr-3 ${fade}`}>{usuallyFree ? <KindTag kind="givenFree" /> : <span className="text-[13px] text-[#515152]">Sold</span>}</td>}
                  {isLg && <td className={`h-[58px] border-b border-[#F1F1EF] pr-3 text-[13px] text-[#515152] ${fade}`}>{t.category === 'package' ? 'Package' : categoryLabel(t.category)}</td>}
                  <td className={`h-[58px] border-b border-[#F1F1EF] pr-3 text-right ${fade}`}>
                    <div className="text-[13px] font-medium tabular-nums">{s?.total || 0}</div>
                    <div className="text-[12.5px] text-[#8A8A90] tabular-nums truncate">{handedOutSub(s)}</div>
                  </td>
                  {isLg && (
                    <td className={`h-[58px] border-b border-[#F1F1EF] pr-3 text-right text-[13px] font-medium tabular-nums whitespace-nowrap ${fade}`} data-owed>
                      {coupon ? (s?.openCoupons ? `${s.openCoupons} coupon${s.openCoupons === 1 ? '' : 's'} open` : <span className="text-[#B4B4BA]">—</span>)
                        : s?.owed ? npr(s.owed) : <span className="text-[#B4B4BA]">—</span>}
                    </td>
                  )}
                  {isSm && (
                    <td className="h-[58px] border-b border-[#F1F1EF] pl-4">
                      {isAdmin && !readOnly
                        ? <RowSwitch checked={!!t.is_active} onChange={(on) => toggle(t, on)} label={`${t.name} on sale`} busy={busy === t.id} />
                        : <span className="text-[13px] text-[#515152]">{t.is_active ? 'On sale' : 'Off'}</span>}
                    </td>
                  )}
                  <td className="h-[58px] border-b border-[#F1F1EF] pr-1">
                    <div className="flex gap-1.5 justify-end items-center text-[#8A8A90]">
                      {isLg && canIssue && (
                        <span className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                          <MiniButton primary data-row-action={usuallyFree ? 'Give' : 'Sell'} onClick={(e) => { e.stopPropagation(); onIssue(t.id, usuallyFree ? 'free' : 'sold'); }}>{usuallyFree ? 'Give' : 'Sell'}</MiniButton>
                        </span>
                      )}
                      {isAdmin && !readOnly && <Icon name="ChevronRight" size={15} />}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {!loading && !error && rows.length === 0 && ((types || []).length === 0
        ? <EmptyBlock icon="Ticket" title="No voucher types yet" hint={isAdmin ? 'Add one with New voucher type.' : 'An admin adds the vouchers you can sell.'} />
        : <EmptyBlock icon="Ticket" title="No types match" hint="Try a different search or clear a filter." action={{ label: 'Clear filters', run: () => { setQuery(''); setKind(''); setCat(''); } }} />)}
      <p className="text-[12.5px] text-[#8A8A90] mt-4 leading-relaxed">
        &quot;Usually&quot; only sets the default on the voucher form; any voucher can still be sold or given free. &quot;Counts as&quot; decides which member discount applies when a member buys it.
        Changes apply to vouchers handed out from now on. Turning a type off stops new ones; vouchers already out can still be used until they expire.
      </p>
    </div>
  );
};

export default VoucherTypesPanel;
