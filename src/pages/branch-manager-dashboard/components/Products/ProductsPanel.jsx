import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import Input from '../../../../components/ui/Input';
import FilterBar from '../../../../components/ui/FilterBar';
import CustomSelect from '../../../../components/ui/CustomSelect';
import { useAuth } from '../../../../contexts/AuthContext';
import { useBranch } from '../../../../contexts/BranchContext';
import {
  fetchProductsForManagement,
  createProduct,
  updateProduct,
  toggleProductActive,
  deleteProduct,
  uploadProductImage,
  fetchActiveProductCategories,
} from '../../../../services/api';
import SellProductModal from './SellProductModal';
import ProductDetailDrawer from './ProductDetailDrawer';
import ProductCategoryManagerModal from './ProductCategoryManagerModal';
import ProductSalesReportPanel from './ProductSalesReportPanel';
import StockTransferModal from './StockTransferModal';

function formatNPR(amount) {
  return `NPR ${Number(amount).toLocaleString('en-IN')}`;
}

function formatDate(d) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const EMPTY_FORM = { name: '', description: '', category: '', priceNpr: '', imageUrl: '', trackStock: false };

const ProductsPanel = () => {
  const { profile } = useAuth();
  const isManagerOrAdmin = ['manager', 'admin'].includes(profile?.role);
  const { branchId, branchName, isOverall } = useBranch();

  const [activeTab, setActiveTab] = useState('catalog');
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [sellingProduct, setSellingProduct] = useState(null);
  const [viewingProduct, setViewingProduct] = useState(null);
  const [transferringProduct, setTransferringProduct] = useState(null);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [categoryOptions, setCategoryOptions] = useState([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const filteredProducts = products.filter((p) => {
    if (searchQuery && !p.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (statusFilter === 'active' && !p.is_active) return false;
    if (statusFilter === 'inactive' && p.is_active) return false;
    return true;
  });

  const loadCategoryOptions = useCallback(async () => {
    const result = await fetchActiveProductCategories();
    if (!result.error) {
      setCategoryOptions((result.data || []).map((c) => ({ value: c.name, label: c.name })));
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [productsResult] = await Promise.all([
      fetchProductsForManagement(isOverall ? null : branchId),
      loadCategoryOptions(),
    ]);
    if (productsResult.error) {
      setError(productsResult.error.message || 'Failed to load products.');
    } else {
      setProducts(productsResult.data || []);
    }
    setLoading(false);
  }, [branchId, isOverall]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleOpenCreate = () => {
    setEditingProduct(null);
    setFormData(EMPTY_FORM);
    setImageFile(null);
    setImagePreview(null);
    setFormError(null);
    setShowModal(true);
  };

  const handleOpenEdit = (product) => {
    setEditingProduct(product);
    setFormData({
      name: product.name,
      description: product.description || '',
      category: product.category || '',
      priceNpr: String(product.price_npr),
      imageUrl: product.image_url || '',
      trackStock: !!product.track_stock,
    });
    setImageFile(null);
    setImagePreview(product.image_url || null);
    setFormError(null);
    setShowModal(true);
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      if (!allowedTypes.includes(file.type)) {
        setFormError('Only JPEG, PNG, WebP, and GIF images are allowed.');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        setFormError('Image must be less than 5MB.');
        return;
      }
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
      setFormError(null);
    }
  };

  const handleRemoveImage = () => {
    setImageFile(null);
    setImagePreview(null);
    setFormData({ ...formData, imageUrl: '' });
  };

  const handleSave = async () => {
    const price = Number(formData.priceNpr);

    if (!editingProduct && !formData.name.trim()) {
      setFormError('Product name is required.');
      return;
    }
    if (!price || price <= 0) {
      setFormError('Price must be a positive number.');
      return;
    }

    setSaving(true);
    setFormError(null);

    let finalImageUrl = formData.imageUrl.trim() || null;
    if (imageFile) {
      setUploading(true);
      const uploadResult = await uploadProductImage(imageFile);
      setUploading(false);
      if (uploadResult.error) {
        setFormError(uploadResult.error.message || 'Failed to upload image.');
        setSaving(false);
        return;
      }
      finalImageUrl = uploadResult.url;
    }

    const payload = {
      name: formData.name.trim(),
      description: formData.description.trim() || null,
      category: formData.category.trim() || null,
      priceNpr: price,
      imageUrl: finalImageUrl,
      trackStock: formData.trackStock,
    };

    const result = editingProduct
      ? await updateProduct({ productId: editingProduct.id, ...payload })
      : await createProduct(payload);

    if (result.error) {
      setFormError(result.error.message || 'Save failed.');
    } else {
      setShowModal(false);
      await loadAll();
    }
    setSaving(false);
  };

  const handleToggle = async (product) => {
    setError(null);
    const result = await toggleProductActive({ productId: product.id, isActive: !product.is_active });
    if (result.error) {
      setError(result.error.message || 'Toggle failed.');
    } else {
      await loadAll();
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    setError(null);
    const result = await deleteProduct({ productId: confirmDelete.id });
    if (result.error) {
      setError(result.error.message || 'Delete failed.');
    } else {
      await loadAll();
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
        {[{ id: 'catalog', label: 'Products' }, { id: 'report', label: 'Sales Report' }].map((tab) => (
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
              <Button variant="outline" size="sm" iconName="Tags" iconSize={16} onClick={() => setShowCategoryManager(true)}>
                Manage Categories
              </Button>
              <Button variant="primary" size="sm" iconName="Plus" iconSize={16} onClick={handleOpenCreate}>
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
                          onClick={() => setViewingProduct(p)}
                          className="p-1.5 rounded hover:bg-background spa-transition-fast text-text-secondary hover:text-text-primary"
                          title="View details"
                        >
                          <Icon name="Eye" size={16} />
                        </button>
                        {p.is_active && (!p.track_stock || p.stock_quantity > 0) && (
                          <Button variant="primary" size="xs" onClick={() => setSellingProduct(p)}>
                            Sell
                          </Button>
                        )}
                        {p.is_active && p.track_stock && p.stock_quantity === 0 && (
                          <span className="text-xs font-caption text-error px-2">Out of stock</span>
                        )}
                        {isManagerOrAdmin && p.track_stock && (
                          <button
                            onClick={() => setTransferringProduct(p)}
                            className="p-1.5 rounded hover:bg-background spa-transition-fast text-text-secondary hover:text-text-primary"
                            title="Receive / transfer stock"
                          >
                            <Icon name="ArrowLeftRight" size={16} />
                          </button>
                        )}
                        {isManagerOrAdmin && (
                          <>
                            <button
                              onClick={() => handleOpenEdit(p)}
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

      {/* Create / Edit Modal — portaled to escape any ancestor stacking context (transitions/sticky headers) that would otherwise clip a fixed overlay */}
      {showModal && createPortal(
        <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-md max-h-[90vh] overflow-y-auto p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-heading font-heading-semibold text-lg text-text-primary">
                {editingProduct ? 'Edit Product' : 'Add Product'}
              </h3>
              <button onClick={() => setShowModal(false)} className="p-1 rounded hover:bg-background">
                <Icon name="X" size={20} className="text-text-secondary" />
              </button>
            </div>

            {formError && (
              <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
                <Icon name="AlertCircle" size={16} />
                <span>{formError}</span>
              </div>
            )}

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="block font-body font-body-medium text-sm text-text-primary">Product Name</label>
                {editingProduct ? (
                  <div className="px-3 py-2 bg-background rounded-spa border border-border font-body text-sm text-text-secondary">
                    {editingProduct.name}
                  </div>
                ) : (
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g. Lavender Massage Oil"
                  />
                )}
              </div>

              <div className="space-y-1">
                <label className="block font-body font-body-medium text-sm text-text-primary">
                  Category <span className="text-text-tertiary font-normal">(optional)</span>
                </label>
                <CustomSelect
                  value={formData.category}
                  onChange={(val) => setFormData({ ...formData, category: val })}
                  options={categoryOptions}
                  placeholder="Select a category"
                  searchable
                />
              </div>

              <div className="space-y-1">
                <label className="block font-body font-body-medium text-sm text-text-primary">Price (NPR)</label>
                <Input
                  type="number"
                  value={formData.priceNpr}
                  onChange={(e) => setFormData({ ...formData, priceNpr: e.target.value })}
                  placeholder="850"
                  min="1"
                />
              </div>

              <div className="space-y-2 p-3 bg-background rounded-spa border border-border">
                <div className="flex items-center justify-between">
                  <span className="font-body font-body-medium text-sm text-text-primary">Track stock quantity</span>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, trackStock: !formData.trackStock })}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full spa-transition-fast ${
                      formData.trackStock ? 'bg-success' : 'bg-border'
                    }`}
                  >
                    <span className={`inline-block h-4 w-4 rounded-full bg-white spa-transition-fast transform ${
                      formData.trackStock ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </button>
                </div>
                {formData.trackStock && (
                  <p className="font-caption text-xs text-text-secondary">
                    Stock is tracked per branch. Once saved, use "Receive Stock" on this
                    product to add its starting quantity at each branch.
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <label className="block font-body font-body-medium text-sm text-text-primary">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Product description..."
                  rows={3}
                  className="w-full rounded-spa border border-border bg-background px-3 py-2 font-body text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary spa-transition-fast resize-none"
                />
              </div>

              <div className="space-y-2">
                <label className="block font-body font-body-medium text-sm text-text-primary">
                  Product Image <span className="text-text-tertiary font-normal">(optional)</span>
                </label>

                {imagePreview ? (
                  <div className="flex items-start gap-3">
                    <div className="relative w-24 h-24 rounded-spa overflow-hidden border border-border flex-shrink-0">
                      <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-spa border border-border bg-background hover:bg-background/80 spa-transition-fast text-sm text-text-secondary">
                        <Icon name="RefreshCw" size={14} />
                        Replace
                        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handleImageChange} className="hidden" />
                      </label>
                      <button
                        type="button"
                        onClick={handleRemoveImage}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-spa border border-error/30 bg-error/5 hover:bg-error/10 spa-transition-fast text-sm text-error"
                      >
                        <Icon name="Trash2" size={14} />
                        Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <label className="cursor-pointer flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-border rounded-spa hover:border-primary/50 hover:bg-primary/5 spa-transition-fast">
                    <Icon name="Upload" size={20} className="text-text-tertiary mb-1" />
                    <span className="font-body text-sm text-text-secondary">Click to upload image</span>
                    <span className="font-caption text-xs text-text-tertiary mt-1">JPEG, PNG, WebP, GIF (max 5MB)</span>
                    <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handleImageChange} className="hidden" />
                  </label>
                )}

                {uploading && (
                  <div className="flex items-center gap-2 text-sm text-text-secondary">
                    <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" />
                    Uploading image...
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={handleSave} loading={saving}>
                {editingProduct ? 'Save Changes' : 'Create Product'}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Delete Confirmation Dialog */}
      {confirmDelete && createPortal(
        <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center">
                <Icon name="Trash2" size={20} className="text-error" />
              </div>
              <div>
                <h3 className="font-heading font-heading-semibold text-text-primary">Delete Product?</h3>
                <p className="font-body text-sm text-text-secondary">
                  "{confirmDelete.name}" will be permanently deleted. This action cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(null)} disabled={deleting}>Cancel</Button>
              <Button variant="danger" size="sm" onClick={handleDelete} loading={deleting}>Delete</Button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Sell Modal */}
      {sellingProduct && (
        <SellProductModal
          product={sellingProduct}
          onClose={() => setSellingProduct(null)}
          onSold={() => {
            setSellingProduct(null);
            loadAll();
          }}
        />
      )}

      {/* View Details Drawer — read-only overview, separate from Edit */}
      {viewingProduct && (
        <ProductDetailDrawer
          product={viewingProduct}
          canEdit={isManagerOrAdmin}
          onClose={() => setViewingProduct(null)}
          onEdit={(product) => {
            setViewingProduct(null);
            handleOpenEdit(product);
          }}
        />
      )}

      {/* Receive / Transfer Stock */}
      {transferringProduct && (
        <StockTransferModal
          product={transferringProduct}
          onClose={() => setTransferringProduct(null)}
          onTransferred={() => {
            setTransferringProduct(null);
            loadAll();
          }}
        />
      )}

      {/* Manage Categories */}
      {showCategoryManager && (
        <ProductCategoryManagerModal
          onClose={() => setShowCategoryManager(false)}
          onCategoriesChanged={loadCategoryOptions}
        />
      )}
    </div>
  );
};

export default ProductsPanel;
