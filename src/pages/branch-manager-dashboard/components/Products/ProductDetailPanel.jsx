import React, { useCallback, useEffect, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import ConfirmDialog from '../../../../components/ui/ConfirmDialog';
import { PanelShell, InlineError, OverflowMenu } from '../../../../components/ui/PanelFormKit';
import { useIndustry } from '../../../../hooks/useIndustry';
import {
  fetchProductMoney, fetchProductSalesSummary, fetchStockMovements, toggleProductActive, deleteProduct,
} from '../../../../services/api';
import { STATUS, reasonLabel, marginRange, npr, nepalDate, sizesText } from '../../../../services/productsView';
import { friendlyError } from '../../../../utils/friendlyError';
import { StatusPill, tileDate } from '../Area/listKit';
import { ProductThumb, Tag, HereTag, SECTION, ghostBtn, primaryBtn } from './productBits';

// Product detail (V25): actions (Receive / Remove / Move / Sell by role), sizes, stock per branch split by size, Money (managers only),
// Sales (last 30 days), and the latest 3 stock movements. `product` is a row from productsView.buildRows (so it refreshes with the list).
const ProductDetailPanel = ({
  product: p, branches, branchId, branchName, isOverall, canManage, canCost, canSell, canSeeHistory, onAction, onEdit, onClose, onChanged, onSeeAll, onSeeSales, width,
}) => {
  const { sessionLabel } = useIndustry();
  const [money, setMoney] = useState(null); // by variant id
  const [sales, setSales] = useState(null);
  const [moves, setMoves] = useState(null);
  const [error, setError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const calls = [
      fetchProductSalesSummary({ productId: p.id, branchId: isOverall ? null : branchId }),
      canSeeHistory ? fetchStockMovements({ productId: p.id, branchId: isOverall ? null : branchId, limit: 3 }) : Promise.resolve({ data: [] }),
      canCost && !isOverall && p.trackStock ? fetchProductMoney({ productId: p.id, branchId }) : Promise.resolve({ data: null }),
    ];
    const [s, m, mo] = await Promise.all(calls);
    if (s.error) setError(friendlyError(s.error, 'Could not load the sales.')); else setSales(s.data);
    setMoves(m.data || []);
    setMoney(mo.data ? Object.fromEntries(mo.data.map((r) => [r.variantId, r])) : null);
  }, [p.id, p.trackStock, branchId, isOverall, canCost, canSeeHistory]);
  useEffect(() => { load(); }, [load]);

  const act = canManage && !isOverall;
  const sellable = canSell && !isOverall && p.isActive && p.sellAtCheckout && (!p.trackStock || p.stockHere > 0);
  const sizes = p.variants.filter((v) => v.active);
  const multi = sizes.length > 1;
  const sub = [p.brand, p.category, multi ? `${sizes.length} sizes` : sizesText(p)].filter(Boolean).join(' · ');
  const stockWord = isOverall ? 'ALL BRANCHES' : branchName;

  const toggleOn = async () => {
    setBusy(true);
    const { error: err } = await toggleProductActive({ productId: p.id, isActive: !p.isActive });
    setBusy(false);
    if (err) { setError(friendlyError(err, 'Could not update the product.')); return; }
    onChanged(p.isActive ? `${p.name} is off sale` : `${p.name} is back on sale`);
  };
  const doDelete = async () => {
    setBusy(true);
    const { error: err } = await deleteProduct({ productId: p.id });
    setBusy(false);
    setConfirmDelete(false);
    if (err) {
      setError(/foreign key|23503|append-only/i.test(`${err.code || ''} ${err.message || ''}`)
        ? `"${p.name}" has stock or sales history, so it can't be deleted. Switch it off to hide it instead.`
        : friendlyError(err, 'Could not delete the product.'));
      return;
    }
    onChanged(`${p.name} deleted`, { closed: true });
  };

  const menu = !canManage ? [] : [
    { key: 'edit', label: 'Edit product', icon: 'Pencil', run: () => onEdit(p) },
    { key: 'count', label: 'Set the real count', icon: 'ClipboardCheck', run: () => onAction('count', { product: p }), disabled: !act || !p.trackStock, reason: !p.trackStock ? 'This product does not count stock' : 'Choose a branch first' },
    { key: 'toggle', label: p.isActive ? 'Switch off (hide from sale)' : 'Switch on', icon: p.isActive ? 'EyeOff' : 'Eye', run: toggleOn },
    { key: 'delete', label: 'Delete', icon: 'Trash2', danger: true, run: () => setConfirmDelete(true) },
  ];

  const detailOf = (m) => {
    const who = m.byName ? m.byName.split(' ')[0] : '';
    if (m.reason === 'sale' || m.reason === 'refund') return [m.customerName, who].filter(Boolean).join(' · ') || 'Walk-in';
    if (m.reason === 'transfer_out' || m.reason === 'transfer_in') {
      const other = branches.find((b) => b.id === (m.reason === 'transfer_out' ? m.toBranchId : m.fromBranchId))?.name;
      return [other ? `${m.reason === 'transfer_out' ? 'To' : 'From'} ${other}` : '', who].filter(Boolean).join(' · ');
    }
    return [m.note ? `“${m.note}”` : '', who].filter(Boolean).join(' · ');
  };

  return (
    <PanelShell width={width} variant="panel" title="Product" onClose={onClose} hideFooter headerExtra={menu.length ? <OverflowMenu items={menu} /> : null}>
      <div className="px-5 pt-1 pb-4 border-b border-border">
        <div className="flex items-center gap-3.5">
          <ProductThumb product={p} size={48} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[17px] font-semibold tracking-[-0.3px] text-text-primary truncate">{p.name}</span>
              <StatusPill status={p.status} config={STATUS} />
              {p.proUse && <Tag>PRO USE</Tag>}
              {!p.isActive && <Tag>OFF SALE</Tag>}
            </div>
            <p className="text-[12.5px] text-[#8A8A90] mt-0.5 truncate">{sub || '—'}</p>
          </div>
        </div>
        {(act || sellable) && (
          <div className="flex gap-2 mt-4 flex-wrap">
            {act && p.trackStock && <button type="button" onClick={() => onAction('receive', { product: p })} className={primaryBtn} data-act="receive"><Icon name="Download" size={14} />Receive</button>}
            {act && p.trackStock && <button type="button" onClick={() => onAction('remove', { product: p })} className={ghostBtn} data-act="remove"><Icon name="Minus" size={14} />Remove</button>}
            {act && p.trackStock && <button type="button" onClick={() => onAction('move', { product: p })} className={ghostBtn} data-act="move"><Icon name="ArrowLeftRight" size={14} />Move</button>}
            {sellable && <button type="button" onClick={() => onAction('sell', { product: p })} className={act ? ghostBtn : primaryBtn} data-act="sell"><Icon name="ShoppingCart" size={14} />Sell</button>}
          </div>
        )}
        {canManage && isOverall && <p className="text-[12.5px] text-[#8A8A90] mt-3">Choose a branch in the header to receive, move or sell.</p>}
      </div>

      <div className="px-5 py-[18px] flex flex-col gap-[18px]">
        <InlineError message={error} />

        <section>
          <div className={SECTION}>{multi ? 'Sizes' : 'Details'} · {stockWord}</div>
          <div className="border border-border rounded-[10px] overflow-hidden" data-sizes>
            <div className="grid grid-cols-[1.3fr_.9fr_1fr_.6fr] gap-2 px-3 py-1.5 bg-background text-[11.5px] font-medium text-[#8A8A90]">
              <span>{multi ? (p.optionLabel || 'Size') : 'Item'}</span><span className="text-right">{p.trackStock ? 'In stock' : ''}</span><span className="text-right">Price</span><span className="text-right">{canCost ? 'Margin' : ''}</span>
            </div>
            {sizes.map((v) => (
              <div key={v.id} className="grid grid-cols-[1.3fr_.9fr_1fr_.6fr] gap-2 px-3 py-2 border-t border-[#F1F1EF] items-center text-[13px] tabular-nums" data-size-row={v.id}>
                <div className="min-w-0">
                  <p className="font-medium text-text-primary truncate">{v.name || p.name}</p>
                  {v.sku && <p className="text-[11.5px] text-[#8A8A90] font-data truncate">{v.sku}</p>}
                </div>
                <div className="text-right">
                  {p.trackStock ? (
                    <><b className={`font-semibold ${v.qty <= 0 ? 'text-[#991B1B]' : v.low != null && v.qty <= v.low ? 'text-[#B45309]' : ''}`}>{v.qty}</b>{v.low != null && <span className="text-[#8A8A90]"> low at {v.low}</span>}</>
                  ) : <span className="text-[#8A8A90]">Not counted</span>}
                </div>
                <div className="text-right whitespace-nowrap">{p.sellAtCheckout ? npr(v.price) : <span className="text-[#8A8A90]">Not sold</span>}</div>
                <div className="text-right">{canCost && p.sellAtCheckout ? marginRange([v.margin]) : ''}</div>
              </div>
            ))}
          </div>
        </section>

        {p.trackStock && !isOverall && branches.length > 0 && (
          <section>
            <div className="border border-border rounded-[10px] divide-y divide-[#F1F1EF]" data-branch-stock>
              {branches.slice().sort((a, b) => (a.id === branchId ? -1 : b.id === branchId ? 1 : a.name.localeCompare(b.name))).map((b) => {
                const per = sizes.map((v) => v.byBranch.get(b.id) || 0);
                const total = per.reduce((n, x) => n + x, 0);
                return (
                  <div key={b.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-[13px] tabular-nums">
                    <span className="text-text-primary truncate">{b.name}{b.id === branchId && <HereTag />}</span>
                    <span className="flex items-center gap-3 flex-shrink-0">
                      {multi && <span className="text-[#8A8A90]">{per.join(' + ')}</span>}
                      <b className="font-semibold w-8 text-right">{total}</b>
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {canCost && !isOverall && p.trackStock && (
          <section>
            <div className={`${SECTION} flex items-baseline justify-between`}><span>Money</span><span className="normal-case tracking-normal text-[11.5px] font-normal inline-flex items-center gap-1"><Icon name="Lock" size={11} />Managers only</span></div>
            {!money ? <div className="h-[80px] rounded-[10px] bg-[#F1F1EF] animate-pulse" /> : (
              <dl className="border border-border rounded-[10px] divide-y divide-[#F1F1EF] text-[13px] tabular-nums" data-money>
                <div className="flex justify-between gap-3 px-3.5 py-2.5"><dt className="text-[#515152]">Average cost</dt><dd className="font-medium text-text-primary text-right">{sizes.map((v) => { const m = money[v.id]; const c = m?.avgCost > 0 ? m.avgCost : m?.costPrice; return c > 0 ? npr(c) : '—'; }).join(' · ')}</dd></div>
                <div className="flex justify-between gap-3 px-3.5 py-2.5"><dt className="text-[#515152]">Stock value {isOverall ? '' : 'here'}, at cost</dt><dd className="font-medium text-text-primary text-right">
                  {sizes.every((v) => money[v.id]?.stockValue == null && (money[v.id]?.stockHere || 0) > 0) ? <span className="text-[#8A8A90] font-normal">cost unknown</span> : npr(sizes.reduce((n, v) => n + (money[v.id]?.stockValue || 0), 0))}
                  {sizes.some((v) => money[v.id]?.stockValue == null && (money[v.id]?.stockHere || 0) > 0) && !sizes.every((v) => money[v.id]?.stockValue == null && (money[v.id]?.stockHere || 0) > 0) && <span className="block text-[11.5px] text-[#8A8A90] font-normal">some sizes have no cost yet</span>}
                </dd></div>
              </dl>
            )}
          </section>
        )}

        <section>
          <div className={`${SECTION} flex items-baseline justify-between gap-3`}>
            <span>Sales · last 30 days</span>
            {canManage && <button type="button" onClick={onSeeSales} className="normal-case tracking-normal text-[12px] font-normal text-[#515152] hover:text-text-primary hover:underline" data-see-sales>See all</button>}
          </div>
          {!sales ? <div className="h-[80px] rounded-[10px] bg-[#F1F1EF] animate-pulse" /> : sales.qty === 0 ? (
            <p className="text-[13px] text-[#8A8A90] border border-border rounded-[10px] px-3.5 py-3" data-sales>{p.sellAtCheckout ? 'Nothing sold in the last 30 days.' : 'This item is not sold; it is used in the work.'}</p>
          ) : (
            <dl className="border border-border rounded-[10px] divide-y divide-[#F1F1EF] text-[13px] tabular-nums" data-sales>
              <div className="flex justify-between gap-3 px-3.5 py-2.5"><dt className="text-[#515152]">Sold</dt><dd className="font-medium text-text-primary">{sales.qty} · {npr(sales.amount)}</dd></div>
              {sales.topSeller && <div className="flex justify-between gap-3 px-3.5 py-2.5"><dt className="text-[#515152]">Best seller</dt><dd className="font-medium text-text-primary">{sales.topSeller.name} · {sales.topSeller.qty} sold</dd></div>}
              <div className="flex justify-between gap-3 px-3.5 py-2.5"><dt className="text-[#515152]">Bought again</dt><dd className="font-medium text-text-primary">{sales.repeatBuyers} {sales.repeatBuyers === 1 ? 'guest' : 'guests'}</dd></div>
            </dl>
          )}
        </section>

        {canSeeHistory && (
          <section>
            <div className={`${SECTION} flex items-baseline justify-between gap-3`}>
              <span>History</span>
              <button type="button" onClick={onSeeAll} className="normal-case tracking-normal text-[12px] font-normal text-[#515152] hover:text-text-primary hover:underline" data-see-all>See all</button>
            </div>
            {moves === null ? <div className="h-[60px] rounded-[10px] bg-[#F1F1EF] animate-pulse" /> : moves.length === 0 ? (
              <p className="text-[13px] text-[#8A8A90]">No stock movements yet.</p>
            ) : (
              <ul className="flex flex-col" data-history>
                {moves.map((m) => {
                  const tile = tileDate(nepalDate(m.createdAt));
                  return (
                    <li key={m.id} className="flex gap-3 items-start py-2" data-history-item>
                      <div className="w-10 text-center rounded-md bg-[#FAFAF9] border border-border py-[3px] flex-shrink-0">
                        <b className="block text-[14px] font-semibold tabular-nums">{String(tile.day).padStart(2, '0')}</b>
                        <span className="text-[9.5px] text-[#8A8A90] font-semibold uppercase">{tile.mon}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-text-primary">{reasonLabel(m.reason, { sessionLabel })} {Math.abs(m.delta)}{m.variantName ? ` · ${m.variantName}` : ''}</p>
                        <p className="text-[12.5px] text-[#8A8A90] mt-0.5 truncate">{detailOf(m)}{detailOf(m) ? ' · ' : ''}{m.qtyAfter} left</p>
                      </div>
                      <span className={`text-[13px] font-semibold tabular-nums whitespace-nowrap ${m.delta > 0 ? 'text-[#15803D]' : 'text-text-primary'}`}>{m.delta > 0 ? '+' : '−'} {Math.abs(m.delta)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </div>
      {confirmDelete && (
        <ConfirmDialog title="Delete product?" message={`"${p.name}" will be permanently deleted. A product with stock or sales history can't be deleted; switch it off instead.`}
          confirmLabel="Delete" requireReason={false} isSubmitting={busy} onConfirm={doDelete} onClose={() => !busy && setConfirmDelete(false)} />
      )}
    </PanelShell>
  );
};

export default ProductDetailPanel;
