import React, { useCallback, useEffect, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import CustomSelect from '../../../../components/ui/CustomSelect';
import {
  fetchOutreachRules,
  fetchOutreachTemplates,
  createOutreachRule,
  updateOutreachRule,
  toggleOutreachRule,
} from '../../../../services/api';

// All 5 Phase-2-ready trigger types render generically — only win_back and
// review_request are actually meaningful in Phase 1 (their numeric params
// are the ones that matter), but the other three slot in without any UI
// change once their scan jobs ship.
const TRIGGER_TYPES = [
  { key: 'win_back', label: 'Win-back', description: 'Re-engage customers who haven’t booked in a while.' },
  { key: 'review_request', label: 'Review request', description: 'Ask for a review after a completed booking.' },
  { key: 'renewal_reminder', label: 'Renewal reminder', description: 'Remind customers before a membership/package renews.' },
  { key: 'birthday', label: 'Birthday', description: 'Send a birthday greeting/offer.' },
  { key: 'rebooking', label: 'Rebooking', description: 'Nudge customers to rebook after a regular interval.' },
];

const CHANNEL_OPTIONS = [
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS (coming soon)', disabled: true },
  { value: 'whatsapp', label: 'WhatsApp (coming soon)', disabled: true },
];

const SEND_MODE_OPTIONS = [
  { value: 'review', label: 'Review before sending' },
  { value: 'auto', label: 'Send automatically' },
];

// Trigger-specific numeric params — each rule only shows the ones relevant
// to its trigger_type, but the field itself is generic so Phase 2 triggers
// don't need new UI.
const TRIGGER_PARAM_FIELDS = {
  win_back: [{ key: 'lapsedDays', dbKey: 'lapsed_days', label: 'Lapsed days', hint: 'Days since last booking before this fires.' }],
  review_request: [{ key: 'reviewDelayHours', dbKey: 'review_delay_hours', label: 'Delay (hours)', hint: 'Hours after completion before requesting a review.' }],
  renewal_reminder: [{ key: 'renewalDaysBefore', dbKey: 'renewal_days_before', label: 'Days before renewal', hint: 'How many days ahead of renewal to send.' }],
  birthday: [{ key: 'birthdayLeadDays', dbKey: 'birthday_lead_days', label: 'Lead days', hint: 'Days before the birthday to send.' }],
  rebooking: [{ key: 'rebookingIntervalDays', dbKey: 'rebooking_interval_days', label: 'Interval (days)', hint: 'Days between visits before nudging to rebook.' }],
};

function buildRuleRow(triggerType, existingRule, templates) {
  const compatibleTemplate = templates.find((t) => t.channel === (existingRule?.channel || 'email'));
  return {
    id: existingRule?.id || null,
    triggerType,
    enabled: existingRule?.enabled ?? false,
    channel: existingRule?.channel || 'email',
    templateId: existingRule?.template_id || compatibleTemplate?.id || '',
    sendMode: existingRule?.send_mode || 'review',
    lapsedDays: existingRule?.lapsed_days ?? '',
    reviewDelayHours: existingRule?.review_delay_hours ?? 24,
    renewalDaysBefore: existingRule?.renewal_days_before ?? '',
    rebookingIntervalDays: existingRule?.rebooking_interval_days ?? '',
    birthdayLeadDays: existingRule?.birthday_lead_days ?? '',
  };
}

// One row per trigger type (Phase 1 enforces at most one rule per trigger
// type per org via a DB unique constraint) — rows without a saved rule yet
// render as an editable draft that calls createOutreachRule() on first save.
const RulesEditorPanel = () => {
  const [rules, setRules] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savingKey, setSavingKey] = useState(null);
  const [rowErrors, setRowErrors] = useState({});
  const [drafts, setDrafts] = useState({});

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [rulesRes, templatesRes] = await Promise.all([fetchOutreachRules(), fetchOutreachTemplates()]);
    if (rulesRes.error) {
      setError(rulesRes.error.message || 'Failed to load outreach rules.');
      setLoading(false);
      return;
    }
    setRules(rulesRes.data || []);
    setTemplates((templatesRes.data || []).filter((t) => t.is_active));
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const getRow = (triggerType) => {
    if (drafts[triggerType]) return drafts[triggerType];
    const existing = rules.find((r) => r.trigger_type === triggerType);
    return buildRuleRow(triggerType, existing, templates);
  };

  const setRow = (triggerType, patch) => {
    setDrafts((prev) => ({ ...prev, [triggerType]: { ...getRow(triggerType), ...patch } }));
  };

  const templatesForChannel = (channel) => templates.filter((t) => t.channel === channel);

  const handleSave = async (triggerType) => {
    const row = getRow(triggerType);
    setRowErrors((prev) => ({ ...prev, [triggerType]: null }));

    if (!row.templateId) {
      setRowErrors((prev) => ({ ...prev, [triggerType]: 'Select a template before saving.' }));
      return;
    }

    setSavingKey(triggerType);
    const paramFields = TRIGGER_PARAM_FIELDS[triggerType] || [];
    const payload = {
      channel: row.channel,
      templateId: row.templateId,
      sendMode: row.sendMode,
      enabled: row.enabled,
    };
    paramFields.forEach((f) => {
      payload[f.key] = row[f.key] === '' ? null : Number(row[f.key]);
    });

    const existing = rules.find((r) => r.trigger_type === triggerType);
    const { data, error: saveError } = existing
      ? await updateOutreachRule(existing.id, payload)
      : await createOutreachRule({ triggerType, ...payload });

    setSavingKey(null);

    if (saveError) {
      setRowErrors((prev) => ({ ...prev, [triggerType]: saveError.message || 'Failed to save rule.' }));
      return;
    }

    setDrafts((prev) => {
      const next = { ...prev };
      delete next[triggerType];
      return next;
    });
    void data;
    await loadData();
  };

  const handleToggle = async (triggerType) => {
    const existing = rules.find((r) => r.trigger_type === triggerType);
    if (!existing) {
      // No saved rule yet — just flip the draft's enabled flag locally.
      setRow(triggerType, { enabled: !getRow(triggerType).enabled });
      return;
    }
    setSavingKey(`toggle-${triggerType}`);
    const { error: toggleError } = await toggleOutreachRule(existing.id, !existing.enabled);
    setSavingKey(null);
    if (toggleError) {
      setRowErrors((prev) => ({ ...prev, [triggerType]: toggleError.message || 'Failed to toggle rule.' }));
      return;
    }
    await loadData();
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-surface rounded-spa-lg border border-border p-4 animate-pulse">
            <div className="h-4 bg-background rounded w-40 mb-3" />
            <div className="h-10 bg-background rounded" />
          </div>
        ))}
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
    <div className="space-y-3">
      {TRIGGER_TYPES.map((trigger) => {
        const row = getRow(trigger.key);
        const paramFields = TRIGGER_PARAM_FIELDS[trigger.key] || [];
        const isSaving = savingKey === trigger.key || savingKey === `toggle-${trigger.key}`;
        const hasSavedRule = rules.some((r) => r.trigger_type === trigger.key);

        return (
          <div key={trigger.key} className="bg-surface rounded-spa-lg border border-border p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h4 className="font-body font-body-semibold text-sm text-text-primary">{trigger.label}</h4>
                <p className="font-caption text-xs text-text-tertiary mt-0.5">{trigger.description}</p>
              </div>
              <button
                type="button"
                onClick={() => handleToggle(trigger.key)}
                disabled={isSaving}
                aria-pressed={row.enabled}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full spa-transition-fast disabled:opacity-50 ${
                  row.enabled ? 'bg-primary' : 'bg-border'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white spa-transition-fast ${
                    row.enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Channel</label>
                <CustomSelect
                  value={row.channel}
                  onChange={(v) => setRow(trigger.key, { channel: v, templateId: '' })}
                  options={CHANNEL_OPTIONS}
                  placeholder="Select channel"
                />
              </div>
              <div>
                <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Template</label>
                <CustomSelect
                  value={row.templateId}
                  onChange={(v) => setRow(trigger.key, { templateId: v })}
                  options={templatesForChannel(row.channel).map((t) => ({ value: t.id, label: t.key }))}
                  placeholder={templatesForChannel(row.channel).length === 0 ? 'No templates for this channel' : 'Select template'}
                  disabled={templatesForChannel(row.channel).length === 0}
                />
              </div>
              <div>
                <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Send mode</label>
                <CustomSelect
                  value={row.sendMode}
                  onChange={(v) => setRow(trigger.key, { sendMode: v })}
                  options={SEND_MODE_OPTIONS}
                  placeholder="Select send mode"
                />
              </div>
              {paramFields.map((f) => (
                <div key={f.key}>
                  <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">{f.label}</label>
                  <input
                    type="number"
                    min="0"
                    value={row[f.key]}
                    onChange={(e) => setRow(trigger.key, { [f.key]: e.target.value })}
                    placeholder={f.hint}
                    className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                </div>
              ))}
            </div>

            {rowErrors[trigger.key] && (
              <div className="mt-3 bg-error/5 border border-error/20 rounded-spa px-3 py-2 flex items-start space-x-2">
                <Icon name="AlertCircle" size={14} className="text-error flex-shrink-0 mt-0.5" />
                <p className="font-body text-xs text-error">{rowErrors[trigger.key]}</p>
              </div>
            )}

            <div className="mt-3 flex items-center justify-end">
              <button
                type="button"
                onClick={() => handleSave(trigger.key)}
                disabled={isSaving}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-spa bg-primary text-white text-xs font-body font-body-medium hover:bg-primary/90 disabled:opacity-50 spa-transition-fast"
              >
                {savingKey === trigger.key && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                <span>{hasSavedRule ? 'Save changes' : 'Create rule'}</span>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default RulesEditorPanel;
