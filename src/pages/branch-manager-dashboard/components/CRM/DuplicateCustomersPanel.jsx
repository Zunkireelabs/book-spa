import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Icon from '../../../../components/AppIcon';
import { fetchDuplicateCandidates, mergeCustomers, dismissDuplicateCandidate } from '../../../../services/api';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// One side of a candidate pair, shown so a manager/admin can compare before picking which
// survives as canonical — a human reviewing side-by-side may judge better than a fixed
// oldest-wins rule (unlike migration-034/035's one-off destructive merge).
const CandidateSide = ({ label, name, phone, email, branchId, createdAt, isCanonical, onPick }) => (
  <button
    type="button"
    onClick={onPick}
    className={`flex-1 text-left rounded-spa border-2 p-3 spa-transition-fast ${
      isCanonical ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
    }`}
  >
    <p className="font-caption font-caption-normal text-[10px] text-text-tertiary uppercase tracking-wide mb-1">
      {label}{isCanonical ? ' · keep this one' : ''}
    </p>
    <p className="font-body font-body-medium text-sm text-text-primary">{name}</p>
    <p className="font-caption font-caption-normal text-xs text-text-secondary mt-0.5">{phone || '—'}</p>
    {email && <p className="font-caption font-caption-normal text-xs text-text-secondary">{email}</p>}
    <p className="font-caption font-caption-normal text-[10px] text-text-tertiary mt-1">
      Since {formatDate(createdAt)} · branch {branchId ? branchId.slice(0, 8) : '—'}
    </p>
  </button>
);

const DuplicateCustomersPanel = ({ orgId, role, branchId }) => {
  const [candidates, setCandidates] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [canonicalPick, setCanonicalPick] = useState({}); // pairKey -> 'a' | 'b'
  const [busyKey, setBusyKey] = useState(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    const { data, error } = await fetchDuplicateCandidates(orgId);
    if (error) {
      setError(error.message || 'Failed to load potential duplicates.');
      setLoading(false);
      return;
    }
    setCandidates(data || []);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  // Manager sees only pairs touching their own branch; admin sees every pair in the org.
  // Merge itself is re-checked server-side inside merge_customers regardless of this filter.
  const visible = useMemo(() => {
    if (!candidates) return [];
    if (role === 'admin') return candidates;
    return candidates.filter(c => c.branch_id_a === branchId || c.branch_id_b === branchId);
  }, [candidates, role, branchId]);

  const pairKey = (c) => `${c.customer_id_a}:${c.customer_id_b}`;

  const handleMerge = async (c) => {
    const key = pairKey(c);
    const pick = canonicalPick[key] || 'a';
    const canonicalId = pick === 'a' ? c.customer_id_a : c.customer_id_b;
    const duplicateId = pick === 'a' ? c.customer_id_b : c.customer_id_a;
    setBusyKey(key);
    const { error } = await mergeCustomers(canonicalId, duplicateId);
    setBusyKey(null);
    if (error) {
      window.alert(error.message || 'Merge failed.');
      return;
    }
    await load();
  };

  const handleDismiss = async (c) => {
    const key = pairKey(c);
    setBusyKey(key);
    const { error } = await dismissDuplicateCandidate(orgId, c.customer_id_a, c.customer_id_b);
    setBusyKey(null);
    if (error) {
      window.alert(error.message || 'Failed to dismiss.');
      return;
    }
    await load();
  };

  if (loading) {
    return (
      <div className="bg-surface rounded-spa-lg border border-border p-8 animate-pulse">
        <div className="h-4 bg-background rounded w-64 mb-4" />
        <div className="space-y-3">
          {[0, 1].map(i => <div key={i} className="h-20 bg-background rounded" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-error/5 border border-error/20 rounded-spa p-4 flex items-center space-x-3">
        <Icon name="AlertCircle" size={18} className="text-error flex-shrink-0" />
        <p className="font-body text-sm text-error">{error}</p>
        <button onClick={load} className="ml-auto font-body font-body-medium text-sm text-error underline">
          Retry
        </button>
      </div>
    );
  }

  if (visible.length === 0) {
    return (
      <div className="bg-surface rounded-spa-lg border border-border text-center py-12">
        <Icon name="UserCheck" size={32} className="text-success mx-auto mb-3" />
        <p className="font-body font-body-medium text-sm text-text-primary">No potential duplicates found</p>
        <p className="font-caption text-xs text-text-tertiary mt-1">
          Customers whose phone numbers match after normalization will appear here for review.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="font-caption font-caption-normal text-xs text-text-tertiary">
        {visible.length} potential duplicate pair{visible.length !== 1 ? 's' : ''} — merging is irreversible.
      </p>
      {visible.map((c) => {
        const key = pairKey(c);
        const pick = canonicalPick[key] || 'a';
        const busy = busyKey === key;
        return (
          <div key={key} className="bg-surface rounded-spa-lg border border-border p-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <CandidateSide
                label="Record A"
                name={c.name_a}
                phone={c.phone_a}
                email={c.email_a}
                branchId={c.branch_id_a}
                createdAt={c.created_at_a}
                isCanonical={pick === 'a'}
                onPick={() => setCanonicalPick(prev => ({ ...prev, [key]: 'a' }))}
              />
              <CandidateSide
                label="Record B"
                name={c.name_b}
                phone={c.phone_b}
                email={c.email_b}
                branchId={c.branch_id_b}
                createdAt={c.created_at_b}
                isCanonical={pick === 'b'}
                onPick={() => setCanonicalPick(prev => ({ ...prev, [key]: 'b' }))}
              />
            </div>
            <div className="flex items-center justify-end gap-3 mt-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => handleDismiss(c)}
                className="font-body font-body-normal text-xs text-text-secondary hover:underline disabled:opacity-50"
              >
                Not a duplicate
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleMerge(c)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-spa bg-primary text-white text-xs font-body font-body-medium spa-transition-fast hover:bg-primary/90 disabled:opacity-50"
              >
                <Icon name="GitMerge" size={12} />
                {busy ? 'Merging…' : `Merge into ${pick === 'a' ? 'Record A' : 'Record B'}`}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default DuplicateCustomersPanel;
