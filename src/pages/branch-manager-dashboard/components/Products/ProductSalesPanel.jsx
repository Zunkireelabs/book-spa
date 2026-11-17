import React, { useCallback, useEffect, useState } from 'react';
import ConfirmDialog from '../../../../components/ui/ConfirmDialog';
import { PanelShell, InlineError } from '../../../../components/ui/PanelFormKit';
import { fetchProductSales, refundProductSale } from '../../../../services/api';
import { npr, nepalDate, whenLabel } from '../../../../services/productsView';
import { nepalNow } from '../../../../utils/customerDirectory';
import { friendlyError } from '../../../../utils/friendlyError';
import { MiniButton } from '../Area/listKit';
import { humanizePaymentMethod } from '../../../../services/paymentMethods';

// "See all" under a product's Sales: its latest sales at this branch (all branches in the Overall view). A manager can refund one
// (the refund puts the units back on the shelf and writes a Refund movement). This is where product refunds live now.
const ProductSalesPanel = ({ product, branchId, canRefund, onClose, onChanged, onBack, width }) => {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const today = nepalNow().today;

  const load = useCallback(async () => {
    const { data, error: err } = await fetchProductSales({ productId: product.id, branchId, limit: 100 });
    if (err) { setError(friendlyError(err, 'Could not load the sales.')); setRows([]); return; }
    setRows(data || []);
  }, [product.id, branchId]);
  useEffect(() => { load(); }, [load]);

  const refund = async (reason) => {
    const sale = confirm;
    setBusy(true);
    const { error: err } = await refundProductSale({ saleId: sale.id, reason });
    setBusy(false);
    setConfirm(null);
    if (err) { setError(friendlyError(err, 'Could not refund the sale.')); return; }
    await load();
    onChanged(`Refunded ${sale.quantity} · ${product.name}`);
  };

  return (
    <PanelShell width={width} variant="panel" title={`${product.name} · sales`} onClose={onClose} onBack={onBack} hideFooter>
      <div className="px-5 py-4 space-y-3">
        <InlineError message={error} />
        {rows === null ? <div className="h-24 rounded-lg bg-[#F1F1EF] animate-pulse" /> : rows.length === 0 ? (
          <p className="text-[13px] text-[#8A8A90] py-8 text-center">No sales yet.</p>
        ) : (
          <ul className="divide-y divide-[#F1F1EF] border border-border rounded-[10px]" data-sales-list>
            {rows.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-3.5 py-2.5 text-[13px] tabular-nums">
                <div className="min-w-0 flex-1">
                  <p className={`font-medium truncate ${s.refunded_at ? 'text-[#8A8A90] line-through' : 'text-text-primary'}`}>{s.quantity} × {s.variant_name || product.name}{s.customers?.full_name ? ` · ${s.customers.full_name}` : ' · walk-in'}</p>
                  <p className="text-[12.5px] text-[#8A8A90] truncate">{whenLabel(s.created_at, today)}{' '}({nepalDate(s.created_at)}) · {humanizePaymentMethod(s.payment_mode)} · {s.users?.full_name || ''}{s.refunded_at ? ' · refunded' : ''}</p>
                </div>
                <span className="font-semibold whitespace-nowrap">{npr(s.total_amount)}</span>
                {canRefund && !s.refunded_at && <MiniButton onClick={() => setConfirm(s)} data-refund>Refund</MiniButton>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {confirm && (
        <ConfirmDialog title="Refund this sale?" message={`${confirm.quantity} × ${product.name} for ${npr(confirm.total_amount)} will be refunded and the stock put back.`}
          confirmLabel="Refund" reasonOptional reasonLabel="Note" reasonPlaceholder="Optional" isSubmitting={busy} onConfirm={refund} onClose={() => !busy && setConfirm(null)} />
      )}
    </PanelShell>
  );
};

export default ProductSalesPanel;
