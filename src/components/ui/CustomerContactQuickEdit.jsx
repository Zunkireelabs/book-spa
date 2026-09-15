import React, { useState } from 'react';
import Icon from '../AppIcon';
import { updateCustomerContact } from '../../services/api';

// Inline "add/edit email or phone" affordance dropped into the Membership /
// Voucher / Package detail modals — these customers are frequently enrolled
// phone-only, so they have no email on file and no way to reach the
// email-OTP-only customer portal until staff back-fill it here. Deliberately
// not a standalone page: there's no general customer-management surface in
// this app, and this is exactly where staff already are when they notice a
// customer has no email (migration-173).
const CustomerContactQuickEdit = ({ customerId, email, phone, onSaved }) => {
  const [editing, setEditing] = useState(false);
  const [emailInput, setEmailInput] = useState(email || '');
  const [phoneInput, setPhoneInput] = useState(phone || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const startEditing = () => {
    setEmailInput(email || '');
    setPhoneInput(phone || '');
    setError(null);
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    const { data, error: saveError } = await updateCustomerContact(customerId, {
      email: emailInput.trim() || null,
      phone: phoneInput.trim() || null,
    });

    setSaving(false);

    if (saveError) {
      setError(saveError.message || 'Failed to save contact info.');
      return;
    }

    setEditing(false);
    onSaved?.(data);
  };

  if (!customerId) return null;

  if (!editing) {
    return (
      <button
        type="button"
        onClick={startEditing}
        className="inline-flex items-center gap-1 font-caption text-xs text-text-secondary hover:text-primary spa-transition-fast"
      >
        <Icon name="Pencil" size={11} />
        {email ? 'Edit contact' : 'Add email'}
      </button>
    );
  }

  return (
    <div className="bg-background border border-border rounded-spa px-3 py-3 space-y-2.5">
      <div>
        <label className="block font-caption text-[11px] text-text-tertiary uppercase tracking-wide mb-1">Email</label>
        <input
          type="email"
          value={emailInput}
          onChange={(e) => setEmailInput(e.target.value)}
          placeholder="customer@example.com"
          className="w-full h-9 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
        />
      </div>
      <div>
        <label className="block font-caption text-[11px] text-text-tertiary uppercase tracking-wide mb-1">Phone</label>
        <input
          type="tel"
          value={phoneInput}
          onChange={(e) => setPhoneInput(e.target.value)}
          placeholder="98XXXXXXXX"
          className="w-full h-9 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
        />
      </div>

      {error && (
        <div className="bg-error/5 border border-error/20 rounded-spa px-2.5 py-1.5 flex items-start space-x-1.5">
          <Icon name="AlertCircle" size={12} className="text-error flex-shrink-0 mt-0.5" />
          <p className="font-body text-xs text-error">{error}</p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1.5 rounded-spa bg-primary text-white text-xs font-body font-body-medium hover:bg-primary/90 disabled:opacity-50 spa-transition-fast"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={saving}
          className="px-3 py-1.5 rounded-spa text-xs font-body font-body-medium text-text-secondary hover:bg-surface spa-transition-fast"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

export default CustomerContactQuickEdit;
