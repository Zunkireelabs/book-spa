import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';

const AlertsNotificationPanel = () => {
  const [alerts, setAlerts] = useState([
    {
      id: 1,
      type: 'urgent',
      title: 'Double Booking Detected',
      message: 'Emma Wilson has conflicting appointments at 2:30 PM today',
      timestamp: new Date(Date.now() - 300000), // 5 minutes ago
      action: 'resolve',
      resolved: false,
      bookingId: 'BK-2024-156'
    },
    {
      id: 2,
      type: 'warning',
      title: 'Customer Complaint',
      message: 'Priya Sharma reported service quality issues - requires immediate attention',
      timestamp: new Date(Date.now() - 900000), // 15 minutes ago
      action: 'review',
      resolved: false,
      customerId: 'CU-2024-089'
    },
    {
      id: 3,
      type: 'info',
      title: 'Staff Schedule Change',
      message: 'Michael Chen requested schedule modification for tomorrow',
      timestamp: new Date(Date.now() - 1800000), // 30 minutes ago
      action: 'approve',
      resolved: false,
      staffId: 'ST-2024-003'
    },
    {
      id: 4,
      type: 'success',
      title: 'Revenue Milestone',
      message: 'Daily revenue target of NPR 50,000 achieved 2 hours early',
      timestamp: new Date(Date.now() - 3600000), // 1 hour ago
      action: 'view',
      resolved: true,
      milestone: 'daily_target'
    },
    {
      id: 5,
      type: 'warning',
      title: 'Equipment Maintenance',
      message: 'Hot stone heater in Room 3 requires maintenance check',
      timestamp: new Date(Date.now() - 7200000), // 2 hours ago
      action: 'schedule',
      resolved: false,
      equipmentId: 'EQ-2024-015'
    }
  ]);

  const [filter, setFilter] = useState('all');

  const getAlertConfig = (type) => {
    switch (type) {
      case 'urgent':
        return {
          color: 'border-l-error bg-error/5',
          iconColor: 'text-error',
          icon: 'AlertTriangle',
          bgColor: 'bg-error/10'
        };
      case 'warning':
        return {
          color: 'border-l-warning bg-warning/5',
          iconColor: 'text-warning',
          icon: 'AlertCircle',
          bgColor: 'bg-warning/10'
        };
      case 'info':
        return {
          color: 'border-l-primary bg-primary/5',
          iconColor: 'text-primary',
          icon: 'Info',
          bgColor: 'bg-primary/10'
        };
      case 'success':
        return {
          color: 'border-l-success bg-success/5',
          iconColor: 'text-success',
          icon: 'CheckCircle',
          bgColor: 'bg-success/10'
        };
      default:
        return {
          color: 'border-l-text-secondary bg-background',
          iconColor: 'text-text-secondary',
          icon: 'Bell',
          bgColor: 'bg-text-secondary/10'
        };
    }
  };

  const getTimeAgo = (timestamp) => {
    const now = new Date();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    
    if (minutes < 1) return 'Just now';
    if (minutes === 1) return '1 minute ago';
    if (minutes < 60) return `${minutes} minutes ago`;
    
    const hours = Math.floor(minutes / 60);
    if (hours === 1) return '1 hour ago';
    return `${hours} hours ago`;
  };

  const handleAlertAction = (alertId, action) => {
    setAlerts(prev => prev.map(alert => 
      alert.id === alertId 
        ? { ...alert, resolved: true }
        : alert
    ));
  };

  const filteredAlerts = alerts.filter(alert => {
    if (filter === 'all') return true;
    if (filter === 'unresolved') return !alert.resolved;
    return alert.type === filter;
  });

  const unresolvedCount = alerts.filter(alert => !alert.resolved).length;

  const filterOptions = [
    { key: 'all', label: 'All', count: alerts.length },
    { key: 'unresolved', label: 'Unresolved', count: unresolvedCount },
    { key: 'urgent', label: 'Urgent', count: alerts.filter(a => a.type === 'urgent').length },
    { key: 'warning', label: 'Warnings', count: alerts.filter(a => a.type === 'warning').length }
  ];

  return (
    <div className="bg-surface rounded-spa-lg spa-shadow-resting p-6 border border-border">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-error/10 rounded-lg flex items-center justify-center relative">
            <Icon name="Bell" size={20} className="text-error" />
            {unresolvedCount > 0 && (
              <div className="absolute -top-1 -right-1 w-5 h-5 bg-error text-error-foreground rounded-full flex items-center justify-center">
                <span className="font-caption font-caption-normal text-xs">{unresolvedCount}</span>
              </div>
            )}
          </div>
          <div>
            <h3 className="font-heading font-heading-semibold text-lg text-text-primary">
              Alerts & Notifications
            </h3>
            <p className="font-body font-body-normal text-sm text-text-secondary">
              {unresolvedCount} items require attention
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          iconName="Settings"
          onClick={() => {/* Handle settings */}}
        >
          Settings
        </Button>
      </div>

      {/* Filter Tabs */}
      <div className="flex space-x-1 mb-4 bg-background rounded-spa p-1">
        {filterOptions.map((option) => (
          <button
            key={option.key}
            onClick={() => setFilter(option.key)}
            className={`flex-1 px-3 py-2 rounded text-sm font-body font-body-medium spa-transition-fast ${
              filter === option.key
                ? 'bg-surface text-text-primary spa-shadow-resting'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {option.label} ({option.count})
          </button>
        ))}
      </div>

      {/* Alerts List */}
      <div className="space-y-3 max-h-96 overflow-y-auto">
        {filteredAlerts.map((alert) => {
          const config = getAlertConfig(alert.type);
          
          return (
            <div 
              key={alert.id} 
              className={`p-4 rounded-spa border-l-4 ${config.color} ${
                alert.resolved ? 'opacity-60' : ''
              } hover:bg-border/20 spa-transition-fast`}
            >
              <div className="flex items-start space-x-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${config.bgColor}`}>
                  <Icon name={config.icon} size={16} className={config.iconColor} />
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="font-body font-body-medium text-sm text-text-primary">
                      {alert.title}
                    </h4>
                    <div className="flex items-center space-x-2">
                      {alert.resolved && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-caption font-caption-normal bg-success/10 text-success">
                          <Icon name="Check" size={12} className="mr-1" />
                          Resolved
                        </span>
                      )}
                      <span className="font-caption font-caption-normal text-xs text-text-secondary">
                        {getTimeAgo(alert.timestamp)}
                      </span>
                    </div>
                  </div>
                  
                  <p className="font-body font-body-normal text-sm text-text-secondary mb-3">
                    {alert.message}
                  </p>
                  
                  {!alert.resolved && (
                    <div className="flex items-center space-x-2">
                      <Button
                        variant="primary"
                        size="xs"
                        onClick={() => handleAlertAction(alert.id, alert.action)}
                      >
                        {alert.action === 'resolve' && 'Resolve'}
                        {alert.action === 'review' && 'Review'}
                        {alert.action === 'approve' && 'Approve'}
                        {alert.action === 'schedule' && 'Schedule'}
                        {alert.action === 'view' && 'View Details'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        iconName="ExternalLink"
                        onClick={() => {/* Handle view details */}}
                      >
                        Details
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filteredAlerts.length === 0 && (
        <div className="text-center py-8">
          <Icon name="CheckCircle" size={48} className="text-success mx-auto mb-3" />
          <p className="font-body font-body-normal text-sm text-text-secondary">
            No alerts found for the selected filter
          </p>
        </div>
      )}

      {/* Summary Stats */}
      <div className="mt-6 pt-4 border-t border-border">
        <div className="grid grid-cols-4 gap-4 text-center">
          <div className="p-2">
            <div className="font-heading font-heading-semibold text-lg text-error">
              {alerts.filter(a => a.type === 'urgent' && !a.resolved).length}
            </div>
            <div className="font-caption font-caption-normal text-xs text-text-secondary">Urgent</div>
          </div>
          <div className="p-2">
            <div className="font-heading font-heading-semibold text-lg text-warning">
              {alerts.filter(a => a.type === 'warning' && !a.resolved).length}
            </div>
            <div className="font-caption font-caption-normal text-xs text-text-secondary">Warnings</div>
          </div>
          <div className="p-2">
            <div className="font-heading font-heading-semibold text-lg text-primary">
              {alerts.filter(a => a.type === 'info' && !a.resolved).length}
            </div>
            <div className="font-caption font-caption-normal text-xs text-text-secondary">Info</div>
          </div>
          <div className="p-2">
            <div className="font-heading font-heading-semibold text-lg text-success">
              {alerts.filter(a => a.resolved).length}
            </div>
            <div className="font-caption font-caption-normal text-xs text-text-secondary">Resolved</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AlertsNotificationPanel;