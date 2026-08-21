import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import CustomSelect from '../../../../components/ui/CustomSelect';
import { fetchOutreachMessages, fetchOutreachAnalytics } from '../../../../services/api';

function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'queued', label: 'Queued' },
  { value: 'review', label: 'Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'sending', label: 'Sending' },
  { value: 'sent', label: 'Sent' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const CHANNEL_OPTIONS = [
  { value: '', label: 'All channels' },
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
  { value: 'whatsapp', label: 'WhatsApp' },
];

const STATUS_PILL = {
  queued: 'bg-gray-100 text-gray-600',
  review: 'bg-warning/10 text-warning',
  approved: 'bg-primary/10 text-primary',
  sending: 'bg-primary/10 text-primary',
  sent: 'bg-success/10 text-success',
  delivered: 'bg-success/10 text-success',
  failed: 'bg-error/10 text-error',
  cancelled: 'bg-gray-100 text-gray-600',
};

const SUMMARY_CARDS = [
  { key: 'total', label: 'Total (30d)', icon: 'Send' },
  { key: 'sent', label: 'Sent', icon: 'CheckCircle2', color: 'text-success' },
  { key: 'review', label: 'In review', icon: 'Clock', color: 'text-warning' },
  { key: 'failed', label: 'Failed', icon: 'AlertCircle', color: 'text-error' },
];

// Filterable send log + a lightweight 30-day analytics summary from
// fetchOutreachAnalytics(). Date range filters use plain <input type="date">
// (not a CustomSelect — these are date pickers, not option lists).
const MessageLogPanel = () => {
  const [messages, setMessages] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('');
  const [channel, setChannel] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const filters = { limit: 200 };
    if (status) filters.status = status;
    if (channel) filters.channel = channel;
    if (dateFrom) filters.dateFrom = new Date(dateFrom).toISOString();
    if (dateTo) filters.dateTo = new Date(`${dateTo}T23:59:59`).toISOString();

    const [messagesRes, analyticsRes] = await Promise.all([
      fetchOutreachMessages(filters),
      fetchOutreachAnalytics(),
    ]);
    if (messagesRes.error) {
      setError(messagesRes.error.message || 'Failed to load the message log.');
      setLoading(false);
      return;
    }
    setMessages(messagesRes.data || []);
    setAnalytics(analyticsRes.error ? null : analyticsRes.data);
    setLoading(false);
  }, [status, channel, dateFrom, dateTo]);

  useEffect(() => { loadData(); }, [loadData]);

  const summaryValues = useMemo(() => {
    if (!analytics) return { total: '—', sent: '—', review: '—', failed: '—' };
    const sent = (analytics.byStatus?.sent || 0) + (analytics.byStatus?.delivered || 0);
    return {
      total: analytics.total,
      sent,
      review: analytics.byStatus?.review || 0,
      failed: analytics.byStatus?.failed || 0,
    };
  }, [analytics]);

  return (
    <div className="space-y-4">
      {/* Analytics summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {SUMMARY_CARDS.map((c) => (
          <div key={c.key} className="bg-surface rounded-spa-lg border border-border p-4">
            <div className="flex items-center space-x-2 mb-2">
              <Icon name={c.icon} size={14} className={c.color || 'text-text-secondary'} />
              <span className="font-caption font-caption-normal text-[11px] text-text-tertiary uppercase tracking-wide">{c.label}</span>
            </div>
            <p className={`font-heading font-heading-semibold text-xl ${c.color || 'text-text-primary'}`}>{summaryValues[c.key]}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40">
          <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Status</label>
          <CustomSelect value={status} onChange={setStatus} options={STATUS_OPTIONS} placeholder="All statuses" />
        </div>
        <div className="w-40">
          <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Channel</label>
          <CustomSelect value={channel} onChange={setChannel} options={CHANNEL_OPTIONS} placeholder="All channels" />
        </div>
        <div>
          <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
        </div>
        <div>
          <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-10 px-3 text-sm border border-border rounded-spa bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
        </div>
        {(status || channel || dateFrom || dateTo) && (
          <button
            type="button"
            onClick={() => { setStatus(''); setChannel(''); setDateFrom(''); setDateTo(''); }}
            className="inline-flex items-center space-x-1 px-2.5 py-2 rounded-spa bg-primary/10 text-primary text-xs font-caption font-caption-medium spa-transition-fast hover:bg-primary/20"
          >
            <span>Clear filters</span>
            <Icon name="X" size={12} />
          </button>
        )}
      </div>

      {loading ? (
        <div className="bg-surface rounded-spa-lg border border-border p-8 animate-pulse">
          <div className="h-4 bg-background rounded w-48 mb-4" />
          <div className="space-y-3">
            {[0, 1, 2].map((i) => <div key={i} className="h-10 bg-background rounded" />)}
          </div>
        </div>
      ) : error ? (
        <div className="bg-error/5 border border-error/20 rounded-spa p-4 flex items-center space-x-3">
          <Icon name="AlertCircle" size={18} className="text-error flex-shrink-0" />
          <p className="font-body text-sm text-error">{error}</p>
          <button onClick={loadData} className="ml-auto font-body font-body-medium text-sm text-error underline">
            Retry
          </button>
        </div>
      ) : (
        <div className="bg-surface rounded-spa-lg border border-border overflow-hidden">
          {messages.length === 0 ? (
            <div className="text-center py-12">
              <Icon name="History" size={32} className="text-text-tertiary mx-auto mb-3" />
              <p className="font-body font-body-medium text-sm text-text-secondary">No messages match these filters</p>
            </div>
          ) : (
            <div className={`overflow-x-auto ${messages.length > 10 ? 'max-h-[640px] overflow-y-auto' : ''}`}>
              <table className="w-full">
                <thead className="sticky top-0 z-sticky-filter">
                  <tr className="bg-background border-b border-border">
                    <th className="text-left px-2.5 py-2 font-body font-body-medium text-[11px] text-text-secondary">Customer</th>
                    <th className="text-left px-2.5 py-2 font-body font-body-medium text-[11px] text-text-secondary">Trigger</th>
                    <th className="text-left px-2.5 py-2 font-body font-body-medium text-[11px] text-text-secondary whitespace-nowrap">Channel</th>
                    <th className="text-left px-2.5 py-2 font-body font-body-medium text-[11px] text-text-secondary">Subject / Body</th>
                    <th className="text-left px-2.5 py-2 font-body font-body-medium text-[11px] text-text-secondary whitespace-nowrap">Sent</th>
                    <th className="text-right px-2.5 py-2 font-body font-body-medium text-[11px] text-text-secondary whitespace-nowrap">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {messages.map((m) => (
                    <tr key={m.id} className="border-b border-border last:border-0 hover:bg-background/50 spa-transition-fast">
                      <td className="px-2.5 py-1.5">
                        <span className="font-body font-body-medium text-xs text-text-primary">{m.customer?.full_name || '—'}</span>
                      </td>
                      <td className="px-2.5 py-1.5">
                        <span className="font-body font-body-normal text-xs text-text-secondary">{m.rule?.trigger_type || 'manual'}</span>
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap">
                        <span className="font-body font-body-normal text-xs text-text-secondary capitalize">{m.channel}</span>
                      </td>
                      <td className="px-2.5 py-1.5 max-w-xs">
                        <span className="font-body font-body-normal text-xs text-text-secondary truncate block">
                          {m.subject || m.body}
                        </span>
                        {m.error && <span className="font-caption text-[10px] text-error block mt-0.5">{m.error}</span>}
                      </td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap">
                        <span className="font-caption text-[11px] text-text-tertiary">{formatDateTime(m.sent_at || m.created_at)}</span>
                      </td>
                      <td className="px-2.5 py-1.5 text-right whitespace-nowrap">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-caption font-caption-medium capitalize ${STATUS_PILL[m.status] || 'bg-gray-100 text-gray-600'}`}>
                          {m.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MessageLogPanel;
