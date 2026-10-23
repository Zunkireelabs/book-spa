import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import { fetchCustomerLog } from '../../../services/api';

const FIELD_LABELS = {
  full_name: 'Name',
  phone: 'Phone',
  email: 'Email',
  is_active: 'Status',
  notes: 'Notes',
  tags: 'Tags',
  gender: 'Gender',
  pronouns: 'Pronouns',
  date_of_birth: 'Date of birth',
  client_source: 'Client source',
  referred_by: 'Referred by',
  preferred_language: 'Preferred language',
  country: 'Country',
  occupation: 'Occupation',
  additional_email: 'Additional email',
  additional_phone: 'Additional phone',
  branch_id: 'Branch',
};

const ACTION_CONFIG = {
  UPDATE: { icon: 'Pencil', color: 'bg-primary/10 text-primary' },
  DELETE: { icon: 'Trash2', color: 'bg-error/10 text-error' },
  MERGE:  { icon: 'GitMerge', color: 'bg-accent/10 text-accent' },
};

function formatValue(field, value) {
  if (value === null || value === undefined) return '—';
  if (field === 'is_active') return value ? 'Active' : 'Blocked';
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatDateTime(iso) {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function EntryBody({ entry }) {
  if (entry.actionType === 'DELETE') {
    return <p className="font-body text-sm text-text-primary">Customer record deleted</p>;
  }
  if (entry.actionType === 'MERGE') {
    const name = entry.newData?.merged_customer_name;
    const phone = entry.newData?.merged_customer_phone;
    return (
      <p className="font-body text-sm text-text-primary">
        Merged {name ? <span className="font-body-medium">{name}</span> : 'a duplicate customer'}
        {phone ? ` (${phone})` : ''} into this record
      </p>
    );
  }
  // UPDATE — one line per changed field
  const fields = Object.keys(entry.newData || {});
  return (
    <div className="space-y-1">
      {fields.map((f) => (
        <p key={f} className="font-body text-sm text-text-primary">
          <span className="font-body-medium">{FIELD_LABELS[f] || f}</span> changed from{' '}
          <span className="text-text-secondary line-through">{formatValue(f, entry.oldData?.[f])}</span> to{' '}
          <span className="text-text-secondary">{formatValue(f, entry.newData?.[f])}</span>
        </p>
      ))}
    </div>
  );
}

const CustomerLogTab = ({ customerId }) => {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchCustomerLog(customerId);
    if (result.error) {
      setError(result.error.message || 'Failed to load the change log.');
    } else {
      setEntries(result.data || []);
    }
    setLoading(false);
  }, [customerId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full mx-auto" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 p-4 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
        <Icon name="AlertCircle" size={16} />
        <span>{error}</span>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="text-center py-8">
        <Icon name="History" size={24} className="text-text-tertiary mx-auto mb-2" />
        <p className="font-body text-sm text-text-tertiary">No log entries yet</p>
        <p className="font-caption text-xs text-text-tertiary mt-1">
          Profile edits, blocks, and merges touching this customer will show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="relative pl-6">
      <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" aria-hidden="true" />
      <div className="space-y-5">
        {entries.map((entry) => {
          const cfg = ACTION_CONFIG[entry.actionType] || ACTION_CONFIG.UPDATE;
          return (
            <div key={entry.id} className="relative">
              <span className={`absolute -left-6 top-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center ${cfg.color}`}>
                <Icon name={cfg.icon} size={9} />
              </span>
              <EntryBody entry={entry} />
              <p className="font-caption text-xs text-text-tertiary mt-1">
                {entry.actorName || 'System'} · {formatDateTime(entry.changedAt)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CustomerLogTab;
