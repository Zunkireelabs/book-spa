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
          color: 'border-l-red-500 bg-red-50',
          iconColor: 'text-red-600',
          icon: 'AlertTriangle',
          bgColor: 'bg-red-50'
        };
      case 'warning':
        return {
          color: 'border-l-amber-500 bg-amber-50',
          iconColor: 'text-amber-600',
          icon: 'AlertCircle',
          bgColor: 'bg-amber-50'
        };
      case 'info':
        return {
          color: 'border-l-blue-500 bg-blue-50',
          iconColor: 'text-blue-600',
          icon: 'Info',
          bgColor: 'bg-blue-50'
        };
      case 'success':
        return {
          color: 'border-l-green-500 bg-green-50',
          iconColor: 'text-green-600',
          icon: 'CheckCircle',
          bgColor: 'bg-green-50'
        };
      default:
        return {
          color: 'border-l-gray-500 bg-gray-50',
          iconColor: 'text-gray-500',
          icon: 'Bell',
          bgColor: 'bg-gray-50'
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
    <div className="bg-white rounded-lg p-6 border border-gray-200">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-red-50 rounded-lg flex items-center justify-center relative">
            <Icon name="Bell" size={20} className="text-red-600" />
            {unresolvedCount > 0 && (
              <div className="absolute -top-1 -right-1 w-5 h-5 bg-red-600 text-white rounded-full flex items-center justify-center">
                <span className="text-xs">{unresolvedCount}</span>
              </div>
            )}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              Alerts & Notifications
            </h3>
            <p className="text-sm text-gray-500">
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
      <div className="flex space-x-1 mb-4 bg-gray-100 rounded-lg p-1">
        {filterOptions.map((option) => (
          <button
            key={option.key}
            onClick={() => setFilter(option.key)}
            className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              filter === option.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-900'
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
              className={`p-4 rounded-lg border-l-4 ${config.color} ${
                alert.resolved ? 'opacity-60' : ''
              } hover:brightness-95 transition-all`}
            >
              <div className="flex items-start space-x-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${config.bgColor}`}>
                  <Icon name={config.icon} size={16} className={config.iconColor} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="text-sm font-medium text-gray-900">
                      {alert.title}
                    </h4>
                    <div className="flex items-center space-x-2">
                      {alert.resolved && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-green-50 text-green-600">
                          <Icon name="Check" size={12} className="mr-1" />
                          Resolved
                        </span>
                      )}
                      <span className="text-xs text-gray-500">
                        {getTimeAgo(alert.timestamp)}
                      </span>
                    </div>
                  </div>

                  <p className="text-sm text-gray-500 mb-3">
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
          <Icon name="CheckCircle" size={48} className="text-green-600 mx-auto mb-3" />
          <p className="text-sm text-gray-500">
            No alerts found for the selected filter
          </p>
        </div>
      )}

      {/* Summary Stats */}
      <div className="mt-6 pt-4 border-t border-gray-100">
        <div className="grid grid-cols-4 gap-4 text-center">
          <div className="p-2">
            <div className="text-lg font-semibold text-red-600">
              {alerts.filter(a => a.type === 'urgent' && !a.resolved).length}
            </div>
            <div className="text-xs text-gray-500">Urgent</div>
          </div>
          <div className="p-2">
            <div className="text-lg font-semibold text-amber-600">
              {alerts.filter(a => a.type === 'warning' && !a.resolved).length}
            </div>
            <div className="text-xs text-gray-500">Warnings</div>
          </div>
          <div className="p-2">
            <div className="text-lg font-semibold text-blue-600">
              {alerts.filter(a => a.type === 'info' && !a.resolved).length}
            </div>
            <div className="text-xs text-gray-500">Info</div>
          </div>
          <div className="p-2">
            <div className="text-lg font-semibold text-green-600">
              {alerts.filter(a => a.resolved).length}
            </div>
            <div className="text-xs text-gray-500">Resolved</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AlertsNotificationPanel;