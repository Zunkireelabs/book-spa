import React, { useState } from 'react';
import Icon from '../../../../components/AppIcon';
import { useOrg } from '../../../../contexts/OrgContext';
import { updateOrgBookingSetting } from '../../../../services/api';

const TOGGLES = [
  {
    key: 'show_staff_selection',
    orgField: 'showStaffSelection',
    label: 'Show staff during booking',
    // The customer-facing staff-picker UI itself is a separate, future piece of work —
    // this toggle only plumbs the setting end-to-end (DB -> RPC -> context).
    description: 'Let customers pick their preferred staff member when booking (Fresha-style), instead of only a gender preference. Customer-facing picker UI is coming in a later update.',
  },
  {
    key: 'enable_staff_ratings',
    orgField: 'enableStaffRatings',
    label: 'Enable staff ratings',
    description: 'Show an admin-set rating on each staff member\'s profile.',
  },
];

const BookingSettingsPanel = () => {
  const org = useOrg();
  const { refreshOrg } = org;
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState(null);

  const handleToggle = async (toggle, nextValue) => {
    setSaving(toggle.key);
    setError(null);
    const result = await updateOrgBookingSetting(toggle.key, nextValue);
    if (result.error) {
      setError(result.error.message || 'Failed to update setting.');
    } else {
      await refreshOrg();
    }
    setSaving(null);
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Booking Settings</h3>
        <p className="font-body text-sm text-text-secondary">Org-wide toggles for the customer booking flow</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
          <Icon name="AlertCircle" size={16} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto"><Icon name="X" size={14} /></button>
        </div>
      )}

      <div className="space-y-3">
        {TOGGLES.map((toggle) => {
          const enabled = org[toggle.orgField] === true;
          return (
            <label
              key={toggle.key}
              className="flex items-center justify-between p-3 border border-border rounded-spa cursor-pointer hover:bg-background"
            >
              <div className="pr-4">
                <span className="font-body font-body-medium text-sm text-text-primary">{toggle.label}</span>
                <p className="font-caption text-xs text-text-secondary">{toggle.description}</p>
              </div>
              <button
                type="button"
                disabled={saving === toggle.key}
                onClick={() => handleToggle(toggle, !enabled)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full spa-transition-fast ${
                  enabled ? 'bg-success' : 'bg-border'
                } ${saving === toggle.key ? 'opacity-50' : ''}`}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-white spa-transition-fast transform ${
                  enabled ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </label>
          );
        })}
      </div>
    </div>
  );
};

export default BookingSettingsPanel;
