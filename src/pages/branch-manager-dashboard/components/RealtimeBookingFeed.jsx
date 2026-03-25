import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { supabase } from '../../../lib/supabase';
import { fetchBookings } from '../../../services/api';
import { transformBookings } from '../../../services/bookingTransformers';

const RealtimeBookingFeed = ({
  bookings: propBookings,
  onQuickStatusUpdate,
  branchId
}) => {
  const [filter, setFilter] = useState('all');
  const [internalBookings, setInternalBookings] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState('connecting'); // 'connecting' | 'connected' | 'disconnected'
  const [lastUpdate, setLastUpdate] = useState(null);

  // Use prop bookings if provided, otherwise use internal state
  const bookings = propBookings || internalBookings;

  // Load bookings data
  const loadBookings = useCallback(async () => {
    if (!branchId) return;

    const today = new Date().toISOString().split('T')[0];
    const result = await fetchBookings(branchId, { date: today });

    if (result.data) {
      setInternalBookings(transformBookings(result.data));
      setLastUpdate(new Date());
    }
  }, [branchId]);

  // Set up real-time subscription when branchId is available
  useEffect(() => {
    if (!branchId) return;

    // Initial load
    loadBookings();

    const handleRealtimeUpdate = () => {
      setTimeout(() => {
        loadBookings();
      }, 150);
    };

    const channel = supabase
      .channel(`realtime-feed-${branchId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'bookings',
        filter: `branch_id=eq.${branchId}`
      }, handleRealtimeUpdate)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setConnectionStatus('connected');
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          setConnectionStatus('disconnected');
        } else if (status === 'TIMED_OUT') {
          setConnectionStatus('disconnected');
        }
      });

    // Handle connection state changes
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadBookings();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [branchId, loadBookings]);

  const getStatusConfig = (status) => {
    switch (status) {
      case 'pending':
        return { color: 'bg-warning/10 text-warning', icon: 'Clock', label: 'Pending' };
      case 'confirmed':
        return { color: 'bg-success/10 text-success', icon: 'CheckCircle', label: 'Confirmed' };
      case 'in-progress':
        return { color: 'bg-primary/10 text-primary', icon: 'Play', label: 'In Progress' };
      case 'completed':
        return { color: 'bg-text-secondary/10 text-text-secondary', icon: 'Check', label: 'Completed' };
      case 'cancelled':
        return { color: 'bg-error/10 text-error', icon: 'X', label: 'Cancelled' };
      default:
        return { color: 'bg-text-secondary/10 text-text-secondary', icon: 'Circle', label: status };
    }
  };

  const getConnectionStatusConfig = () => {
    switch (connectionStatus) {
      case 'connected':
        return {
          color: 'bg-success',
          pulseColor: 'bg-success',
          label: 'Live',
          icon: 'Wifi'
        };
      case 'connecting':
        return {
          color: 'bg-warning',
          pulseColor: 'bg-warning',
          label: 'Connecting',
          icon: 'Loader'
        };
      case 'disconnected':
        return {
          color: 'bg-error',
          pulseColor: 'bg-error',
          label: 'Offline',
          icon: 'WifiOff'
        };
      default:
        return {
          color: 'bg-text-secondary',
          pulseColor: 'bg-text-secondary',
          label: 'Unknown',
          icon: 'HelpCircle'
        };
    }
  };

  const formatTime = (timeString) => {
    if (!timeString) return '';
    return new Date(`2024-01-01 ${timeString}`).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  const formatLastUpdate = () => {
    if (!lastUpdate) return '';
    return lastUpdate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  };

  const filteredBookings = bookings.filter(booking => {
    if (filter === 'all') return true;
    if (filter === 'pending') return booking.status === 'pending';
    if (filter === 'unassigned') return !booking.therapist;
    return true;
  });

  const pendingCount = bookings.filter(b => b.status === 'pending').length;
  const unassignedCount = bookings.filter(b => !b.therapist).length;
  const connectionConfig = getConnectionStatusConfig();

  return (
    <div className="bg-surface rounded-spa-lg spa-shadow-resting p-6 border border-border">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
            <Icon name="Activity" size={20} className="text-primary" />
          </div>
          <div>
            <h3 className="font-heading font-heading-semibold text-lg text-text-primary">
              Today's Bookings
            </h3>
            <p className="font-body font-body-normal text-sm text-text-secondary">
              {bookings.length} bookings today
            </p>
          </div>
        </div>

        {/* Real-time Status Indicator */}
        <div className="flex items-center space-x-2">
          {lastUpdate && connectionStatus === 'connected' && (
            <span className="text-xs text-text-secondary hidden sm:inline">
              Updated {formatLastUpdate()}
            </span>
          )}
          <div
            className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-background border border-border"
            title={`Real-time: ${connectionConfig.label}`}
          >
            <span className="relative flex h-2 w-2">
              {connectionStatus === 'connected' && (
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${connectionConfig.pulseColor} opacity-75`}></span>
              )}
              <span className={`relative inline-flex rounded-full h-2 w-2 ${connectionConfig.color}`}></span>
            </span>
            <span className="text-xs font-caption font-caption-medium text-text-secondary">
              {connectionConfig.label}
            </span>
          </div>
          {connectionStatus === 'disconnected' && (
            <Button
              variant="ghost"
              size="xs"
              onClick={loadBookings}
              title="Refresh"
            >
              <Icon name="RefreshCw" size={14} />
            </Button>
          )}
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex space-x-1 mb-4 bg-background rounded-spa p-1">
        {[
          { key: 'all', label: 'All', count: bookings.length },
          { key: 'pending', label: 'Pending', count: pendingCount },
          { key: 'unassigned', label: 'Unassigned', count: unassignedCount }
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
              key={booking.bookingId}
              className="p-4 bg-background rounded-spa hover:bg-border/30 spa-transition-fast"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-1">
                    <h4 className="font-body font-body-medium text-sm text-text-primary">
                      {booking.customerName}
                    </h4>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-caption font-caption-normal ${statusConfig.color}`}>
                      <Icon name={statusConfig.icon} size={12} className="mr-1" />
                      {statusConfig.label}
                    </span>
                    {booking.paymentStatus === 'paid' && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-caption font-caption-normal bg-success/10 text-success">
                        Paid
                      </span>
                    )}
                  </div>
                  <p className="font-body font-body-normal text-sm text-text-secondary mb-1">
                    {booking.service} {'\u00B7'} {booking.duration}
                  </p>
                  <div className="flex items-center space-x-4 text-xs text-text-secondary">
                    <span className="flex items-center space-x-1">
                      <Icon name="Clock" size={12} />
                      <span>{formatTime(booking.time)}</span>
                    </span>
                    <span className="flex items-center space-x-1">
                      <Icon name="IndianRupee" size={12} />
                      <span>{booking.price}</span>
                    </span>
                    {booking.therapist ? (
                      <span className="flex items-center space-x-1">
                        <Icon name="User" size={12} />
                        <span>{booking.therapist.name}</span>
                      </span>
                    ) : (
                      <span className="flex items-center space-x-1 text-warning">
                        <Icon name="AlertCircle" size={12} />
                        <span>Unassigned</span>
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex space-x-1 ml-2">
                  {booking.status === 'pending' && onQuickStatusUpdate && (
                    <Button
                      variant="outline"
                      size="xs"
                      className="border-primary text-primary hover:bg-primary/10 hover:text-primary"
                      onClick={() => onQuickStatusUpdate(booking.bookingId, 'confirmed')}
                    >
                      Confirm
                    </Button>
                  )}
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
