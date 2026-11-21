import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import BottomSheet, { SheetRow, useMediaQuery } from '../../../../components/ui/BottomSheet';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import ConfirmDialog from '../../../../components/ui/ConfirmDialog';
import { useFlashRow, rowTone, rowBar } from '../../../../components/ui/PanelFormKit';
import { friendlyError } from '../../../../utils/friendlyError';
import FilterBar from '../../../../components/ui/FilterBar';
import {
  fetchServicesForManagement,
  fetchActiveCategories,
  toggleServiceActive,
  deleteService,
  fetchTierPricesByService,
} from '../../../../services/api';
import { useIndustry } from '../../../../hooks/useIndustry';
import { formatNPR } from '../../../../services/bookingTransformers';

// "NPR 2,500 – NPR 4,000" for a tiered service: its standard price and every tier price (a blank tier charges the standard price).
const tierRangeLabel = (service, tiers) => {
  if (service.price_type !== 'tiered' || !tiers || tiers.length === 0) return null;
  const all = [Number(service.price_npr), ...tiers];
  const lo = Math.min(...all); const hi = Math.max(...all);
  return lo === hi ? formatNPR(lo) : `${formatNPR(lo)} \u2013 ${formatNPR(hi)}`;
};

// Phone row: the short offer badge (the campaign name and the crossed-out price stay in Edit).
const offerBadge = (s) => (s.offer_enabled
  ? (s.offer_type === 'percent' ? `-${s.offer_value}%` : 'Offer')
  : s.category_offer_percent ? `-${s.category_offer_percent}%` : 'Offer');

const ServiceManagementPanel = () => {
  const navigate = useNavigate();
  const { orgSlug } = useParams();
  const { isSpa } = useIndustry();
  const [services, setServices] = useState([]);
  const [tierPrices, setTierPrices] = useState({});
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirmToggle, setConfirmToggle] = useState(null);
  const [toggling, setToggling] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [flashId, flash] = useFlashRow();
  const phone = useMediaQuery('(max-width: 767.98px)'); // below md: a card list instead of the table
  const [menuFor, setMenuFor] = useState(null);          // the service whose ⋮ sheet is open
  const [undoToast, setUndoToast] = useState(null);      // { msg, undo } shown above the phone nav, same pattern as the calendar's Assign toast
  const undoTimer = useRef(null);
  useEffect(() => () => clearTimeout(undoTimer.current), []);
  const showUndo = (toast) => {
    clearTimeout(undoTimer.current);
    setUndoToast(toast);
    undoTimer.current = setTimeout(() => setUndoToast(null), 6000);
  };

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // Filtered services
  const filteredServices = services.filter((service) => {
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (!service.name.toLowerCase().includes(query)) {
        return false;
      }
    }
    // Category filter
    if (categoryFilter !== 'all' && service.category !== categoryFilter) {
      return false;
    }
    // Status filter
    if (statusFilter === 'active' && !service.is_active) {
      return false;
    }
    if (statusFilter === 'inactive' && service.is_active) {
      return false;
    }
    return true;
  });

  const loadCategories = useCallback(async () => {
    const result = await fetchActiveCategories();
    if (!result.error) {
      setCategories(result.data || []);
    }
  }, []);

  const hasLoadedRef = useRef(false);
  const loadServices = useCallback(async () => {
    if (!hasLoadedRef.current) setLoading(true);
    setError(null);
    const result = await fetchServicesForManagement();
    if (result.error) {
      setError(friendlyError(result.error, 'Failed to load services.'));
    } else {
      setServices(result.data || []);
      // A tiered service charges by who does it, so the list shows its range, as the online page does.
      if ((result.data || []).some((x) => x.price_type === 'tiered')) {
        const tiers = await fetchTierPricesByService();
        if (!tiers.error) setTierPrices(tiers.data || {});
      }
    }
    hasLoadedRef.current = true;
    setLoading(false);
  }, []);

  useEffect(() => {
    loadCategories();
    loadServices();
  }, [loadCategories, loadServices]);

  const handleOpenCreate = () => navigate(`/${orgSlug}/services/new`);
  const handleOpenEdit = (service) => navigate(`/${orgSlug}/services/${service.id}`);

  const handleToggle = async (service) => {
    if (service.is_active) {
      setConfirmToggle(service);
      return;
    }
    await executeToggle(service, true);
  };

  const executeToggle = async (service, newState, isUndo = false) => {
    setError(null);
    setToggling(true);
    const result = await toggleServiceActive({ serviceId: service.id, isActive: newState });
    setToggling(false);
    if (result.error) {
      setError(friendlyError(result.error, 'Toggle failed.'));
    } else {
      await loadServices();
      // Undo flips it straight back (no second "Deactivate?" confirm: the person just undid their own action).
      if (!isUndo) showUndo({ msg: `${service.name} turned ${newState ? 'on' : 'off'}`, undo: async () => { clearTimeout(undoTimer.current); setUndoToast(null); await executeToggle(service, !newState, true); } });
    }
    setConfirmToggle(null);
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    setError(null);

    const result = await deleteService({ serviceId: confirmDelete.id });

    if (result.error) {
      if (result.error.code === 'HAS_BOOKINGS' || /foreign key|23503/i.test(`${result.error.code || ''} ${result.error.message || ''}`)) {
        setError(`"${confirmDelete.name}" has booking history, so it can't be deleted. Deactivate it instead to hide it from new bookings.`);
      } else {
        setError(friendlyError(result.error, 'Delete failed.'));
      }
    } else {
      await loadServices();
    }

    setConfirmDelete(null);
    setDeleting(false);
  };


  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
        <p className="font-body text-sm text-text-secondary">Loading services...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          {/* Phone: no heading (the page title is already "Services"); desktop keeps it. */}
          <h3 className="hidden md:block font-heading font-heading-semibold text-lg text-text-primary">Service Management</h3>
          <p className="font-body text-sm text-text-secondary">
            {services.length} service{services.length !== 1 ? 's' : ''} configured — price changes affect future bookings only
          </p>
        </div>
        <Button variant="primary" size="sm" iconName="Plus" iconSize={16} onClick={() => handleOpenCreate()} className="whitespace-nowrap flex-shrink-0">
          <span className="md:hidden">Add</span><span className="hidden md:inline">Add Service</span>
        </Button>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
          <Icon name="AlertCircle" size={16} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto"><Icon name="X" size={14} /></button>
        </div>
      )}

      {/* Filter Bar */}
      <FilterBar
        search={{
          value: searchQuery,
          onChange: setSearchQuery,
          placeholder: 'Search by service name...',
        }}
        filters={[
          {
            value: categoryFilter,
            onChange: setCategoryFilter,
            options: [
              { value: 'all', label: 'All Categories' },
              ...categories.map((cat) => ({ value: cat.name, label: cat.name })),
            ],
          },
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
        resultCount={{ filtered: filteredServices.length, total: services.length }}
        hasActiveFilters={searchQuery || categoryFilter !== 'all' || statusFilter !== 'all'}
        onClear={() => {
          setSearchQuery('');
          setCategoryFilter('all');
          setStatusFilter('all');
        }}
      />

      {phone && (
        <div className="bg-surface border border-border rounded-[12px] overflow-hidden" data-testid="services-cards">
          {filteredServices.length === 0 ? (
            <p className="px-4 py-8 text-center text-text-secondary font-body text-sm">
              {services.length === 0 ? (
                <>No services yet. <button type="button" onClick={() => handleOpenCreate()} className="text-primary font-body-medium hover:underline">Add the first service</button></>
              ) : 'No services match your filters.'}
            </p>
          ) : filteredServices.map((s) => {
            const price = s.is_on_offer ? formatNPR(s.effective_price_npr) : (tierRangeLabel(s, tierPrices[s.id]) || formatNPR(s.price_npr));
            return (
              <div key={s.id} role="button" tabIndex={0} onClick={() => handleOpenEdit(s)} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) handleOpenEdit(s); }}
                className={`flex items-center gap-2.5 pl-3.5 pr-1 py-[11px] min-h-[64px] border-b border-[#EEF0F1] last:border-b-0 cursor-pointer ${rowTone(false, flashId === s.id)} ${s.is_active ? '' : 'opacity-60'}`}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-text-primary line-clamp-2">{s.name}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-text-secondary whitespace-nowrap overflow-hidden">
                    {!s.is_active && <span className="flex-shrink-0 px-1.5 py-px rounded-[5px] bg-[#F1F3F4] text-[10px] font-medium">Inactive</span>}
                    <span className="min-w-0 truncate">{s.category || (isSpa ? 'Spa' : '—')}</span>
                    <span className="flex-shrink-0">· {s.duration_minutes} min ·</span>
                    <span className="flex-shrink-0 font-data text-text-primary">{price}</span>
                    {s.is_on_offer && <span className="flex-shrink-0 px-1.5 py-px rounded-[5px] bg-warning/10 text-warning text-[10px] font-medium">{offerBadge(s)}</span>}
                  </div>
                </div>
                <button type="button" onClick={(e) => { e.stopPropagation(); handleToggle(s); }} aria-label={s.is_active ? `Deactivate ${s.name}` : `Activate ${s.name}`}
                  className="flex-shrink-0 w-11 h-11 grid place-items-center">
                  <span className={`relative inline-flex h-6 w-10 items-center rounded-full spa-transition-fast ${s.is_active ? 'bg-success' : 'bg-border'}`}>
                    <span className={`inline-block h-[18px] w-[18px] rounded-full bg-white spa-transition-fast transform ${s.is_active ? 'translate-x-[19px]' : 'translate-x-[3px]'}`} />
                  </span>
                </button>
                <button type="button" onClick={(e) => { e.stopPropagation(); setMenuFor(s); }} aria-label={`More actions for ${s.name}`}
                  className="flex-shrink-0 w-11 h-11 grid place-items-center text-text-secondary">
                  <Icon name="MoreVertical" size={18} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Table */}
      {!phone && <div className="bg-surface border border-border rounded-spa overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-background border-b border-border">
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Service Name</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary hidden lg:table-cell">Category</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Duration</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Price</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary hidden md:table-cell">Description</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Status</th>
              <th className="text-right px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredServices.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-text-secondary font-body text-sm">
                  {services.length === 0 ? (
                    <>No services yet. <button type="button" onClick={() => handleOpenCreate()} className="text-primary font-body-medium hover:underline">Add the first service</button></>
                  ) : 'No services match your filters.'}
                </td>
              </tr>
            ) : (
              filteredServices.map((s) => (
                <tr key={s.id} className={`border-b border-border last:border-b-0 ${rowTone(false, flashId === s.id)}`}>
                  <td className={`px-4 py-3 font-body font-body-medium text-sm text-text-primary ${rowBar(flashId === s.id)}`}>{s.name}</td>
                  <td className="px-4 py-3 font-body text-sm text-text-secondary hidden lg:table-cell">{s.category || (isSpa ? 'Spa' : '—')}</td>
                  <td className="px-4 py-3 font-body text-sm text-text-secondary">{s.duration_minutes} min</td>
                  <td className="px-4 py-3 font-data text-sm text-text-primary">
                    {s.is_on_offer ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs text-text-tertiary line-through">{formatNPR(s.original_price_npr ?? s.price_npr)}</span>
                        <span className="flex items-center gap-1.5">
                          {formatNPR(s.effective_price_npr)}
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-caption bg-warning/10 text-warning">
                            {s.active_campaign_name
                              ? s.active_campaign_name
                              : s.offer_enabled
                              ? (s.offer_type === 'percent' ? `-${s.offer_value}%` : 'Offer')
                              : `-${s.category_offer_percent}%`}
                          </span>
                        </span>
                      </div>
                    ) : (
                      tierRangeLabel(s, tierPrices[s.id]) || formatNPR(s.price_npr)
                    )}
                  </td>
                  <td className="px-4 py-3 font-body text-sm text-text-secondary hidden md:table-cell max-w-[200px] truncate">
                    {s.description || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-caption ${
                      s.is_active
                        ? 'bg-success/10 text-success'
                        : 'bg-text-secondary/10 text-text-secondary'
                    }`}>
                      {s.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleOpenEdit(s)}
                        className="p-1.5 rounded hover:bg-background spa-transition-fast text-text-secondary hover:text-text-primary"
                        title="Edit"
                      >
                        <Icon name="Pencil" size={16} />
                      </button>
                      <button
                        onClick={() => setConfirmDelete(s)}
                        className="p-1.5 rounded hover:bg-error/10 spa-transition-fast text-text-secondary hover:text-error"
                        title="Delete"
                      >
                        <Icon name="Trash2" size={16} />
                      </button>
                      <button
                        onClick={() => handleToggle(s)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full spa-transition-fast ${
                          s.is_active ? 'bg-success' : 'bg-border'
                        }`}
                        title={s.is_active ? 'Deactivate' : 'Activate'}
                      >
                        <span className={`inline-block h-4 w-4 rounded-full bg-white spa-transition-fast transform ${
                          s.is_active ? 'translate-x-6' : 'translate-x-1'
                        }`} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>}

      {menuFor && (
        <BottomSheet isOpen onClose={() => setMenuFor(null)} title={(
          <>
            <span className="block truncate leading-tight">{menuFor.name}</span>
            <span className="block truncate text-xs font-body font-normal text-text-secondary leading-tight mt-0.5">
              {[menuFor.category || (isSpa ? 'Spa' : null), `${menuFor.duration_minutes} min`, menuFor.is_on_offer ? formatNPR(menuFor.effective_price_npr) : (tierRangeLabel(menuFor, tierPrices[menuFor.id]) || formatNPR(menuFor.price_npr)), menuFor.is_active ? 'Active' : 'Inactive'].filter(Boolean).join(' · ')}
            </span>
          </>
        )}>
          <div className="px-4 pb-3">
            <SheetRow icon="Pencil" label="Edit service" className="min-h-[52px]" onClick={() => { const s = menuFor; setMenuFor(null); handleOpenEdit(s); }} trailing={<span />} />
            <SheetRow icon={menuFor.is_active ? 'EyeOff' : 'Eye'} label={menuFor.is_active ? 'Deactivate' : 'Activate'} className="min-h-[52px]" onClick={() => { const s = menuFor; setMenuFor(null); handleToggle(s); }} trailing={<span />} />
            <SheetRow icon="Trash2" label="Delete…" danger className="min-h-[52px]" onClick={() => { const s = menuFor; setMenuFor(null); setConfirmDelete(s); }} trailing={<span />} />
          </div>
        </BottomSheet>
      )}

      {undoToast && (
        <div role="status" className="fixed toast-bottom left-4 right-4 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:max-w-[420px] z-toast px-4 py-3 rounded-spa-lg spa-shadow-elevated animate-fade-in flex items-center gap-4 bg-text-primary text-white">
          <span className="flex-1 min-w-0 truncate font-body text-sm">{undoToast.msg}</span>
          <button type="button" onClick={undoToast.undo} className="flex-shrink-0 min-h-[44px] -my-2 px-2 text-sm font-semibold text-[#9BD48F]">Undo</button>
        </div>
      )}

      {/* Deactivate / delete: small centred confirms (create / edit open the service detail page) */}
      {confirmToggle && (
        <ConfirmDialog
          title="Deactivate service?"
          message={`"${confirmToggle.name}" will be hidden from new bookings but remain in historical records.`}
          confirmLabel="Deactivate"
          requireReason={false}
          isSubmitting={toggling}
          onConfirm={() => executeToggle(confirmToggle, false)}
          onClose={() => !toggling && setConfirmToggle(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete service?"
          message={`"${confirmDelete.name}" will be permanently deleted. This action cannot be undone. Services with booking history cannot be deleted; deactivate them instead to hide them from new bookings.`}
          confirmLabel="Delete"
          requireReason={false}
          isSubmitting={deleting}
          onConfirm={handleDelete}
          onClose={() => !deleting && setConfirmDelete(null)}
        />
      )}

    </div>
  );
};

export default ServiceManagementPanel;
