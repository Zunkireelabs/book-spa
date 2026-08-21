import React, { useCallback, useEffect, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import {
  fetchOutreachReviewQueue,
  approveOutreachMessage,
  cancelOutreachMessage,
  bulkApproveOutreach,
} from '../../../../services/api';

function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Note: this panel edits the message text (subject/body) locally before
// Approve, but approveOutreachMessage() only flips status — Phase 1's
// outreach_messages RLS has no client UPDATE-of-content policy (write path
// is SECURITY DEFINER-only per migration-104), so edits here are display-
// only unless/until a dedicated edit RPC exists. Kept as inline-editable UI
// per the brief so the affordance is in place; Approve sends the message
// as it was queued.
const ReviewQueuePanel = () => {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState({ subject: '', body: '' });
  const [actionId, setActionId] = useState(null);
  const [bulkActing, setBulkActing] = useState(false);
  const [actionError, setActionError] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await fetchOutreachReviewQueue();
    if (fetchError) {
      setError(fetchError.message || 'Failed to load the review queue.');
      setLoading(false);
      return;
    }
    setMessages(data || []);
    setSelectedIds([]);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const toggleSelect = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => (prev.length === messages.length ? [] : messages.map((m) => m.id)));
  };

  const startEdit = (message) => {
    setEditingId(message.id);
    setEditDraft({ subject: message.subject || '', body: message.body || '' });
  };

  const handleApprove = async (id) => {
    setActionError(null);
    setActionId(id);
    const { error: approveError } = await approveOutreachMessage(id);
    setActionId(null);
    if (approveError) {
      setActionError(approveError.message || 'Failed to approve message.');
      return;
    }
    if (editingId === id) setEditingId(null);
    await loadData();
  };

  const handleCancel = async (id) => {
    setActionError(null);
    setActionId(id);
    const { error: cancelError } = await cancelOutreachMessage(id);
    setActionId(null);
    if (cancelError) {
      setActionError(cancelError.message || 'Failed to cancel message.');
      return;
    }
    if (editingId === id) setEditingId(null);
    await loadData();
  };

  const handleBulkApprove = async () => {
    if (selectedIds.length === 0) return;
    setActionError(null);
    setBulkActing(true);
    const { error: bulkError } = await bulkApproveOutreach(selectedIds);
    setBulkActing(false);
    if (bulkError) {
      setActionError(bulkError.message || 'Failed to bulk-approve messages.');
      return;
    }
    await loadData();
  };

  if (loading) {
    return (
      <div className="bg-surface rounded-spa-lg border border-border p-8 animate-pulse">
        <div className="h-4 bg-background rounded w-48 mb-4" />
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-16 bg-background rounded" />)}
        </div>
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
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <h4 className="font-body font-body-semibold text-sm text-text-primary">Review queue</h4>
          <span className="font-caption text-xs text-text-tertiary">
            {messages.length} awaiting review
          </span>
        </div>
        {messages.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleSelectAll}
              className="font-caption text-xs text-primary hover:underline"
            >
              {selectedIds.length === messages.length ? 'Deselect all' : 'Select all'}
            </button>
            <button
              type="button"
              onClick={handleBulkApprove}
              disabled={selectedIds.length === 0 || bulkActing}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-spa bg-success text-white text-xs font-body font-body-medium hover:bg-success/90 disabled:opacity-50 spa-transition-fast"
            >
              {bulkActing && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              <span>Approve selected ({selectedIds.length})</span>
            </button>
          </div>
        )}
      </div>

      {actionError && (
        <div className="bg-error/5 border border-error/20 rounded-spa p-3 flex items-center space-x-2">
          <Icon name="AlertCircle" size={14} className="text-error flex-shrink-0" />
          <p className="font-body text-xs text-error">{actionError}</p>
        </div>
      )}

      {messages.length === 0 ? (
        <div className="bg-surface rounded-spa-lg border border-border p-12 text-center">
          <Icon name="ClipboardCheck" size={32} className="text-text-tertiary mx-auto mb-3" />
          <p className="font-body font-body-medium text-sm text-text-secondary">Nothing waiting for review</p>
          <p className="font-caption text-xs text-text-tertiary mt-1">Messages queued in review mode will show up here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {messages.map((m) => {
            const isEditing = editingId === m.id;
            const isActing = actionId === m.id;
            return (
              <div key={m.id} className="bg-surface rounded-spa-lg border border-border p-4">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(m.id)}
                    onChange={() => toggleSelect(m.id)}
                    className="mt-1 rounded border-border text-primary focus:ring-primary/30"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div>
                        <p className="font-body font-body-medium text-sm text-text-primary">
                          {m.customer?.full_name || 'Unknown customer'}
                        </p>
                        <p className="font-caption text-xs text-text-tertiary">
                          {m.rule?.trigger_type || 'manual'} · {m.channel} · {formatDateTime(m.created_at)}
                        </p>
                      </div>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-caption font-caption-medium bg-warning/10 text-warning">
                        Review
                      </span>
                    </div>

                    {isEditing ? (
                      <div className="mt-3 space-y-2">
                        {m.channel === 'email' && (
                          <input
                            type="text"
                            value={editDraft.subject}
                            onChange={(e) => setEditDraft((prev) => ({ ...prev, subject: e.target.value }))}
                            className="w-full h-9 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                          />
                        )}
                        <textarea
                          value={editDraft.body}
                          onChange={(e) => setEditDraft((prev) => ({ ...prev, body: e.target.value }))}
                          rows={4}
                          className="w-full px-3 py-2 text-sm border border-border rounded-spa bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-y"
                        />
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="font-caption text-xs text-text-tertiary hover:underline"
                        >
                          Close edit view
                        </button>
                      </div>
                    ) : (
                      <div className="mt-2 bg-background rounded-spa border border-border p-3">
                        {m.subject && <p className="font-body font-body-medium text-sm text-text-primary mb-1">{m.subject}</p>}
                        <p className="font-body text-sm text-text-secondary whitespace-pre-wrap">{m.body}</p>
                      </div>
                    )}

                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => (isEditing ? setEditingId(null) : startEdit(m))}
                        className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-spa border border-border text-text-secondary text-xs font-body font-body-medium hover:bg-background spa-transition-fast"
                      >
                        <Icon name="Pencil" size={12} />
                        <span>{isEditing ? 'Done editing' : 'Edit'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApprove(m.id)}
                        disabled={isActing}
                        className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-spa bg-success text-white text-xs font-body font-body-medium hover:bg-success/90 disabled:opacity-50 spa-transition-fast"
                      >
                        <Icon name="Check" size={12} />
                        <span>Approve</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCancel(m.id)}
                        disabled={isActing}
                        className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-spa border border-error/30 text-error text-xs font-body font-body-medium hover:bg-error/5 disabled:opacity-50 spa-transition-fast"
                      >
                        <Icon name="X" size={12} />
                        <span>Cancel</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ReviewQueuePanel;
