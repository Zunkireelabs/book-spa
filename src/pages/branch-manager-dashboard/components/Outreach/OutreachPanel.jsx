import React, { useState } from 'react';
import Icon from '../../../../components/AppIcon';
import { useAuth } from '../../../../contexts/AuthContext';
import RulesEditorPanel from './RulesEditorPanel';
import TemplateEditorPanel from './TemplateEditorPanel';
import ReviewQueuePanel from './ReviewQueuePanel';
import MessageLogPanel from './MessageLogPanel';
import ProviderSettingsPanel from './ProviderSettingsPanel';

const TABS = [
  { key: 'rules', label: 'Rules', icon: 'Zap' },
  { key: 'templates', label: 'Templates', icon: 'FileText' },
  { key: 'review', label: 'Review Queue', icon: 'ClipboardCheck' },
  { key: 'log', label: 'Message Log', icon: 'History' },
  { key: 'settings', label: 'Settings', icon: 'Settings', adminOnly: true },
];

// Tabbed container for the Outreach admin surface — Rules / Templates /
// Review Queue / Message Log / Settings. Settings (provider config) is
// admin-only; the other four are manager+admin per the panel's own RLS.
const OutreachPanel = () => {
  const { profile } = useAuth();
  const [activeTab, setActiveTab] = useState('rules');

  const visibleTabs = TABS.filter((t) => !t.adminOnly || profile?.role === 'admin');

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Outreach</h3>
        <p className="font-body text-sm text-text-secondary">
          Automated customer messaging — win-back, review requests, and more.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-1 bg-background border border-border rounded-spa-lg p-1">
        {visibleTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`inline-flex items-center space-x-1.5 px-3 py-2 rounded-spa text-sm font-body font-body-medium spa-transition-fast ${
              activeTab === tab.key
                ? 'bg-surface text-primary shadow-spa-resting border border-border'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface/60'
            }`}
          >
            <Icon name={tab.icon} size={14} />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'rules' && <RulesEditorPanel />}
        {activeTab === 'templates' && <TemplateEditorPanel />}
        {activeTab === 'review' && <ReviewQueuePanel />}
        {activeTab === 'log' && <MessageLogPanel />}
        {activeTab === 'settings' && profile?.role === 'admin' && <ProviderSettingsPanel />}
      </div>
    </div>
  );
};

export default OutreachPanel;
