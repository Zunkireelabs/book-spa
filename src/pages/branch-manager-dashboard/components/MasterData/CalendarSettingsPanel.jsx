import React, { useState } from 'react';
import Icon from '../../../../components/AppIcon';
import { useOrg } from '../../../../contexts/OrgContext';
import { updateOrgProfileSetting } from '../../../../services/api';
import { CANCEL_REASON_OPTIONS } from '../../../../components/ui/ConfirmDialog';

const INTERVAL_OPTIONS = [15, 30, 60];

const CalendarSettingsPanel = () => {
  const org = useOrg();
  const { refreshOrg, orgSettings } = org;
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState(null);

  const startTime = orgSettings?.calendar_start_time || '09:00';
  const endTime = orgSettings?.calendar_end_time || '23:00';
  const intervalMinutes = [15, 30, 60].includes(orgSettings?.calendar_interval_minutes)
    ? orgSettings.calendar_interval_minutes
    : 30;
  const showFullDay = orgSettings?.calendar_show_full_day === true;
  const savedReasons = orgSettings?.cancellation_reasons?.length
    ? orgSettings.cancellation_reasons
    : CANCEL_REASON_OPTIONS;
  // Local draft so typing a label doesn't fire a save per keystroke — only
  // committed on blur/add/remove.
  const [draftReasons, setDraftReasons] = useState(savedReasons);
  const [lastSavedKey, setLastSavedKey] = useState(JSON.stringify(savedReasons));
  if (JSON.stringify(savedReasons) !== lastSavedKey) {
    setDraftReasons(savedReasons);
    setLastSavedKey(JSON.stringify(savedReasons));
  }

  const save = async (key, value) => {
    setSaving(key);
    setError(null);
    const result = await updateOrgProfileSetting(key, value);
    if (result.error) {
      setError(result.error.message || 'Failed to update setting.');
    } else {
      await refreshOrg();
    }
    setSaving(null);
  };

  const updateReasonDraft = (index, label) => {
    setDraftReasons((prev) => prev.map((r, i) => (i === index ? { ...r, label } : r)));
  };

  const commitReasons = (next) => save('cancellation_reasons', next);

  const removeReason = (index) => {
    const next = draftReasons.filter((_, i) => i !== index);
    setDraftReasons(next);
    commitReasons(next);
  };

  const addReason = () => {
    const next = [...draftReasons, { value: `reason-${Date.now()}`, label: '' }];
    setDraftReasons(next);
    commitReasons(next);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Calendar Settings</h3>
        <p className="font-body text-sm text-text-secondary">Controls how the operational calendar displays and what cancellation reasons staff can pick from.</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
          <Icon name="AlertCircle" size={16} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto"><Icon name="X" size={14} /></button>
        </div>
      )}

      <div className="space-y-4 border border-border rounded-spa p-4">
        <h4 className="font-body font-body-medium text-sm text-text-primary">Display settings</h4>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Calendar start time</label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => {
                const v = e.target.value;
                if (v && parseInt(v.split(':')[0], 10) >= parseInt(endTime.split(':')[0], 10)) {
                  setError('Start time must be before the end time.');
                  return;
                }
                save('calendar_start_time', v);
              }}
              disabled={saving === 'calendar_start_time'}
              className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-50"
            />
            <p className="font-caption text-[11px] text-text-tertiary mt-1">The Day/Week grid's default visible starting hour.</p>
          </div>

          <div>
            <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Calendar end time</label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => {
                const v = e.target.value;
                if (v && parseInt(v.split(':')[0], 10) <= parseInt(startTime.split(':')[0], 10)) {
                  setError('End time must be after the start time.');
                  return;
                }
                save('calendar_end_time', v);
              }}
              disabled={saving === 'calendar_end_time'}
              className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-50"
            />
            <p className="font-caption text-[11px] text-text-tertiary mt-1">The Day/Week grid's last visible hour.</p>
          </div>

          <div>
            <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Calendar interval</label>
            <select
              value={intervalMinutes}
              onChange={(e) => save('calendar_interval_minutes', Number(e.target.value))}
              disabled={saving === 'calendar_interval_minutes'}
              className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-50"
            >
              {INTERVAL_OPTIONS.map((m) => (
                <option key={m} value={m}>{m} minutes</option>
              ))}
            </select>
            <p className="font-caption text-[11px] text-text-tertiary mt-1">Grid-line spacing on the Day/Week hour grid.</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pt-4 border-t border-border">
          <div>
            <p className="font-body font-body-medium text-sm text-text-primary">Show whole hours of a day</p>
            <p className="font-caption text-xs text-text-secondary mt-0.5">
              {showFullDay
                ? 'The Day/Week grid shows every hour (midnight to midnight). Hours outside the start/end time above are shaded.'
                : 'The Day/Week grid only shows the hours between the start and end time above.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => save('calendar_show_full_day', !showFullDay)}
            disabled={saving === 'calendar_show_full_day'}
            className={`relative inline-flex h-6 w-11 items-center rounded-full spa-transition-fast flex-shrink-0 disabled:opacity-50 ${
              showFullDay ? 'bg-success' : 'bg-border'
            }`}
          >
            <span className={`inline-block h-4 w-4 rounded-full bg-white spa-transition-fast transform ${
              showFullDay ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>
      </div>

      <div className="space-y-3 border border-border rounded-spa p-4">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-body font-body-medium text-sm text-text-primary">Cancellation reasons</h4>
            <p className="font-caption text-xs text-text-secondary">Shown when staff cancel a booking.</p>
          </div>
          <button
            type="button"
            onClick={addReason}
            disabled={saving === 'cancellation_reasons'}
            className="flex items-center justify-center w-8 h-8 rounded-spa bg-primary text-white hover:bg-primary/90 disabled:opacity-50 spa-transition-fast"
          >
            <Icon name="Plus" size={14} />
          </button>
        </div>

        <div className="space-y-2">
          {draftReasons.map((r, i) => (
            <div key={r.value} className="flex items-center gap-2">
              <input
                type="text"
                value={r.label}
                onChange={(e) => updateReasonDraft(i, e.target.value)}
                onBlur={() => commitReasons(draftReasons)}
                disabled={saving === 'cancellation_reasons'}
                className="flex-1 h-9 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => removeReason(i)}
                disabled={saving === 'cancellation_reasons'}
                className="p-2 rounded-spa text-error hover:bg-error/10 disabled:opacity-50 spa-transition-fast"
              >
                <Icon name="Trash2" size={14} />
              </button>
            </div>
          ))}
          {draftReasons.length === 0 && (
            <p className="font-caption text-xs text-text-tertiary">No reasons configured — add at least one.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default CalendarSettingsPanel;
