import React, { useCallback, useEffect, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import { fetchOutreachProviderConfig, upsertOutreachProviderConfig } from '../../../../services/api';

// Admin-only. Email channel only for Phase 1 — outreach_provider_config has
// no columns for secrets (migration-106); the Resend API key lives in Edge
// Function environment variables and is never entered here.
const ProviderSettingsPanel = () => {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fromAddress, setFromAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await fetchOutreachProviderConfig();
    if (fetchError) {
      setError(fetchError.message || 'Failed to load provider configuration.');
      setLoading(false);
      return;
    }
    const emailConfig = (data || []).find((c) => c.channel === 'email') || null;
    setConfig(emailConfig);
    setFromAddress(emailConfig?.from_address || '');
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaveError(null);
    setSaved(false);

    if (!fromAddress.trim()) {
      setSaveError('From address is required.');
      return;
    }

    setSaving(true);
    const { error: upsertError } = await upsertOutreachProviderConfig({
      id: config?.id,
      channel: 'email',
      provider: config?.provider || 'resend',
      fromAddress: fromAddress.trim(),
      settings: config?.settings || {},
    });
    setSaving(false);

    if (upsertError) {
      setSaveError(upsertError.message || 'Failed to save provider configuration.');
      return;
    }

    setSaved(true);
    await loadData();
  };

  if (loading) {
    return (
      <div className="bg-surface rounded-spa-lg border border-border p-8 animate-pulse">
        <div className="h-4 bg-background rounded w-48 mb-4" />
        <div className="h-10 bg-background rounded" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-error/5 border border-error/20 rounded-spa p-4 flex items-center space-x-3">
        <Icon name="AlertCircle" size={18} className="text-error flex-shrink-0" />
        <p className="font-body text-sm text-error">{error}</p>
        <button onClick={loadData} className="ml-auto font-body font-body-medium text-sm text-error underline">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-xl space-y-4">
      <div>
        <h4 className="font-body font-body-semibold text-sm text-text-primary">Email provider</h4>
        <p className="font-caption text-xs text-text-tertiary mt-0.5">Non-secret settings only — Resend via Edge Functions.</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-surface rounded-spa-lg border border-border p-4 space-y-3">
        <div>
          <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Provider</label>
          <input
            type="text"
            value={config?.provider || 'resend'}
            disabled
            className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-background text-text-secondary cursor-not-allowed"
          />
        </div>

        <div>
          <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">From address</label>
          <input
            type="email"
            value={fromAddress}
            onChange={(e) => setFromAddress(e.target.value)}
            placeholder="noreply@yourspa.com"
            className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
        </div>

        <div className="bg-accent/10 border border-accent/20 rounded-spa px-3 py-2.5 flex items-start space-x-2">
          <Icon name="Lock" size={14} className="text-secondary flex-shrink-0 mt-0.5" />
          <p className="font-body text-xs text-secondary">
            The provider API key is configured server-side in Edge Function secrets and is never entered or stored here.
          </p>
        </div>

        {saveError && (
          <div className="bg-error/5 border border-error/20 rounded-spa px-3 py-2 flex items-start space-x-2">
            <Icon name="AlertCircle" size={14} className="text-error flex-shrink-0 mt-0.5" />
            <p className="font-body text-xs text-error">{saveError}</p>
          </div>
        )}

        {saved && !saveError && (
          <div className="bg-success/5 border border-success/20 rounded-spa px-3 py-2 flex items-center space-x-2">
            <Icon name="CheckCircle2" size={14} className="text-success flex-shrink-0" />
            <p className="font-body text-xs text-success">Saved.</p>
          </div>
        )}

        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center space-x-1.5 px-3 py-2 rounded-spa bg-primary text-white text-sm font-body font-body-medium hover:bg-primary/90 disabled:opacity-50 spa-transition-fast"
        >
          {saving && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
          <span>Save changes</span>
        </button>
      </form>
    </div>
  );
};

export default ProviderSettingsPanel;
