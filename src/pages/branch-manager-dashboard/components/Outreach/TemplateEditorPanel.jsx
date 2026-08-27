import React, { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import CustomSelect from '../../../../components/ui/CustomSelect';
import {
  fetchOutreachTemplates,
  upsertOutreachTemplate,
  deleteOutreachTemplate,
  renderTemplatePreview,
} from '../../../../services/api';

const CHANNEL_OPTIONS = [
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS (coming soon)', disabled: true },
  { value: 'whatsapp', label: 'WhatsApp (coming soon)', disabled: true },
];

const MERGE_FIELDS = [{ token: '{{customer_name}}', label: 'Customer name' }];

const EMPTY_FORM = { id: null, key: '', channel: 'email', subject: '', body: '', isActive: true };

// Template list + edit form. body is plain text with {{customer_name}}
// mustache-style placeholders rendered server-side at send time (migration
// 108/109) — renderTemplatePreview() here is a client-side preview-only
// mirror of that same substitution, not what actually gets sent.
const TemplateEditorPanel = () => {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const bodyRef = useRef(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await fetchOutreachTemplates();
    if (fetchError) {
      setError(fetchError.message || 'Failed to load templates.');
      setLoading(false);
      return;
    }
    setTemplates(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const selectTemplate = (template) => {
    setFormError(null);
    if (!template) {
      setForm(EMPTY_FORM);
      return;
    }
    setForm({
      id: template.id,
      key: template.key,
      channel: template.channel,
      subject: template.subject || '',
      body: template.body || '',
      isActive: template.is_active,
    });
  };

  const insertMergeField = (token) => {
    const el = bodyRef.current;
    if (!el) {
      setForm((prev) => ({ ...prev, body: `${prev.body}${token}` }));
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const nextBody = `${form.body.slice(0, start)}${token}${form.body.slice(end)}`;
    setForm((prev) => ({ ...prev, body: nextBody }));
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + token.length;
      el.setSelectionRange(cursor, cursor);
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);

    if (!form.key.trim()) { setFormError('Template key is required.'); return; }
    if (!form.body.trim()) { setFormError('Template body is required.'); return; }

    setSaving(true);
    const { error: saveError } = await upsertOutreachTemplate({
      id: form.id || undefined,
      key: form.key,
      channel: form.channel,
      subject: form.subject || null,
      body: form.body,
      isActive: form.isActive,
    });
    setSaving(false);

    if (saveError) {
      setFormError(saveError.message || 'Failed to save template.');
      return;
    }

    setForm(EMPTY_FORM);
    await loadData();
  };

  const handleDelete = async (id) => {
    setDeletingId(id);
    const { error: deleteError } = await deleteOutreachTemplate(id);
    setDeletingId(null);
    if (deleteError) {
      setError(deleteError.message || 'Failed to delete template.');
      return;
    }
    if (form.id === id) setForm(EMPTY_FORM);
    await loadData();
  };

  const preview = renderTemplatePreview({ subject: form.subject, body: form.body });

  if (loading) {
    return (
      <div className="bg-surface rounded-spa-lg border border-border p-8 animate-pulse">
        <div className="h-4 bg-background rounded w-48 mb-4" />
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-10 bg-background rounded" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      {/* List */}
      <div className="lg:col-span-2 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-body font-body-semibold text-sm text-text-primary">Templates</h4>
          <button
            type="button"
            onClick={() => selectTemplate(null)}
            className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-spa bg-primary/10 text-primary text-xs font-body font-body-medium hover:bg-primary/20 spa-transition-fast"
          >
            <Icon name="Plus" size={12} />
            <span>New</span>
          </button>
        </div>

        {error && (
          <div className="bg-error/5 border border-error/20 rounded-spa p-3 flex items-center space-x-2">
            <Icon name="AlertCircle" size={14} className="text-error flex-shrink-0" />
            <p className="font-body text-xs text-error">{error}</p>
          </div>
        )}

        {templates.length === 0 ? (
          <div className="bg-surface rounded-spa-lg border border-border p-8 text-center">
            <Icon name="FileText" size={28} className="text-text-tertiary mx-auto mb-2" />
            <p className="font-body font-body-medium text-sm text-text-secondary">No templates yet</p>
          </div>
        ) : (
          <div className="bg-surface rounded-spa-lg border border-border overflow-hidden divide-y divide-border">
            {templates.map((t) => (
              <div
                key={t.id}
                onClick={() => selectTemplate(t)}
                className={`px-3 py-2.5 cursor-pointer spa-transition-fast flex items-center justify-between gap-2 ${
                  form.id === t.id ? 'bg-primary/5' : 'hover:bg-background/50'
                }`}
              >
                <div className="min-w-0">
                  <p className="font-body font-body-medium text-sm text-text-primary truncate">{t.key}</p>
                  <p className="font-caption text-xs text-text-tertiary">
                    {t.channel} {!t.is_active && '· inactive'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleDelete(t.id); }}
                  disabled={deletingId === t.id}
                  className="p-1.5 rounded-spa hover:bg-error/10 spa-transition-fast disabled:opacity-50 flex-shrink-0"
                >
                  <Icon name="Trash2" size={14} className="text-error" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Editor + preview */}
      <div className="lg:col-span-3 space-y-4">
        <form onSubmit={handleSubmit} className="bg-surface rounded-spa-lg border border-border p-4 space-y-3">
          <h4 className="font-body font-body-semibold text-sm text-text-primary">
            {form.id ? 'Edit template' : 'New template'}
          </h4>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Key</label>
              <input
                type="text"
                value={form.key}
                onChange={(e) => setForm((prev) => ({ ...prev, key: e.target.value }))}
                placeholder="e.g. win_back_email"
                className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
            <div>
              <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Channel</label>
              <CustomSelect
                value={form.channel}
                onChange={(v) => setForm((prev) => ({ ...prev, channel: v }))}
                options={CHANNEL_OPTIONS}
                placeholder="Select channel"
              />
            </div>
          </div>

          <div>
            <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Subject (email only)</label>
            <input
              type="text"
              value={form.subject}
              onChange={(e) => setForm((prev) => ({ ...prev, subject: e.target.value }))}
              placeholder="We miss you at Nuad Thai Spa!"
              className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block font-body font-body-medium text-xs text-text-secondary">Body</label>
              <div className="flex items-center gap-1.5">
                {MERGE_FIELDS.map((f) => (
                  <button
                    key={f.token}
                    type="button"
                    onClick={() => insertMergeField(f.token)}
                    className="inline-flex items-center space-x-1 px-2 py-1 rounded-spa bg-accent/10 text-secondary text-[11px] font-caption font-caption-medium hover:bg-accent/20 spa-transition-fast"
                    title={`Insert ${f.label}`}
                  >
                    <Icon name="Plus" size={10} />
                    <span>{f.token}</span>
                  </button>
                ))}
              </div>
            </div>
            <textarea
              ref={bodyRef}
              value={form.body}
              onChange={(e) => setForm((prev) => ({ ...prev, body: e.target.value }))}
              rows={6}
              placeholder="Hi {{customer_name}}, it's been a while..."
              className="w-full px-3 py-2 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-y"
            />
          </div>

          <label className="inline-flex items-center space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((prev) => ({ ...prev, isActive: e.target.checked }))}
              className="rounded border-border text-primary focus:ring-primary/30"
            />
            <span className="font-body text-xs text-text-secondary">Active</span>
          </label>

          {formError && (
            <div className="bg-error/5 border border-error/20 rounded-spa px-3 py-2 flex items-start space-x-2">
              <Icon name="AlertCircle" size={14} className="text-error flex-shrink-0 mt-0.5" />
              <p className="font-body text-xs text-error">{formError}</p>
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            {form.id && (
              <button
                type="button"
                onClick={() => selectTemplate(null)}
                className="px-3 py-2 rounded-spa border border-border text-text-secondary text-sm font-body font-body-medium hover:bg-background spa-transition-fast"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center space-x-1.5 px-3 py-2 rounded-spa bg-primary text-white text-sm font-body font-body-medium hover:bg-primary/90 disabled:opacity-50 spa-transition-fast"
            >
              {saving && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              <span>{form.id ? 'Save changes' : 'Create template'}</span>
            </button>
          </div>
        </form>

        {/* Live preview */}
        <div className="bg-background rounded-spa-lg border border-border p-4">
          <h4 className="font-body font-body-medium text-xs text-text-secondary mb-2 uppercase tracking-wide">Preview</h4>
          <div className="bg-surface rounded-spa border border-border p-3 space-y-1.5">
            {form.channel === 'email' && preview.subject && (
              <p className="font-body font-body-semibold text-sm text-text-primary">{preview.subject}</p>
            )}
            <p className="font-body text-sm text-text-secondary whitespace-pre-wrap">
              {preview.body || 'Preview will appear here as you type.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TemplateEditorPanel;
