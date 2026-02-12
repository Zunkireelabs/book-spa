import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import BookingActionModal from '../../../components/ui/BookingActionModal';

const BookingsList = ({ bookings, onStatusUpdate, onAssignTherapist }) => {
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [showActionModal, setShowActionModal] = useState(false);

  const getStatusColor = (status) => {
    const colors = {
      pending: 'warning',
      confirmed: 'success',
      'in-progress': 'primary',
      completed: 'text-secondary',
      cancelled: 'error'
    };
    return colors[status] || 'text-secondary';
  };

  const getStatusIcon = (status) => {
    const icons = {
      pending: 'Clock',
      confirmed: 'CheckCircle',
      'in-progress': 'Play',
      completed: 'Check',
      cancelled: 'X'
    };
    return icons[status] || 'Circle';
  };

  const handleBookingAction = (booking) => {
    setSelectedBooking(booking);
    setShowActionModal(true);
  };

  const handleQuickStatusUpdate = (bookingId, newStatus) => {
    onStatusUpdate(bookingId, newStatus);
  };

  const formatTime = (timeString) => {
    return new Date(`2024-01-01 ${timeString}`).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  return (
    <>
      <div className="bg-surface rounded-spa-lg spa-shadow-resting">
        {/* Header */}
        <div className="p-6 border-b border-border">
          <div className="flex items-center justify-between">
            <h2 className="font-heading font-heading-semibold text-lg text-text-primary">
              Today's Appointments
            </h2>
            <div className="flex items-center space-x-2">
              <span className="font-caption font-caption-normal text-sm text-text-secondary">
                {bookings.length} bookings
              </span>
              <Button variant="outline" size="sm" iconName="RefreshCw" iconPosition="left">
                Refresh
              </Button>
            </div>
          </div>
        </div>

        {/* Bookings List */}
        <div className="divide-y divide-border max-h-96 overflow-y-auto">
          {bookings.length === 0 ? (
            <div className="p-8 text-center">
              <Icon name="Calendar" size={48} className="text-text-secondary mx-auto mb-4" />
              <h3 className="font-heading font-heading-medium text-base text-text-primary mb-2">
                No appointments today
              </h3>
              <p className="font-body font-body-normal text-sm text-text-secondary">
                All bookings will appear here when scheduled
              </p>
            </div>
          ) : (
            bookings.map((booking) => (
              <div key={booking.id} className="p-4 hover:bg-background spa-transition-fast">
                <div className="flex items-center justify-between">
                  {/* Booking Info */}
                  <div className="flex items-center space-x-4 flex-1">
                    {/* Time */}
                    <div className="text-center min-w-0">
                      <div className="font-data font-data-normal text-sm text-text-primary">
                        {formatTime(booking.time)}
                      </div>
                      <div className="font-caption font-caption-normal text-xs text-text-secondary">
                        {booking.duration}
                      </div>
                    </div>

                    {/* Customer & Service */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2 mb-1">
                        <h3 className="font-body font-body-medium text-sm text-text-primary truncate">
                          {booking.customerName}
                        </h3>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-caption font-caption-normal bg-${getStatusColor(booking.status)}/10 text-${getStatusColor(booking.status)}`}>
                          <Icon name={getStatusIcon(booking.status)} size={12} className="mr-1" />
                          {booking.status.replace('-', ' ')}
                        </span>
                      </div>
                      <div className="flex items-center space-x-4 text-xs text-text-secondary">
                        <span className="flex items-center space-x-1">
                          <Icon name="Scissors" size={12} />
                          <span>{booking.service}</span>
                        </span>
                        <span className="flex items-center space-x-1">
                          <Icon name="Phone" size={12} />
                          <span>{booking.customerPhone}</span>
                        </span>
                      </div>
                    </div>

                    {/* Therapist Assignment */}
                    <div className="text-center min-w-0">
                      {booking.therapist ? (
                        <div>
                          <div className="font-body font-body-medium text-sm text-text-primary">
                            {booking.therapist.name}
                          </div>
                          <div className="font-caption font-caption-normal text-xs text-text-secondary">
                            {booking.therapist.gender} • Room {booking.therapist.room}
                          </div>
                        </div>
                      ) : (
                        <div className="text-center">
                          <div className="font-body font-body-medium text-sm text-warning">
                            Unassigned
                          </div>
                          <div className="font-caption font-caption-normal text-xs text-text-secondary">
                            Needs therapist
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center space-x-2 ml-4">
                    {/* Quick Status Actions */}
                    {booking.status === 'pending' && (
                      <Button
                        variant="success"
                        size="xs"
                        onClick={() => handleQuickStatusUpdate(booking.id, 'confirmed')}
                      >
                        Confirm
                      </Button>
                    )}
                    {booking.status === 'confirmed' && (
                      <Button
                        variant="default"
                        size="xs"
                        onClick={() => handleQuickStatusUpdate(booking.id, 'in-progress')}
                      >
                        Start
                      </Button>
                    )}
                    {booking.status === 'in-progress' && (
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => handleQuickStatusUpdate(booking.id, 'completed')}
                      >
                        Complete
                      </Button>
                    )}

                    {/* More Actions */}
                    <Button
                      variant="ghost"
                      size="xs"
                      iconName="MoreVertical"
                      onClick={() => handleBookingAction(booking)}
                    />
                  </div>
                </div>

                {/* Special Requests */}
                {booking.specialRequests && (
                  <div className="mt-3 p-2 bg-accent/5 rounded border-l-2 border-accent">
                    <div className="flex items-start space-x-2">
                      <Icon name="MessageSquare" size={14} className="text-accent mt-0.5" />
                      <p className="font-caption font-caption-normal text-xs text-text-secondary">
                        {booking.specialRequests}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Booking Action Modal */}
      <BookingActionModal
        isOpen={showActionModal}
        onClose={() => setShowActionModal(false)}
        booking={selectedBooking}
        onAssignTherapist={onAssignTherapist}
        onUpdateStatus={onStatusUpdate}
      />
    </>
  );
};

export default BookingsList;