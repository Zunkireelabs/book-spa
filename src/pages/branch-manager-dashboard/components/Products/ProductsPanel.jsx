import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import ConfirmDialog from '../../../../components/ui/ConfirmDialog';
import FilterBar from '../../../../components/ui/FilterBar';
import { useAuth } from '../../../../contexts/AuthContext';
import { useBranch } from '../../../../contexts/BranchContext';
import {
  fetchProductsForManagement,
  toggleProductActive,
  deleteProduct,
} from '../../../../services/api';
import { friendlyError } from '../../../../utils/friendlyError';
import SellProductPanel from './SellProductPanel';
import ProductDetailPanel from './ProductDetailPanel';
import ProductFormPanel from './ProductFormPanel';
import ProductCategoriesPanel from './ProductCategoriesPanel';
import ProductSalesReportPanel from './ProductSalesReportPanel';
import StockTransferReportPanel from './StockTransferReportPanel';
import StockTransferPanel from './StockTransferPanel';

function formatNPR(amount) {
  return `NPR ${Number(amount).toLocaleString('en-IN')}`;
}

const ProductsPanel = () => {
  const { profile } = useAuth();
  const isManagerOrAdmin = ['manager', 'admin'].includes(profile?.role);
  const { branchId, branchName, isOverall } = useBranch();

  const [activeTab, setActiveTab] = useState('catalog');
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // One right-hand panel at a time: { kind: 'form' | 'detail' | 'sell' | 'transfer' | 'categories', product?, from? }.
  // `from: 'detail'` means the edit form was opened from the detail panel, so its back arrow returns there.
  const [panel, setPanel] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const filteredProducts = products.filter((p) => {
    if (searchQuery && !p.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (statusFilter === 'active' && !p.is_active) return false;
    if (statusFilter === 'inactive' && p.is_active) return false;
    return true;
  });

  // `silent` refreshes the list in place (no full-page spinner), so an open panel isn't torn down by a reload.
  const loadAll = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError(null);
    const productsResult = await fetchProductsForManagement(isOverall ? null : branchId);
    if (productsResult.error) {
      setError(friendlyError(productsResult.error, 'Failed to load products.'));
    } else {
      setProducts(productsResult.data || []);
    }
    setLoading(false);
  }, [branchId, isOverall]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const closePanel = () => setPanel(null);
  const reloadAnd = async (next = null) => { setPanel(next); await loadAll({ silent: true }); };

  const handleToggle = async (product) => {
    setError(null);
    const result = await toggleProductActive({ productId: product.id, isActive: !product.is_active });
    if (result.error) {
      setError(friendlyError(result.error, 'Could not update the product.'));
    } else {
      await loadAll({ silent: true });
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    setError(null);
    const result = await deleteProduct({ productId: confirmDelete.id });
    if (result.error) {
      setError(/foreign key|23503/i.test(`${result.error?.code || ''} ${result.error?.message || ''}`)
        ? `"${confirmDelete.name}" has sales history, so it can't be deleted. Deactivate it instead to hide it from sale.`
        : friendlyError(result.error, 'Could not delete the product.'));
    } else {
      await loadAll({ silent: true });
    }
    setConfirmDelete(null);
    setDeleting(false);
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
        <p className="font-body text-sm text-text-secondary">Loading products...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-1 border-b border-border">
        {[{ id: 'catalog', label: 'Products' }, { id: 'report', label: 'Sales Report' }, { id: 'transfers', label: 'Stock Transfers' }].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-body font-body-medium spa-transition-fast border-b-2 -mb-[1px] ${
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'report' ? (
        <ProductSalesReportPanel />
      ) : activeTab === 'transfers' ? (
        <StockTransferReportPanel />
      ) : (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Products</h3>
            <p className="font-body text-sm text-text-secondary">
              {products.length} product{products.length !== 1 ? 's' : ''} — retail items staff can sell
            </p>
          </div>
          {isManagerOrAdmin && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" iconName="Tags" iconSize={16} onClick={() => setPanel({ kind: 'categories' })}>
                Manage Categories
              </Button>
              <Button variant="primary" size="sm" iconName="Plus" iconSize={16} onClick={() => setPanel({ kind: 'form' })}>
                Add Product
              </Button>
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
            <Icon name="AlertCircle" size={16} />
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto"><Icon name="X" size={14} /></button>
          </div>
        )}

        <FilterBar
          search={{
            value: searchQuery,
            onChange: setSearchQuery,
            placeholder: 'Search by product name...',
          }}
          filters={[
            {
              value: statusFilter,
              onChange: setStatusFilter,
              options: [
                { value: 'all', label: 'All Status' },
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ],
            },
          ]}
          resultCount={{ filtered: filteredProducts.length, total: products.length }}
          hasActiveFilters={searchQuery || statusFilter !== 'all'}
          onClear={() => {
            setSearchQuery('');
            setStatusFilter('all');
          }}
        />

        <div className="bg-surface border border-border rounded-spa overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-background border-b border-border">
                <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Name</th>
                <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary hidden lg:table-cell">Category</th>
                <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Price</th>
                <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary hidden sm:table-cell">
                  Stock {isOverall ? '(all branches)' : `(${branchName})`}
                </th>
                <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Status</th>
                <th className="text-right px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-text-secondary font-body text-sm">
                    {products.length === 0
                      ? isManagerOrAdmin ? 'No products found. Click "Add Product" to create one.' : 'No products found.'
                      : 'No products match your filters.'}
                  </td>
                </tr>
              ) : (
                filteredProducts.map((p) => (
                  <tr key={p.id} className="border-b border-border last:border-b-0 hover:bg-background/50 spa-transition-fast">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-spa overflow-hidden border border-border bg-background flex-shrink-0 flex items-center justify-center">
                          {p.image_url ? (
                            <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                          ) : (
                            <Icon name="Package" size={16} className="text-text-tertiary" />
                          )}
                        </div>
                        <span className="font-body font-body-medium text-sm text-text-primary">{p.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-body text-sm text-text-secondary hidden lg:table-cell">{p.category || '—'}</td>
                    <td className="px-4 py-3 font-data text-sm text-text-primary">{formatNPR(p.price_npr)}</td>
                    <td className="px-4 py-3 font-data text-sm hidden sm:table-cell">
                      {p.track_stock ? (
                        <span className={p.stock_quantity === 0 ? 'text-error' : 'text-text-primary'}>
                          {p.stock_quantity}
                        </span>
                      ) : (
                        <span className="text-text-tertiary">Unlimited</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-caption ${
                        p.is_active ? 'bg-success/10 text-success' : 'bg-text-secondary/10 text-text-secondary'
                      }`}>
                        {p.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setPanel({ kind: 'detail', product: p })}
                          className="p-1.5 rounded hover:bg-background spa-transition-fast text-text-secondary hover:text-text-primary"
                          title="View details"
                        >
                          <Icon name="Eye" size={16} />
                        </button>
                        {p.is_active && (!p.track_stock || p.stock_quantity > 0) && (
                          <Button variant="primary" size="xs" onClick={() => setPanel({ kind: 'sell', product: p })}>
                            Sell
                          </Button>
                        )}
                        {p.is_active && p.track_stock && p.stock_quantity === 0 && (
                          <span className="text-xs font-caption text-error px-2">Out of stock</span>
                        )}
                        {isManagerOrAdmin && p.track_stock && (
                          <button
                            onClick={() => setPanel({ kind: 'transfer', product: p })}
                            className="p-1.5 rounded hover:bg-background spa-transition-fast text-text-secondary hover:text-text-primary"
                            title="Receive / transfer stock"
                          >
                            <Icon name="ArrowLeftRight" size={16} />
                          </button>
                        )}
                        {isManagerOrAdmin && (
                          <>
                            <button
                              onClick={() => setPanel({ kind: 'form', product: p })}
                              className="p-1.5 rounded hover:bg-background spa-transition-fast text-text-secondary hover:text-text-primary"
                              title="Edit"
                            >
                              <Icon name="Pencil" size={16} />
                            </button>
                            <button
                              onClick={() => setConfirmDelete(p)}
                              className="p-1.5 rounded hover:bg-error/10 spa-transition-fast text-text-secondary hover:text-error"
                              title="Delete"
                            >
                              <Icon name="Trash2" size={16} />
                            </button>
                            <button
                              onClick={() => handleToggle(p)}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full spa-transition-fast ${
                                p.is_active ? 'bg-success' : 'bg-border'
                              }`}
                              title={p.is_active ? 'Deactivate' : 'Activate'}
                            >
                              <span className={`inline-block h-4 w-4 rounded-full bg-white spa-transition-fast transform ${
                                p.is_active ? 'translate-x-6' : 'translate-x-1'
                              }`} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* Delete: a small centred confirm (destructive actions stay a dialog; create / edit / detail are panels) */}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete product?"
          message={`"${confirmDelete.name}" will be permanently deleted. This action cannot be undone.`}
          confirmLabel="Delete"
          requireReason={false}
          isSubmitting={deleting}
          onConfirm={handleDelete}
          onClose={() => !deleting && setConfirmDelete(null)}
        />
      )}

      {panel?.kind === 'form' && (
        <ProductFormPanel
          key={panel.product?.id || 'new'}
          product={panel.product}
          canManageCategories={isManagerOrAdmin}
          onClose={closePanel}
          onBack={panel.from === 'detail' ? () => setPanel({ kind: 'detail', product: panel.product }) : undefined}
          onSaved={() => reloadAnd(null)}
        />
      )}
      {panel?.kind === 'detail' && (
        <ProductDetailPanel
          key={panel.product.id}
          product={panel.product}
          canEdit={isManagerOrAdmin}
          canSell
          onClose={closePanel}
          onEdit={(product) => setPanel({ kind: 'form', product, from: 'detail' })}
          onSell={(product) => setPanel({ kind: 'sell', product })}
        />
      )}
      {panel?.kind === 'sell' && (
        <SellProductPanel key={panel.product.id} product={panel.product} onClose={closePanel} onSold={() => reloadAnd(null)} />
      )}
      {panel?.kind === 'transfer' && (
        <StockTransferPanel key={panel.product.id} product={panel.product} onClose={closePanel} onTransferred={() => reloadAnd(null)} />
      )}
      {panel?.kind === 'categories' && (
        <ProductCategoriesPanel onClose={closePanel} onCategoriesChanged={() => loadAll({ silent: true })} />
      )}
    </div>
  );
};

export default ProductsPanel;
