import React, { useState, useEffect, useCallback, useRef } from 'react';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import ConfirmDialog from '../../../../components/ui/ConfirmDialog';
import { useFlashRow, rowTone, rowBar } from '../../../../components/ui/PanelFormKit';
import CampaignFormPanel from './CampaignFormPanel';
import { friendlyError } from '../../../../utils/friendlyError';
import {
  fetchCampaignsForManagement,
  fetchServicesForManagement,
  fetchCategoriesForManagement,
  toggleCampaignActive,
  deleteCampaign,
} from '../../../../services/api';
import { toDateInputValue } from '../../../../utils/date';

function formatDate(d) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// A campaign's real-world status is derived from is_active + today vs. its
// date window — not a stored column, so it can never drift out of sync.
function campaignStatus(campaign) {
  if (!campaign.is_active) return { label: 'Disabled', className: 'bg-text-secondary/10 text-text-secondary' };
  const today = toDateInputValue(new Date());
  if (today < campaign.start_date) return { label: 'Scheduled', className: 'bg-accent/10 text-accent' };
  if (today > campaign.end_date) return { label: 'Ended', className: 'bg-text-secondary/10 text-text-secondary' };
  return { label: 'Live', className: 'bg-success/10 text-success' };
}

const CampaignsPanel = () => {
  const [campaigns, setCampaigns] = useState([]);
  const [services, setServices] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [panel, setPanel] = useState(null); // { campaign? } while the New / Edit panel is open
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [flashId, flash] = useFlashRow();

  const hasLoadedRef = useRef(false);
  const loadAll = useCallback(async () => {
    if (!hasLoadedRef.current) setLoading(true);
    setError(null);
    const [campaignsResult, servicesResult, categoriesResult] = await Promise.all([
      fetchCampaignsForManagement(),
      fetchServicesForManagement(),
      fetchCategoriesForManagement(),
    ]);
    if (campaignsResult.error) {
      setError(friendlyError(campaignsResult.error, 'Failed to load campaigns.'));
    } else {
      setCampaigns(campaignsResult.data || []);
    }
    setServices(servicesResult.data || []);
    setCategories(categoriesResult.data || []);
    hasLoadedRef.current = true;
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleToggle = async (campaign) => {
    setError(null);
    const result = await toggleCampaignActive({ campaignId: campaign.id, isActive: !campaign.is_active });
    if (result.error) {
      setError(friendlyError(result.error, 'Toggle failed.'));
    } else {
      await loadAll();
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    setError(null);
    const result = await deleteCampaign({ campaignId: confirmDelete.id });
    if (result.error) {
      setError(friendlyError(result.error, 'Delete failed.'));
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
        <p className="font-body text-sm text-text-secondary">Loading campaigns...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Campaigns</h3>
          <p className="font-body text-sm text-text-secondary">
            {campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''} — named promotions for specific services/categories on specific days
          </p>
        </div>
        <Button variant="primary" size="sm" iconName="Plus" iconSize={16} onClick={() => setPanel({})}>
          Add Campaign
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
          <Icon name="AlertCircle" size={16} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto"><Icon name="X" size={14} /></button>
        </div>
      )}

      <div className="bg-surface border border-border rounded-spa overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-background border-b border-border">
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Name</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Dates</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Discount</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary hidden md:table-cell">Applies to</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Status</th>
              <th className="text-right px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Actions</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-text-secondary font-body text-sm">
                  No campaigns yet. <button type="button" onClick={() => setPanel({})} className="text-primary font-body-medium hover:underline">Add the first campaign</button>
                </td>
              </tr>
            ) : (
              campaigns.map((c) => {
                const status = campaignStatus(c);
                const linkedCount = (c.service_ids?.length || 0) + (c.category_ids?.length || 0);
                return (
                  <tr key={c.id} aria-selected={panel?.campaign?.id === c.id || undefined} className={`border-b border-border last:border-b-0 ${rowTone(panel?.campaign?.id === c.id, flashId === c.id)}`}>
                    <td className={`px-4 py-3 font-body font-body-medium text-sm text-text-primary ${rowBar(panel?.campaign?.id === c.id || flashId === c.id)}`}>{c.name}</td>
                    <td className="px-4 py-3 font-body text-sm text-text-secondary">{formatDate(c.start_date)} – {formatDate(c.end_date)}</td>
                    <td className="px-4 py-3 font-data text-sm text-text-primary">{c.discount_percent}%</td>
                    <td className="px-4 py-3 font-body text-sm text-text-secondary hidden md:table-cell">
                      {c.category_ids?.length > 0 && `${c.category_ids.length} categor${c.category_ids.length !== 1 ? 'ies' : 'y'}`}
                      {c.category_ids?.length > 0 && c.service_ids?.length > 0 && ', '}
                      {c.service_ids?.length > 0 && `${c.service_ids.length} service${c.service_ids.length !== 1 ? 's' : ''}`}
                      {linkedCount === 0 && '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-caption ${status.className}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setPanel({ campaign: c })}
                          className="p-1.5 rounded hover:bg-background spa-transition-fast text-text-secondary hover:text-text-primary"
                          title="Edit"
                        >
                          <Icon name="Pencil" size={16} />
                        </button>
                        <button
                          onClick={() => setConfirmDelete(c)}
                          className="p-1.5 rounded hover:bg-error/10 spa-transition-fast text-text-secondary hover:text-error"
                          title="Delete"
                        >
                          <Icon name="Trash2" size={16} />
                        </button>
                        <button
                          onClick={() => handleToggle(c)}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full spa-transition-fast ${
                            c.is_active ? 'bg-success' : 'bg-border'
                          }`}
                          title={c.is_active ? 'Disable' : 'Enable'}
                        >
                          <span className={`inline-block h-4 w-4 rounded-full bg-white spa-transition-fast transform ${
                            c.is_active ? 'translate-x-6' : 'translate-x-1'
                          }`} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete campaign?"
          message={`"${confirmDelete.name}" will be permanently deleted. This action cannot be undone.`}
          confirmLabel="Delete"
          requireReason={false}
          isSubmitting={deleting}
          onConfirm={handleDelete}
          onClose={() => !deleting && setConfirmDelete(null)}
        />
      )}

      {panel && (
        <CampaignFormPanel
          campaign={panel.campaign}
          services={services}
          categories={categories}
          onClose={() => setPanel(null)}
          onSaved={(id, isNew) => { setPanel(null); loadAll(); if (isNew && id) flash(id); }}
        />
      )}
    </div>
  );
};

export default CampaignsPanel;
