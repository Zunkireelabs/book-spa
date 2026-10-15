import React, { useEffect, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import { PanelShell, FormBody, InfoRows, TabBar } from '../../../../components/ui/PanelFormKit';
import { fetchProductSales } from '../../../../services/api';

const formatNPR = (amount) => `NPR ${Number(amount).toLocaleString('en-IN')}`;
const formatDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const TABS = [{ id: 'details', label: 'Details' }, { id: 'sales', label: 'Sales' }];

const headerBtn = 'h-8 px-2.5 text-[13px] font-body font-body-medium rounded-spa spa-transition-fast whitespace-nowrap';

// Read-only product detail in the right-hand panel: image, name and status, then Details / Sales. Header actions: Edit (manager
// and admin) and Sell (an active product with stock). Edit switches this same panel to the edit form.
const ProductDetailPanel = ({ product, canEdit, canSell, onClose, onEdit, onSell }) => {
  const [tab, setTab] = useState('details');
  const [sales, setSales] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setSales(null);
    fetchProductSales({ productId: product.id, limit: 100 }).then(({ data }) => { if (!cancelled) setSales(data || []); });
    return () => { cancelled = true; };
  }, [product.id]);

  const outOfStock = product.track_stock && product.stock_quantity === 0;
  const sellable = canSell && product.is_active && !outOfStock;

  return (
    <PanelShell
      variant="panel"
      title="Product"
      onClose={onClose}
      hideFooter
      headerExtra={(
        <>
          {canEdit && <button type="button" onClick={() => onEdit(product)} className={`${headerBtn} text-text-secondary hover:bg-black/[0.05]`}>Edit</button>}
          {sellable && <button type="button" onClick={() => onSell(product)} className={`${headerBtn} bg-primary text-white hover:bg-primary/90`}>Sell</button>}
        </>
      )}
    >
      <FormBody>
        {product.image_url && (
          <div className="w-full h-44 rounded-spa overflow-hidden border border-border bg-background">
            <img src={product.image_url} alt={product.name} className="w-full h-full object-contain" />
          </div>
        )}
        <div>
          <h4 className="font-heading font-heading-semibold text-[17px] text-text-primary">{product.name}</h4>
          <span className={`inline-flex items-center mt-1.5 px-2 py-0.5 rounded text-xs ${product.is_active ? 'bg-success/10 text-success' : 'bg-black/[0.05] text-text-secondary'}`}>
            {product.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>

        <TabBar tabs={TABS} value={tab} onChange={setTab} />

        {tab === 'details' ? (
          <div className="space-y-4">
            <InfoRows rows={[
              ['Category', product.category || '—'],
              ['Price', formatNPR(product.price_npr)],
              ['Stock', product.track_stock ? String(product.stock_quantity) : 'Unlimited', outOfStock ? 'amber' : undefined],
              ['Added', formatDate(product.created_at)],
            ]} />
            <div>
              <p className="mb-1.5 font-body font-body-medium text-[13px] text-text-primary">Description</p>
              <p className="text-[13px] text-text-secondary whitespace-pre-wrap">{product.description || 'No description added.'}</p>
            </div>
          </div>
        ) : sales === null ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading sales">
            {[0, 1, 2].map((i) => <div key={i} className="h-11 rounded-spa border border-border bg-background animate-pulse" />)}
          </div>
        ) : sales.length === 0 ? (
          <div className="py-8 text-center">
            <Icon name="Receipt" size={24} className="text-text-tertiary mx-auto mb-2" />
            <p className="text-[13px] text-text-secondary">No sales recorded for this product yet.</p>
          </div>
        ) : (
          <ul className="border border-border rounded-spa divide-y divide-border">
            {sales.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                <span className="w-8 text-text-secondary tabular-nums">×{s.quantity}</span>
                <span className="flex-1 min-w-0 text-text-secondary truncate">{s.payment_mode} · {formatDate(s.created_at)}</span>
                <span className="font-data tabular-nums text-text-primary">{formatNPR(s.total_amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </FormBody>
    </PanelShell>
  );
};

export default ProductDetailPanel;
