import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import BookingActionModal from '../../../components/ui/BookingActionModal';
import StatusLegend from '../../../components/ui/StatusLegend';

const DATE_RANGE_LABELS = {
  today: "Today's Appointments",
  tomorrow: "Tomorrow's Appointments",
  week: "This Week's Appointments",
  month: "This Month's Appointments",
};

const TERMINAL_STATUSES = ['completed', 'cancelled', 'no show'];

const BookingsList = ({ bookings, therapists = [], onStatusUpdate, onAssignTherapist, onRecordPayment, onApplyDiscount, userRole = 'staff', onRefresh, dateRange = 'today' }) => {
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

  // Use booking.bookingId (real UUID) for all API calls
  const handleQuickStatusUpdate = (booking, newStatus) => {
    onStatusUpdate(booking.bookingId, newStatus);
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
      <div className="bg-white rounded-lg border border-gray-200 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-gray-900">
              {DATE_RANGE_LABELS[dateRange] || "Appointments"}
            </h2>
            <StatusLegend compact />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">
              {bookings.length} bookings
            </span>
            <Button variant="outline" size="sm" iconName="RefreshCw" iconPosition="left" onClick={onRefresh}>
              Refresh
            </Button>
          </div>
        </div>

        {/* Bookings List */}
        <div className="divide-y divide-gray-100 overflow-y-auto flex-1">
          {bookings.length === 0 ? (
            <div className="p-8 text-center">
              <Icon name="Calendar" size={48} className="text-gray-300 mx-auto mb-4" />
              <h3 className="text-base font-medium text-gray-900 mb-2">
                No appointments today
              </h3>
              <p className="text-sm text-gray-500">
                All bookings will appear here when scheduled
              </p>
            </div>
          ) : (
            bookings.map((booking) => (
              <div key={booking.bookingId} className="p-3 hover:bg-gray-50 transition-colors">
                <div className="flex items-center justify-between">
                  {/* Booking Info */}
                  <div className="flex items-center gap-4 flex-1">
                    {/* Time */}
                    <div className="text-left min-w-[70px]">
                      <div className="text-sm font-medium text-gray-900">
                        {formatTime(booking.time)}
                      </div>
                      <div className="text-xs text-gray-500">
                        {booking.duration}
                      </div>
                    </div>

                    {/* Customer & Service */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-medium text-gray-900 truncate">
                          {booking.customerName}
                        </h3>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-${getStatusColor(booking.status)}/10 text-${getStatusColor(booking.status)}`}>
                          <Icon name={getStatusIcon(booking.status)} size={12} className="mr-1" />
                          {booking.status.replace('-', ' ')}
                        </span>
                        {booking.paymentStatus === 'paid' && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700">
                            Paid
                          </span>
                        )}
                        {booking.isLocked && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700" title="Day Closed — Locked">
                            <Icon name="Lock" size={10} className="mr-1" />
                            Locked
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <Icon name="Scissors" size={12} />
                          <span>{booking.service}</span>
                        </span>
                        {booking.customerPhone && (
                          <span className="flex items-center gap-1">
                            <Icon name="Phone" size={12} />
                            <span>{booking.customerPhone}</span>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Therapist Assignment */}
                    <div className="text-right min-w-[120px]">
                      {booking.therapist ? (
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {booking.therapist.name}
                          </div>
                          <div className="text-xs text-gray-500">
                            {booking.therapist.gender}{booking.therapist.room ? ` \u00B7 Room ${booking.therapist.room}` : ''}
                          </div>
                        </div>
                      ) : (
                        <div className="text-right">
                          <div className="text-sm font-medium text-amber-600">
                            Unassigned
                          </div>
                          <div className="text-xs text-gray-500">
                            Needs therapist
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 ml-4">
                    {!TERMINAL_STATUSES.includes(booking.status) && !booking.isLocked && (
                      <>
                        {booking.status === 'pending' && (
                          <Button
                            variant="outline"
                            size="xs"
                            className="border-primary text-primary hover:bg-primary/10 hover:text-primary"
                            onClick={() => handleQuickStatusUpdate(booking, 'confirmed')}
                          >
                            Confirm
                          </Button>
                        )}
                        {booking.status === 'confirmed' && (
                          <Button
                            variant="default"
                            size="xs"
                            onClick={() => handleQuickStatusUpdate(booking, 'in-progress')}
                          >
                            Start
                          </Button>
                        )}
                        {booking.status === 'in-progress' && (
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => handleQuickStatusUpdate(booking, 'completed')}
                          >
                            Complete
                          </Button>
                        )}
                      </>
                    )}

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
                  <div className="mt-3 p-2 bg-amber-50 rounded border-l-2 border-amber-400">
                    <div className="flex items-start gap-2">
                      <Icon name="MessageSquare" size={14} className="text-amber-600 mt-0.5" />
                      <p className="text-xs text-gray-600">
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
        therapists={therapists}
        onAssignTherapist={onAssignTherapist}
        onUpdateStatus={onStatusUpdate}
        onRecordPayment={onRecordPayment}
        onApplyDiscount={onApplyDiscount}
        userRole={userRole}
      />
    </>
  );
};

export default BookingsList;
