import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../../components/AppIcon';
import {
  fetchMembershipTiers,
  createMembershipTier,
  updateMembershipTier,
} from '../../../../services/api';

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

const EMPTY_FORM = {
  name: '',
  codePrefix: '',
  advanceAmount: '',
  validityDays: '365',
  displayOrder: '',
};

const TiersModal = ({ orgId, onClose, onChanged }) => {
  const [tiers, setTiers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  const loadTiers = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: e } = await fetchMembershipTiers(orgId, { includeInactive: true });
    if (e) { setError(e.message || 'Failed to load tiers.'); setLoading(false); return; }
    setTiers(data || []);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { loadTiers(); }, [loadTiers]);

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const updateForm = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const handleSubmitNew = async (e) => {
    e.preventDefault();
    setFormError(null);
    if (!form.name.trim()) { setFormError('Tier name is required.'); return; }
    if (!form.codePrefix.trim()) { setFormError('Code prefix is required (e.g., PCM, DCM, GLD).'); return; }
    if (!form.codePrefix.match(/^[A-Za-z]{2,5}$/)) {
      setFormError('Code prefix must be 2–5 letters with no digits or symbols.');
      return;
    }
    if (!(Number(form.advanceAmount) > 0)) { setFormError('Advance amount must be greater than zero.'); return; }

    // Avoid an obvious duplicate before hitting the DB (RLS will reject anyway).
    const prefixUpper = form.codePrefix.trim().toUpperCase();
    if (tiers.some((t) => t.name.toLowerCase() === form.name.trim().toLowerCase())) {
      setFormError(`A tier called "${form.name.trim()}" already exists in this org.`);
      return;
    }
    if (tiers.some((t) => (t.code_prefix || '').toUpperCase() === prefixUpper)) {
      setFormError(`Prefix "${prefixUpper}" is already used by another tier.`);
      return;
    }

    setSubmitting(true);
    const { error: createErr } = await createMembershipTier({
      orgId,
      name: form.name,
      codePrefix: prefixUpper,
      advanceAmount: Number(form.advanceAmount),
      validityDays: Number(form.validityDays) || 365,
      displayOrder: Number(form.displayOrder) || tiers.length + 1,
    });
    setSubmitting(false);
    if (createErr) { setFormError(createErr.message || 'Failed to create tier.'); return; }

    setForm(EMPTY_FORM);
    await loadTiers();
    if (onChanged) onChanged();
  };

  const handleToggleActive = async (tier) => {
    const { error: e } = await updateMembershipTier({ id: tier.id, isActive: !tier.is_active });
    if (e) {
      setError(e.message || 'Failed to update tier.');
      return;
    }
    await loadTiers();
    if (onChanged) onChanged();
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-modal" onClick={onClose} aria-hidden="true" />
      <div
        className="fixed inset-y-0 right-0 w-full max-w-lg bg-surface border-l border-border z-modal-overlay shadow-xl overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tiers-modal-title"
      >
        <div className="sticky top-0 bg-surface border-b border-border px-6 py-4 flex items-center justify-between z-header">
          <h2 id="tiers-modal-title" className="font-heading font-heading-semibold text-lg text-text-primary">
            Manage tiers
          </h2>
          <button onClick={onClose} className="p-2 rounded-spa hover:bg-background spa-transition-fast">
            <Icon name="X" size={18} className="text-text-secondary" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* Existing tiers */}
          <div>
            <h3 className="font-heading font-heading-semibold text-sm text-text-primary mb-2">Current tiers</h3>
            {loading ? (
              <p className="font-body text-sm text-text-tertiary">Loading...</p>
            ) : error ? (
              <div className="bg-error/5 border border-error/20 rounded-spa p-3 flex items-center space-x-2">
                <Icon name="AlertCircle" size={14} className="text-error" />
                <p className="font-body text-xs text-error">{error}</p>
              </div>
            ) : tiers.length === 0 ? (
              <p className="font-body text-sm text-text-tertiary">No tiers yet — add one below.</p>
            ) : (
              <div className="bg-surface border border-border rounded-spa overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-background border-b border-border">
                      <th className="text-left px-3 py-2 font-body font-body-medium text-[11px] text-text-secondary">Tier</th>
                      <th className="text-left px-3 py-2 font-body font-body-medium text-[11px] text-text-secondary">Prefix</th>
                      <th className="text-right px-3 py-2 font-body font-body-medium text-[11px] text-text-secondary">Advance</th>
                      <th className="text-right px-3 py-2 font-body font-body-medium text-[11px] text-text-secondary">Days</th>
                      <th className="text-right px-3 py-2 font-body font-body-medium text-[11px] text-text-secondary">Active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tiers.map((t) => (
                      <tr key={t.id} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 font-body text-sm text-text-primary">{t.name}</td>
                        <td className="px-3 py-2 font-data font-data-medium text-xs text-text-secondary tracking-wide">{t.code_prefix}</td>
                        <td className="px-3 py-2 text-right font-data text-sm text-text-primary">{formatNPR(t.advance_amount)}</td>
                        <td className="px-3 py-2 text-right font-data text-xs text-text-secondary">{t.validity_days}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => handleToggleActive(t)}
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-caption font-caption-medium spa-transition-fast ${
                              t.is_active
                                ? 'bg-success/10 text-success hover:bg-success/20'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                          >
                            {t.is_active ? 'Active' : 'Inactive'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 font-caption text-[11px] text-text-tertiary">
              Toggling Inactive hides the tier from enrollment and the marketing page. Existing members keep their cards.
              Code prefix is permanent once a tier has members (existing card numbers depend on it).
            </p>
          </div>

          {/* Add new tier */}
          <form onSubmit={handleSubmitNew} className="bg-background border border-border rounded-spa p-4 space-y-3">
            <h3 className="font-heading font-heading-semibold text-sm text-text-primary">Add new tier</h3>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Tier name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => updateForm({ name: e.target.value })}
                  placeholder="e.g., Gold Club"
                  className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>
              <div>
                <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Code prefix (2–5 letters)</label>
                <input
                  type="text"
                  value={form.codePrefix}
                  onChange={(e) => updateForm({ codePrefix: e.target.value.toUpperCase() })}
                  placeholder="e.g., GLD"
                  maxLength={5}
                  className="w-full h-10 px-3 text-sm font-data font-data-medium tracking-wide border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Advance amount (NPR)</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={form.advanceAmount}
                  onChange={(e) => updateForm({ advanceAmount: e.target.value })}
                  placeholder="e.g., 75000"
                  className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>
              <div>
                <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Validity (days)</label>
                <input
                  type="number"
                  min="1"
                  value={form.validityDays}
                  onChange={(e) => updateForm({ validityDays: e.target.value })}
                  className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>
            </div>

            <div>
              <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Display order (optional)</label>
              <input
                type="number"
                min="0"
                value={form.displayOrder}
                onChange={(e) => updateForm({ displayOrder: e.target.value })}
                placeholder={`Leave blank to append (will be ${tiers.length + 1})`}
                className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>

            {formError && (
              <div className="bg-error/5 border border-error/20 rounded-spa px-3 py-2 flex items-start space-x-2">
                <Icon name="AlertCircle" size={14} className="text-error flex-shrink-0 mt-0.5" />
                <p className="font-body text-xs text-error">{formError}</p>
              </div>
            )}

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center space-x-1.5 px-3 py-2 rounded-spa bg-primary text-white text-sm font-body font-body-medium hover:bg-primary/90 disabled:opacity-50 spa-transition-fast"
              >
                {submitting && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                <Icon name="Plus" size={14} />
                <span>Add tier</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
};

export default TiersModal;
