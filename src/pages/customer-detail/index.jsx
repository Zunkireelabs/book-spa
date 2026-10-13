import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import StaffSidebar from '../../components/ui/StaffSidebar';
import CustomerOverviewTab from './components/CustomerOverviewTab';
import CustomerProfileEditSection from './components/CustomerProfileEditSection';
import { useAuth } from '../../contexts/AuthContext';
import { fetchCustomerProfile } from '../../services/api';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'profile', label: 'Profile' },
];

const CustomerDetailPage = () => {
  const navigate = useNavigate();
  const { orgSlug, customerId } = useParams();
  const { profile } = useAuth();
  const userRole = profile?.role || 'staff';

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadProfile = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    setError(null);

    const result = await fetchCustomerProfile(customerId);

    if (result.error) {
      setError(result.error.message || 'Failed to load customer profile.');
      setLoading(false);
      return;
    }

    setData(result.data);
    setLoading(false);
  }, [customerId]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const goBack = () => navigate(`/${orgSlug}/dashboard?view=customers`);

  return (
    <div className="min-h-screen bg-background">
      <StaffSidebar userRole={userRole} onCollapseChange={setSidebarCollapsed} />

      <div className={`${sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-64'} lg:mb-0 mb-16 spa-transition-slow`}>
        <div className="sticky top-0 z-header bg-surface border-b border-border px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 font-heading text-lg">
            <button onClick={goBack} className="text-primary hover:underline font-heading-semibold">Customers</button>
            <Icon name="ChevronRight" size={18} className="text-text-tertiary" />
            <span className="font-heading-semibold text-text-primary">
              {data ? data.customer.fullName : 'Customer'}
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={goBack}>Back</Button>
        </div>

        <div className="max-w-5xl mx-auto px-6 py-6 space-y-4">
          {loading && (
            <div className="text-center py-20">
              <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
              <p className="font-body text-sm text-text-secondary">Loading profile...</p>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 p-4 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
              <Icon name="AlertCircle" size={16} />
              <span>{error}</span>
              <button onClick={loadProfile} className="ml-auto underline">Retry</button>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="flex items-center gap-1 border-b border-border">
                {TABS.map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`px-3 py-2 font-body font-body-medium text-sm spa-transition-fast border-b-2 -mb-px ${
                      activeTab === tab.key
                        ? 'border-primary text-primary'
                        : 'border-transparent text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {activeTab === 'overview' && (
                <CustomerOverviewTab data={data} onReload={loadProfile} />
              )}

              {activeTab === 'profile' && (
                <CustomerProfileEditSection customer={data.customer} onSaved={loadProfile} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default CustomerDetailPage;
