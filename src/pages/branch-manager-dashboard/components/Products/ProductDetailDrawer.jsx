import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import { fetchProductSales } from '../../../../services/api';

function formatNPR(amount) {
  return `NPR ${Number(amount).toLocaleString('en-IN')}`;
}

function formatDate(d) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const TABS = [
  { id: 'details', label: 'Product Details' },
  { id: 'sales', label: 'Sales' },
];

// Slide-in drawer from the right edge, not a centered popup — matches the
// reference layout the client asked for. Two tabs, scoped to the fields
// this v1 actually has (Basic Info + this product's own sale history) —
// no Stock/Barcode/Brand/Supplier fields, that's a separate Inventory
// area out of scope for this version.
const ProductDetailDrawer = ({ product, canEdit, onClose, onEdit }) => {
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState('details');
  const [productSales, setProductSales] = useState([]);
  const [salesLoading, setSalesLoading] = useState(true);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSalesLoading(true);
    fetchProductSales({ productId: product.id, limit: 100 }).then(({ data }) => {
      if (!cancelled) {
        setProductSales(data || []);
        setSalesLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [product.id]);

  const handleClose = () => {
    setMounted(false);
    setTimeout(onClose, 200);
  };

  return createPortal(
    <div className="fixed inset-0 z-modal-overlay">
      <div
        className={`absolute inset-0 bg-black/50 spa-transition-fast ${mounted ? 'opacity-100' : 'opacity-0'}`}
        onClick={handleClose}
      />
      <div
        className={`absolute right-0 top-0 h-full w-full max-w-md bg-surface spa-shadow-modal overflow-y-auto transition-transform duration-200 ease-out ${
          mounted ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="sticky top-0 bg-surface border-b border-border px-6 py-4 flex items-center justify-between z-10">
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Product Details</h3>
          <div className="flex items-center gap-2">
            {canEdit && (
              <Button variant="ghost" size="sm" iconName="Pencil" iconSize={14} onClick={() => onEdit(product)}>
                Edit
              </Button>
            )}
            <button onClick={handleClose} className="p-1 rounded hover:bg-background">
              <Icon name="X" size={20} className="text-text-secondary" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {product.image_url && (
            <div className="w-full h-48 rounded-spa overflow-hidden border border-border bg-background">
              <img src={product.image_url} alt={product.name} className="w-full h-full object-contain" />
            </div>
          )}

          <div>
            <h4 className="font-heading font-heading-semibold text-xl text-text-primary">{product.name}</h4>
            <span className={`inline-flex items-center mt-1.5 px-2 py-0.5 rounded text-xs font-caption ${
              product.is_active ? 'bg-success/10 text-success' : 'bg-text-secondary/10 text-text-secondary'
            }`}>
              {product.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>

          <div className="flex gap-1 border-b border-border">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-2 text-sm font-body font-body-medium spa-transition-fast border-b-2 -mb-[1px] ${
                  activeTab === tab.id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-text-secondary hover:text-text-primary'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'details' && (
            <div className="space-y-3 pt-1">
              <div className="bg-background rounded-spa border border-border p-4 space-y-3">
                <p className="font-body font-body-medium text-sm text-text-primary">Basic Info</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="font-caption text-xs text-text-secondary uppercase tracking-wide mb-1">Category</p>
                    <p className="font-body text-sm text-text-primary">{product.category || '—'}</p>
                  </div>
                  <div>
                    <p className="font-caption text-xs text-text-secondary uppercase tracking-wide mb-1">Price</p>
                    <p className="font-data text-sm text-text-primary">{formatNPR(product.price_npr)}</p>
                  </div>
                  <div>
                    <p className="font-caption text-xs text-text-secondary uppercase tracking-wide mb-1">Stock</p>
                    <p className={`font-data text-sm ${product.track_stock && product.stock_quantity === 0 ? 'text-error' : 'text-text-primary'}`}>
                      {product.track_stock ? product.stock_quantity : 'Unlimited'}
                    </p>
                  </div>
                </div>
                <div>
                  <p className="font-caption text-xs text-text-secondary uppercase tracking-wide mb-1">Description</p>
                  <p className="font-body text-sm text-text-secondary whitespace-pre-wrap">
                    {product.description || 'No description added.'}
                  </p>
                </div>
                <div>
                  <p className="font-caption text-xs text-text-secondary uppercase tracking-wide mb-1">Added</p>
                  <p className="font-body text-sm text-text-secondary">{formatDate(product.created_at)}</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'sales' && (
            <div className="pt-1">
              {salesLoading ? (
                <div className="text-center py-8">
                  <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full mx-auto" />
                </div>
              ) : productSales.length === 0 ? (
                <div className="text-center py-8 text-text-secondary font-body text-sm">
                  No sales recorded for this product yet.
                </div>
              ) : (
                <div className="border border-border rounded-spa overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-background border-b border-border">
                        <th className="text-left px-3 py-2 font-body font-body-medium text-xs text-text-secondary">Qty</th>
                        <th className="text-left px-3 py-2 font-body font-body-medium text-xs text-text-secondary">Amount</th>
                        <th className="text-left px-3 py-2 font-body font-body-medium text-xs text-text-secondary">Payment</th>
                        <th className="text-left px-3 py-2 font-body font-body-medium text-xs text-text-secondary">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {productSales.map((s) => (
                        <tr key={s.id} className="border-b border-border last:border-b-0">
                          <td className="px-3 py-2 font-body text-sm text-text-secondary">{s.quantity}</td>
                          <td className="px-3 py-2 font-data text-sm text-text-primary">{formatNPR(s.total_amount)}</td>
                          <td className="px-3 py-2 font-body text-sm text-text-secondary">{s.payment_mode}</td>
                          <td className="px-3 py-2 font-body text-sm text-text-secondary">{formatDate(s.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ProductDetailDrawer;
