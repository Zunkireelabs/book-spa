import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';

const RealtimeBookingFeed = () => {
  const [bookings, setBookings] = useState([]);
  const [filter, setFilter] = useState('all');

  const mockBookings = [
    {
      id: 'BK-2024-156',
      customerName: 'Priya Sharma',
      service: 'Deep Tissue Massage',
      time: '2:30 PM',
      status: 'pending',
      priority: 'high',
      timestamp: new Date(Date.now() - 300000), // 5 minutes ago
      therapist: null,
      duration: '90 min',
      amount: 1800
    },
    {
      id: 'BK-2024-157',
      customerName: 'Rajesh Thapa',
      service: 'Hot Stone Therapy',
      time: '3:00 PM',
      status: 'confirmed',
      priority: 'normal',
      timestamp: new Date(Date.now() - 600000), // 10 minutes ago
      therapist: 'Emma Wilson',
      duration: '60 min',
      amount: 2200
    },
    {
      id: 'BK-2024-158',
      customerName: 'Sunita Rai',
      service: 'Aromatherapy',
      time: '3:30 PM',
      status: 'conflict',
      priority: 'urgent',
      timestamp: new Date(Date.now() - 900000), // 15 minutes ago
      therapist: null,
      duration: '75 min',
      amount: 2000
    },
    {
      id: 'BK-2024-159',
      customerName: 'Amit Gurung',
      service: 'Swedish Massage',
      time: '4:00 PM',
      status: 'confirmed',
      priority: 'normal',
      timestamp: new Date(Date.now() - 1200000), // 20 minutes ago
      therapist: 'Michael Chen',
      duration: '60 min',
      amount: 1600
    },
    {
      id: 'BK-2024-160',
      customerName: 'Maya Shrestha',
      service: 'Reflexology',
      time: '4:30 PM',
      status: 'pending',
      priority: 'normal',
      timestamp: new Date(Date.now() - 1800000), // 30 minutes ago
      therapist: null,
      duration: '45 min',
      amount: 1400
    }
  ];

  useEffect(() => {
    setBookings(mockBookings);
    
    // Simulate real-time updates
    const interval = setInterval(() => {
      const newBooking = {
        id: `BK-2024-${Date.now()}`,
        customerName: 'New Customer',
        service: 'Thai Massage',
        time: new Date(Date.now() + 3600000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: 'pending',
        priority: 'normal',
        timestamp: new Date(),
        therapist: null,
        duration: '60 min',
        amount: 1800
      };
      
      setBookings(prev => [newBooking, ...prev.slice(0, 4)]);
    }, 30000); // Add new booking every 30 seconds

    return () => clearInterval(interval);
  }, []);

  const getStatusConfig = (status) => {
    switch (status) {
      case 'pending':
        return { color: 'bg-warning/10 text-warning', icon: 'Clock', label: 'Pending' };
      case 'confirmed':
        return { color: 'bg-success/10 text-success', icon: 'CheckCircle', label: 'Confirmed' };
      case 'conflict':
        return { color: 'bg-error/10 text-error', icon: 'AlertTriangle', label: 'Conflict' };
      default:
        return { color: 'bg-text-secondary/10 text-text-secondary', icon: 'Circle', label: 'Unknown' };
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'urgent': return 'border-l-error';
      case 'high': return 'border-l-warning';
      case 'normal': return 'border-l-primary';
      default: return 'border-l-text-secondary';
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

  const filteredBookings = bookings.filter(booking => {
    if (filter === 'all') return true;
    return booking.status === filter;
  });

  const handleQuickAction = (bookingId, action) => {
    setBookings(prev => prev.map(booking => 
      booking.id === bookingId 
        ? { ...booking, status: action === 'confirm' ? 'confirmed' : 'pending' }
        : booking
    ));
  };

  return (
    <div className="bg-surface rounded-spa-lg spa-shadow-resting p-6 border border-border">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
            <Icon name="Activity" size={20} className="text-primary" />
          </div>
          <div>
            <h3 className="font-heading font-heading-semibold text-lg text-text-primary">
              Live Booking Feed
            </h3>
            <p className="font-body font-body-normal text-sm text-text-secondary">
              Real-time booking activity
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-2 h-2 bg-success rounded-full animate-pulse"></div>
          <span className="font-caption font-caption-normal text-xs text-text-secondary">Live</span>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex space-x-1 mb-4 bg-background rounded-spa p-1">
        {[
          { key: 'all', label: 'All', count: bookings.length },
          { key: 'pending', label: 'Pending', count: bookings.filter(b => b.status === 'pending').length },
          { key: 'conflict', label: 'Conflicts', count: bookings.filter(b => b.status === 'conflict').length }
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`flex-1 px-3 py-2 rounded text-sm font-body font-body-medium spa-transition-fast ${
              filter === tab.key
                ? 'bg-surface text-text-primary spa-shadow-resting'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>

      {/* Booking List */}
      <div className="space-y-3 max-h-96 overflow-y-auto">
        {filteredBookings.map((booking) => {
          const statusConfig = getStatusConfig(booking.status);
          
          return (
            <div 
              key={booking.id} 
              className={`p-4 bg-background rounded-spa border-l-4 ${getPriorityColor(booking.priority)} hover:bg-border/30 spa-transition-fast`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-1">
                    <h4 className="font-body font-body-medium text-sm text-text-primary">
                      {booking.customerName}
                    </h4>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-caption font-caption-normal ${statusConfig.color}`}>
                      <Icon name={statusConfig.icon} size={12} className="mr-1" />
                      {statusConfig.label}
                    </span>
                  </div>
                  <p className="font-body font-body-normal text-sm text-text-secondary mb-1">
                    {booking.service} • {booking.duration}
                  </p>
                  <div className="flex items-center space-x-4 text-xs text-text-secondary">
                    <span className="flex items-center space-x-1">
                      <Icon name="Clock" size={12} />
                      <span>{booking.time}</span>
                    </span>
                    <span className="flex items-center space-x-1">
                      <Icon name="IndianRupee" size={12} />
                      <span>NPR {booking.amount.toLocaleString()}</span>
                    </span>
                    {booking.therapist && (
                      <span className="flex items-center space-x-1">
                        <Icon name="User" size={12} />
                        <span>{booking.therapist}</span>
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-caption font-caption-normal text-xs text-text-secondary mb-2">
                    {getTimeAgo(booking.timestamp)}
                  </p>
                  <div className="flex space-x-1">
                    {booking.status === 'pending' && (
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => handleQuickAction(booking.id, 'confirm')}
                      >
                        Confirm
                      </Button>
                    )}
                    {booking.status === 'conflict' && (
                      <Button
                        variant="danger"
                        size="xs"
                        onClick={() => handleQuickAction(booking.id, 'resolve')}
                      >
                        Resolve
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="xs"
                      iconName="ExternalLink"
                      onClick={() => {/* Handle view details */}}
                    >
                      View
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filteredBookings.length === 0 && (
        <div className="text-center py-8">
          <Icon name="Calendar" size={48} className="text-text-secondary mx-auto mb-3" />
          <p className="font-body font-body-normal text-sm text-text-secondary">
            No bookings found for the selected filter
          </p>
        </div>
      )}
    </div>
  );
};

export default RealtimeBookingFeed;