import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { updateCustomerProfileDetails } from '../../../services/api';

const CustomerNotesTab = ({ customer, onSaved }) => {
  const [notes, setNotes] = useState(customer.notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const dirty = notes !== (customer.notes || '');

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    const result = await updateCustomerProfileDetails(customer.id, { notes });
    setSaving(false);
    if (result.error) {
      setError(result.error.message || 'Failed to save notes.');
      return;
    }
    setSaved(true);
    onSaved?.();
  };

  return (
    <div className="space-y-3">
      {error && (
        <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
          <Icon name="AlertCircle" size={16} />
          <span>{error}</span>
        </div>
      )}
      <textarea
        value={notes}
        onChange={(e) => { setNotes(e.target.value); setSaved(false); }}
        placeholder="Add a note about this customer..."
        rows={6}
        className="w-full px-3 py-2 border border-border rounded-spa font-body text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary spa-transition-fast resize-none"
      />
      <div className="flex items-center gap-3">
        <Button variant="primary" size="sm" onClick={handleSave} loading={saving} disabled={!dirty}>
          Save
        </Button>
        {saved && <span className="font-caption text-xs text-success">Saved</span>}
      </div>
    </div>
  );
};

export default CustomerNotesTab;
