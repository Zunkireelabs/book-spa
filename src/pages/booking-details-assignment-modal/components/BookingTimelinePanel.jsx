import React from 'react';
import Icon from '../../../components/AppIcon';

const BookingTimelinePanel = ({ booking, timeline }) => {
  const getTimelineIcon = (type) => {
    const iconMap = {
      'created': 'Plus',
      'confirmed': 'CheckCircle',
      'assigned': 'UserCheck',
      'reassigned': 'UserX',
      'modified': 'Edit',
      'cancelled': 'XCircle',
      'completed': 'Check',
      'viewed': 'Eye',
      'note_added': 'MessageSquare',
      'status_changed': 'RefreshCw'
    };
    return iconMap[type] || 'Clock';
  };

  const getTimelineColor = (type) => {
    const colorMap = {
      'created': 'primary',
      'confirmed': 'success',
      'assigned': 'success',
      'reassigned': 'warning',
      'modified': 'warning',
      'cancelled': 'error',
      'completed': 'success',
      'viewed': 'text-secondary',
      'note_added': 'primary',
      'status_changed': 'primary'
    };
    return colorMap[type] || 'text-secondary';
  };

  const formatTimeAgo = (timestamp) => {
    const now = new Date();
    const time = new Date(timestamp);
    const diffInMinutes = Math.floor((now - time) / (1000 * 60));
    
    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours}h ago`;
    
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7) return `${diffInDays}d ago`;
    
    return time.toLocaleDateString();
  };

  return (
    <div className="space-y-6">
      {/* Timeline Header */}
      <div className="flex items-center space-x-3">
        <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
          <Icon name="Clock" size={20} className="text-primary" />
        </div>
        <div>
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary">
            Booking Timeline
          </h3>
          <p className="font-caption font-caption-normal text-sm text-text-secondary">
            Complete activity history
          </p>
        </div>
      </div>

      {/* Timeline Items */}
      <div className="space-y-4">
        {timeline.map((item, index) => {
          const isLast = index === timeline.length - 1;
          const iconName = getTimelineIcon(item.type);
          const colorClass = getTimelineColor(item.type);
          
          return (
            <div key={item.id} className="relative">
              {/* Timeline Line */}
              {!isLast && (
                <div className="absolute left-5 top-10 w-0.5 h-8 bg-border"></div>
              )}
              
              {/* Timeline Item */}
              <div className="flex items-start space-x-4">
                {/* Icon */}
                <div className={`w-10 h-10 rounded-full flex items-center justify-center bg-${colorClass}/10 flex-shrink-0`}>
                  <Icon name={iconName} size={16} className={`text-${colorClass}`} />
                </div>
                
                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="font-body font-body-medium text-sm text-text-primary">
                        {item.title}
                      </p>
                      {item.description && (
                        <p className="font-caption font-caption-normal text-sm text-text-secondary mt-1">
                          {item.description}
                        </p>
                      )}
                      
                      {/* Additional Details */}
                      {item.details && (
                        <div className="mt-2 p-3 bg-background rounded-spa">
                          {item.details.map((detail, detailIndex) => (
                            <div key={detailIndex} className="flex items-center justify-between py-1">
                              <span className="font-caption font-caption-normal text-xs text-text-secondary">
                                {detail.label}
                              </span>
                              <span className="font-caption font-caption-normal text-xs text-text-primary">
                                {detail.value}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {/* User and Time */}
                      <div className="flex items-center space-x-3 mt-2">
                        <div className="flex items-center space-x-1">
                          <Icon name="User" size={12} className="text-text-secondary" />
                          <span className="font-caption font-caption-normal text-xs text-text-secondary">
                            {item.user}
                          </span>
                        </div>
                        <div className="flex items-center space-x-1">
                          <Icon name="Clock" size={12} className="text-text-secondary" />
                          <span className="font-caption font-caption-normal text-xs text-text-secondary">
                            {formatTimeAgo(item.timestamp)}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    {/* Status Badge */}
                    {item.status && (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-caption font-caption-normal bg-${colorClass}/10 text-${colorClass} ml-3`}>
                        {item.status}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Timeline Stats */}
      <div className="bg-background rounded-spa p-4 space-y-3">
        <h4 className="font-heading font-heading-medium text-base text-text-primary">
          Activity Summary
        </h4>
        
        <div className="grid grid-cols-2 gap-4">
          <div className="text-center">
            <p className="font-heading font-heading-semibold text-lg text-text-primary">
              {timeline.length}
            </p>
            <p className="font-caption font-caption-normal text-xs text-text-secondary">
              Total Activities
            </p>
          </div>
          
          <div className="text-center">
            <p className="font-heading font-heading-semibold text-lg text-text-primary">
              {timeline.filter(item => item.type === 'status_changed').length}
            </p>
            <p className="font-caption font-caption-normal text-xs text-text-secondary">
              Status Changes
            </p>
          </div>
          
          <div className="text-center">
            <p className="font-heading font-heading-semibold text-lg text-text-primary">
              {timeline.filter(item => item.type === 'assigned' || item.type === 'reassigned').length}
            </p>
            <p className="font-caption font-caption-normal text-xs text-text-secondary">
              Assignments
            </p>
          </div>
          
          <div className="text-center">
            <p className="font-heading font-heading-semibold text-lg text-text-primary">
              {timeline.filter(item => item.user !== 'System').length}
            </p>
            <p className="font-caption font-caption-normal text-xs text-text-secondary">
              Staff Actions
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BookingTimelinePanel;