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

// Status badge styles using Tailwind classes directly (not dynamic)
const STATUS_STYLES = {
  pending: 'bg-warning/10 text-warning',
  confirmed: 'bg-success/10 text-success',
  'in-progress': 'bg-primary/10 text-primary',
  completed: 'bg-gray-100 text-gray-500',
  cancelled: 'bg-error/10 text-error',
  'no show': 'bg-gray-100 text-gray-500',
};

const BookingsList = ({ bookings, therapists = [], onStatusUpdate, onAssignTherapist, onRecordPayment, onApplyDiscount, userRole = 'staff', onRefresh, dateRange = 'today' }) => {
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [showActionModal, setShowActionModal] = useState(false);

  const getStatusIcon = (status) => {
    const icons = {
      pending: 'Clock',
      confirmed: 'CheckCircle',
      'in-progress': 'Play',
      completed: 'Check',
      cancelled: 'X',
      'no show': 'UserX',
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

  // Render action buttons based on status
  const renderActionButtons = (booking, isMobile = false) => {
    if (TERMINAL_STATUSES.includes(booking.status) || booking.isLocked) {
      return null;
    }

    const buttonSize = isMobile ? 'sm' : 'xs';
    const buttonClass = isMobile ? 'flex-1 min-h-[44px]' : '';

    return (
      <>
        {booking.status === 'pending' && (
          <Button
            variant="outline"
            size={buttonSize}
            className={`border-primary text-primary hover:bg-primary/10 hover:text-primary ${buttonClass}`}
            onClick={() => handleQuickStatusUpdate(booking, 'confirmed')}
          >
            Confirm
          </Button>
        )}
        {booking.status === 'confirmed' && (
          <Button
            variant="default"
            size={buttonSize}
            className={buttonClass}
            onClick={() => handleQuickStatusUpdate(booking, 'in-progress')}
          >
            Start
          </Button>
        )}
        {booking.status === 'in-progress' && (
          <Button
            variant="outline"
            size={buttonSize}
            className={buttonClass}
            onClick={() => handleQuickStatusUpdate(booking, 'completed')}
          >
            Complete
          </Button>
        )}
      </>
    );
  };

  return (
    <>
      <div className="bg-white rounded-lg border border-gray-200 flex flex-col overflow-hidden">
        {/* Header - Responsive */}
        <div className="flex items-center justify-between p-3 border-b border-gray-200">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <h2 className="text-sm sm:text-base font-semibold text-gray-900 truncate">
              {DATE_RANGE_LABELS[dateRange] || "Appointments"}
            </h2>
            <span className="hidden sm:inline-flex">
              <StatusLegend compact />
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs sm:text-sm text-gray-500 whitespace-nowrap">
              {bookings.length} bookings
            </span>
            <Button
              variant="outline"
              size="sm"
              iconName="RefreshCw"
              iconPosition="left"
              onClick={onRefresh}
              className="hidden sm:inline-flex"
            >
              Refresh
            </Button>
            {/* Mobile: Icon-only refresh */}
            <Button
              variant="outline"
              size="sm"
              iconName="RefreshCw"
              onClick={onRefresh}
              className="sm:hidden min-h-[40px] min-w-[40px] p-0 flex items-center justify-center"
            />
          </div>
        </div>

        {/* Bookings List */}
        <div className="divide-y divide-gray-100 overflow-y-auto flex-1">
          {bookings.length === 0 ? (
            <div className="p-6 sm:p-8 text-center">
              <Icon name="Calendar" size={40} className="text-gray-300 mx-auto mb-3 sm:mb-4 sm:w-12 sm:h-12" />
              <h3 className="text-sm sm:text-base font-medium text-gray-900 mb-1 sm:mb-2">
                No appointments today
              </h3>
              <p className="text-xs sm:text-sm text-gray-500">
                All bookings will appear here when scheduled
              </p>
            </div>
          ) : (
            bookings.map((booking) => (
              <div key={booking.bookingId} className="p-3 sm:p-3 hover:bg-gray-50 transition-colors">
                {/* Mobile Card Layout (< md) */}
                <div className="md:hidden">
                  {/* Top Row: Time + Customer + Status */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {/* Time Badge */}
                      <div className="flex-shrink-0 bg-gray-100 rounded-md px-2 py-1">
                        <div className="text-sm font-semibold text-gray-900">
                          {formatTime(booking.time)}
                        </div>
                      </div>
                      {/* Customer Name */}
                      <h3 className="text-sm font-medium text-gray-900 truncate">
                        {booking.customerName}
                      </h3>
                    </div>
                    {/* More Actions Button */}
                    <button
                      onClick={() => handleBookingAction(booking)}
                      className="flex-shrink-0 p-2 -mr-1 rounded-lg hover:bg-gray-100 min-h-[40px] min-w-[40px] flex items-center justify-center"
                    >
                      <Icon name="MoreVertical" size={18} className="text-gray-500" />
                    </button>
                  </div>

                  {/* Status Badges Row */}
                  <div className="flex flex-wrap items-center gap-1.5 mb-2">
                    <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${STATUS_STYLES[booking.status] || 'bg-gray-100 text-gray-500'}`}>
                      <Icon name={getStatusIcon(booking.status)} size={12} className="mr-1" />
                      {booking.status.replace('-', ' ')}
                    </span>
                    {booking.paymentStatus === 'paid' && (
                      <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-emerald-100 text-emerald-700">
                        Paid
                      </span>
                    )}
                    {booking.isLocked && (
                      <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-amber-100 text-amber-700">
                        <Icon name="Lock" size={10} className="mr-1" />
                        Locked
                      </span>
                    )}
                  </div>

                  {/* Service & Therapist Row */}
                  <div className="flex flex-col gap-1.5 text-xs text-gray-600 mb-3">
                    <div className="flex items-center gap-1.5">
                      <Icon name="Scissors" size={14} className="text-gray-400" />
                      <span>{booking.service}</span>
                      <span className="text-gray-400">·</span>
                      <span>{booking.duration}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Icon name="User" size={14} className="text-gray-400" />
                      {booking.therapist ? (
                        <span>
                          {booking.therapist.name}
                          {booking.therapist.room && <span className="text-gray-400"> · Room {booking.therapist.room}</span>}
                        </span>
                      ) : (
                        <span className="text-amber-600 font-medium">Unassigned</span>
                      )}
                    </div>
                    {booking.customerPhone && (
                      <div className="flex items-center gap-1.5">
                        <Icon name="Phone" size={14} className="text-gray-400" />
                        <span>{booking.customerPhone}</span>
                      </div>
                    )}
                  </div>

                  {/* Mobile Action Buttons */}
                  {!TERMINAL_STATUSES.includes(booking.status) && !booking.isLocked && (
                    <div className="flex gap-2">
                      {renderActionButtons(booking, true)}
                    </div>
                  )}

                  {/* Special Requests - Mobile */}
                  {booking.specialRequests && (
                    <div className="mt-3 p-2.5 bg-amber-50 rounded-lg border-l-2 border-amber-400">
                      <div className="flex items-start gap-2">
                        <Icon name="MessageSquare" size={14} className="text-amber-600 mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-gray-600 leading-relaxed">
                          {booking.specialRequests}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Desktop Row Layout (≥ md) */}
                <div className="hidden md:block">
                  <div className="flex items-center justify-between">
                    {/* Booking Info */}
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      {/* Time */}
                      <div className="text-left min-w-[70px] flex-shrink-0">
                        <div className="text-sm font-medium text-gray-900">
                          {formatTime(booking.time)}
                        </div>
                        <div className="text-xs text-gray-500">
                          {booking.duration}
                        </div>
                      </div>

                      {/* Customer & Service */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h3 className="text-sm font-medium text-gray-900 truncate max-w-[200px]">
                            {booking.customerName}
                          </h3>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[booking.status] || 'bg-gray-100 text-gray-500'}`}>
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
                            <span className="truncate max-w-[150px]">{booking.service}</span>
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
                      <div className="text-right min-w-[120px] flex-shrink-0">
                        {booking.therapist ? (
                          <div>
                            <div className="text-sm font-medium text-gray-900">
                              {booking.therapist.name}
                            </div>
                            <div className="text-xs text-gray-500">
                              {booking.therapist.gender}{booking.therapist.room ? ` · Room ${booking.therapist.room}` : ''}
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

                    {/* Desktop Actions */}
                    <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                      {renderActionButtons(booking, false)}
                      <Button
                        variant="ghost"
                        size="xs"
                        iconName="MoreVertical"
                        onClick={() => handleBookingAction(booking)}
                      />
                    </div>
                  </div>

                  {/* Special Requests - Desktop */}
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
