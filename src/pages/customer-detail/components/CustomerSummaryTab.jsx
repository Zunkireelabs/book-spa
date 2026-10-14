import React, { useState, useEffect, useCallback, useRef } from 'react';
import Icon from '../../../components/AppIcon';
import { fetchCustomerPhotos, uploadCustomerPhoto } from '../../../services/api';

const MEMBERSHIP_STATUS_COLORS = {
  active: 'bg-success/10 text-success',
  depleted: 'bg-amber-100 text-amber-800',
  pending: 'bg-amber-100 text-amber-800',
  lapsed: 'bg-error/10 text-error',
};

const LOYALTY_CONFIG = {
  VIP:        { color: 'bg-amber-100 text-amber-800', icon: 'Crown' },
  Regular:    { color: 'bg-primary/10 text-primary', icon: 'Star' },
  Occasional: { color: 'bg-blue-100 text-blue-700', icon: 'UserCheck' },
  'At Risk':  { color: 'bg-error/10 text-error', icon: 'AlertTriangle' },
  New:        { color: 'bg-success/10 text-success', icon: 'UserPlus' },
  Standard:   { color: 'bg-background text-text-secondary', icon: 'User' },
};

function formatDate(d, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  return d ? new Date(d).toLocaleDateString('en-GB', opts) : '—';
}

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

const CustomerSummaryTab = ({ data, onNavigateTab }) => {
  const loyaltyCfg = LOYALTY_CONFIG[data.stats.loyaltyTier] || LOYALTY_CONFIG.Standard;
  const [photo, setPhoto] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState(null);
  const fileInputRef = useRef(null);

  const loadPhoto = useCallback(async () => {
    const result = await fetchCustomerPhotos(data.customer.id);
    if (!result.error) setPhoto((result.data || [])[0] || null);
  }, [data.customer.id]);

  useEffect(() => { loadPhoto(); }, [loadPhoto]);

  const handlePhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setPhotoError(null);
    const result = await uploadCustomerPhoto(data.customer.id, data.customer.branchId, file);
    setUploading(false);
    if (result.error) {
      setPhotoError(result.error.message || 'Failed to upload photo.');
      return;
    }
    loadPhoto();
  };

  return (
    <div className="space-y-8">
      {/* Loyalty badge */}
      <div className="flex items-center justify-end -mb-4">
        <span className={`inline-flex items-center space-x-1 px-3 py-1.5 rounded-full text-sm font-caption font-caption-medium ${loyaltyCfg.color}`}>
          <Icon name={loyaltyCfg.icon} size={14} />
          <span>{data.stats.loyaltyTier}</span>
        </span>
      </div>

      {/* Key:value info block + photo */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_auto] gap-x-12 gap-y-0">
        <div>
          <div className="py-3.5 flex items-center justify-between gap-3 border-b border-border">
            <span className="font-body text-base text-text-secondary">Telephone</span>
            <span className="font-body font-body-medium text-base text-text-primary">{data.customer.phone || 'n/a'}</span>
          </div>
          <div className="py-3.5 flex items-center justify-between gap-3 border-b border-border">
            <span className="font-body text-base text-text-secondary">Email</span>
            <span className="font-body font-body-medium text-base text-text-primary truncate">{data.customer.email || 'n/a'}</span>
          </div>
          <div className="py-3.5 flex items-center justify-between gap-3 border-b border-border">
            <span className="font-body text-base text-text-secondary">Date created</span>
            <span className="font-body font-body-medium text-base text-text-primary">{formatDate(data.customer.createdAt)}</span>
          </div>
        </div>
        <div>
          <div className="py-3.5 flex items-center justify-between gap-3 border-b border-border">
            <span className="font-body text-base text-text-secondary">Amount owing</span>
            <span className={`font-data font-data-medium text-base ${data.stats.amountOwing > 0 ? 'text-error' : 'text-primary'}`}>
              {formatNPR(data.stats.amountOwing)}
            </span>
          </div>
          <div className="py-3.5 flex items-center justify-between gap-3 border-b border-border">
            <span className="font-body text-base text-text-secondary">Membership balance</span>
            <span className="font-data font-data-medium text-base text-primary">
              {data.membership ? formatNPR(data.membership.balance) : '—'}
            </span>
          </div>
          <div className="py-3.5 flex items-center justify-between gap-3 border-b border-border">
            <span className="font-body text-base text-text-secondary">Loyalty tier</span>
            <span className="font-body font-body-medium text-base text-text-primary">{data.stats.loyaltyTier}</span>
          </div>
        </div>

        <div className="flex-shrink-0 pb-4">
          <div className="w-32 h-40 rounded-spa overflow-hidden border border-border bg-background flex items-center justify-center">
            {photo ? (
              <img src={photo.photo_url} alt={data.customer.fullName} className="w-full h-full object-cover" />
            ) : (
              <span className="font-caption text-sm text-text-tertiary">Photo</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="mt-2 w-32 font-caption text-xs text-primary hover:underline disabled:opacity-50 text-center"
          >
            {uploading ? 'Uploading...' : (photo ? 'Replace photo' : 'Upload new photo')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={handlePhotoChange}
            disabled={uploading}
            className="hidden"
          />
          <p className="font-caption text-[11px] text-text-tertiary mt-1 w-32 text-center">
            PNG, GIF or JPG. Max 2.0MB.
          </p>
          {photoError && <p className="font-caption text-xs text-error mt-1 w-32 text-center">{photoError}</p>}
        </div>
      </div>

      {/* Membership */}
      {data.membership && (
        <div className="bg-background rounded-spa p-3 flex items-center justify-between">
          <div>
            <div className="flex items-center space-x-2 mb-1">
              <Icon name="CreditCard" size={14} className="text-primary" />
              <span className="font-body font-body-medium text-sm text-text-primary">{data.membership.tierName}</span>
              <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-caption font-caption-medium ${MEMBERSHIP_STATUS_COLORS[data.membership.status] || 'bg-background text-text-secondary'}`}>
                {data.membership.status}
              </span>
            </div>
            <p className="font-caption font-caption-normal text-xs text-text-tertiary">
              {data.membership.membershipNumber} · Expires {formatDate(data.membership.expiryDate)}
            </p>
          </div>
          <p className="font-data font-data-medium text-sm text-text-primary">{formatNPR(data.membership.balance)}</p>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-background rounded-spa p-3">
          <p className="font-caption font-caption-normal text-[11px] text-text-tertiary mb-1">Total Revenue</p>
          <p className="font-heading font-heading-semibold text-base text-text-primary">{formatNPR(data.stats.totalRevenue)}</p>
        </div>
        <div className="bg-background rounded-spa p-3">
          <p className="font-caption font-caption-normal text-[11px] text-text-tertiary mb-1">Avg Spend</p>
          <p className="font-heading font-heading-semibold text-base text-text-primary">{formatNPR(data.stats.avgSpend)}</p>
        </div>
        <div className="bg-background rounded-spa p-3">
          <p className="font-caption font-caption-normal text-[11px] text-text-tertiary mb-1">Visits</p>
          <p className="font-heading font-heading-semibold text-base text-text-primary">
            {data.stats.completedVisits}
            <span className="font-body font-body-normal text-xs text-text-secondary ml-1">/ {data.stats.totalVisits} total</span>
          </p>
        </div>
        <div className="bg-background rounded-spa p-3">
          <p className="font-caption font-caption-normal text-[11px] text-text-tertiary mb-1">Last Visit</p>
          <p className="font-heading font-heading-semibold text-base text-text-primary">{formatDate(data.stats.lastVisitDate)}</p>
        </div>
      </div>

      {data.customer.notes && (
        <div className="bg-amber-50 border border-amber-200 rounded-spa p-3">
          <p className="font-caption font-caption-medium text-xs text-amber-700 mb-1">Notes</p>
          <p className="font-body text-sm text-amber-900">{data.customer.notes}</p>
        </div>
      )}

      {/* Appointments preview */}
      <div className="pt-6 border-t border-border">
        <h4 className="font-accent text-2xl text-text-primary mb-2">Appointments</h4>
        <button
          type="button"
          onClick={() => onNavigateTab?.('appointments')}
          className="font-body text-base text-primary hover:underline"
        >
          View all appointments
        </button>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          <div>
            <p className="font-caption text-xs uppercase tracking-wide text-text-tertiary mb-1">Last Appointment</p>
            {data.lastAppointment ? (
              <p className="font-body text-base text-text-primary">
                {formatDate(data.lastAppointment.date)} · {data.lastAppointment.serviceName}
              </p>
            ) : (
              <p className="font-body text-base text-text-tertiary">No past appointments</p>
            )}
          </div>
          <div>
            <p className="font-caption text-xs uppercase tracking-wide text-text-tertiary mb-1">Next Appointment</p>
            {data.nextAppointment ? (
              <p className="font-body text-base text-text-primary">
                {formatDate(data.nextAppointment.date)} · {data.nextAppointment.serviceName}
              </p>
            ) : (
              <p className="font-body text-base text-text-tertiary">This customer has no future appointments.</p>
            )}
          </div>
        </div>
      </div>

      {/* Sales preview */}
      <div className="pt-6 border-t border-border">
        <h4 className="font-accent text-2xl text-text-primary mb-2">Sales</h4>
        <button
          type="button"
          onClick={() => onNavigateTab?.('sales')}
          className="font-body text-base text-primary hover:underline"
        >
          View all sales
        </button>
      </div>
    </div>
  );
};

export default CustomerSummaryTab;
