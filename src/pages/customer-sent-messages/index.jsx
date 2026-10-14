import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import StaffSidebar from '../../components/ui/StaffSidebar';
import { useAuth } from '../../contexts/AuthContext';
import { fetchCustomerProfile, fetchOutreachMessages } from '../../services/api';

const STATUS_COLORS = {
  sent: 'bg-success/10 text-success',
  pending: 'bg-amber-100 text-amber-800',
  review: 'bg-amber-100 text-amber-800',
  failed: 'bg-error/10 text-error',
};

function formatDate(d) {
  return d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
}

// Email bodies from automated outreach rules are stored as HTML — strip
// tags for this plain-text list view rather than rendering raw markup or
// dangerouslySetInnerHTML-ing untrusted template content.
function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Full-page "Sent messages" view (Timely-style, reached via the customer
// page's Messages dropdown) rather than a modal — reuses the same
// fetchOutreachMessages the in-modal Sent view and the Outreach review
// queue already read from.
const CustomerSentMessagesPage = () => {
  const navigate = useNavigate();
  const { orgSlug, customerId } = useParams();
  const { profile } = useAuth();
  const userRole = profile?.role || 'staff';

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [customer, setCustomer] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [profileResult, messagesResult] = await Promise.all([
      fetchCustomerProfile(customerId),
      fetchOutreachMessages({ customerId, limit: 100 }),
    ]);
    if (profileResult.error) {
      setError(profileResult.error.message || 'Failed to load customer.');
      setLoading(false);
      return;
    }
    if (messagesResult.error) {
      setError(messagesResult.error.message || 'Failed to load sent messages.');
      setLoading(false);
      return;
    }
    setCustomer(profileResult.data.customer);
    setMessages(messagesResult.data || []);
    setSearch(profileResult.data.customer?.fullName || '');
    setLoading(false);
  }, [customerId]);

  useEffect(() => { load(); }, [load]);

  const filteredMessages = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return messages;
    return messages.filter(m =>
      (m.body || '').toLowerCase().includes(term) ||
      (m.subject || '').toLowerCase().includes(term) ||
      (m.to_address || '').toLowerCase().includes(term)
    );
  }, [messages, search]);

  const goBack = () => navigate(`/${orgSlug}/customers/${customerId}`);

  return (
    <div className="min-h-screen bg-background">
      <StaffSidebar userRole={userRole} onCollapseChange={setSidebarCollapsed} />

      <div className={`${sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-60'} lg:mb-0 mb-16 spa-transition-slow`}>
        <div className="sticky top-0 z-header bg-surface border-b border-border px-6 py-3">
          <button onClick={goBack} className="font-body text-sm text-text-secondary hover:text-primary spa-transition-fast">
            ← Back to {customer ? customer.fullName : 'Customer'}
          </button>
        </div>

        <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
          <h1 className="font-accent text-5xl text-text-primary">Sent Messages</h1>

          <div className="flex items-center gap-2 max-w-md">
            <div className="relative flex-1">
              <Icon name="Search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search sent messages…"
                className="w-full pl-9 pr-3 py-2 rounded-spa border border-border bg-surface font-body text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>

          {loading ? (
            <div className="text-center py-20">
              <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
              <p className="font-body text-sm text-text-secondary">Loading...</p>
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 p-4 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
              <Icon name="AlertCircle" size={16} />
              <span>{error}</span>
              <button onClick={load} className="ml-auto underline">Retry</button>
            </div>
          ) : filteredMessages.length === 0 ? (
            <div className="bg-background rounded-spa p-6 flex items-start gap-3">
              <Icon name="Info" size={18} className="text-text-tertiary flex-shrink-0 mt-0.5" />
              <p className="font-body text-sm text-text-secondary">No sent SMS or email messages found.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredMessages.map((m) => (
                <div key={m.id} className="bg-background rounded-spa p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-body font-body-medium text-sm text-text-primary capitalize">
                      {m.channel}{m.subject ? ` · ${m.subject}` : ''}
                    </span>
                    <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-caption font-caption-medium ${STATUS_COLORS[m.status] || 'bg-background text-text-secondary'}`}>
                      {m.status}
                    </span>
                  </div>
                  <p className="font-body text-sm text-text-secondary">{stripHtml(m.body)}</p>
                  <p className="font-caption text-xs text-text-tertiary mt-2">{formatDate(m.sent_at || m.created_at)} · {m.to_address}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CustomerSentMessagesPage;
