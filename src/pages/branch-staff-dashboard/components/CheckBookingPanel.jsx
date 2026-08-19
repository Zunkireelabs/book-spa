import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import BookingSearch from '../../booking-management-portal/components/BookingSearch';
import BookingCard from '../../booking-management-portal/components/BookingCard';
import BookingHistory from '../../booking-management-portal/components/BookingHistory';
import RescheduleModal from '../../booking-management-portal/components/RescheduleModal';
import CancellationModal from '../../booking-management-portal/components/CancellationModal';
import { searchBookings, updateBookingStatus, rescheduleBooking } from '../../../services/api';
import { transformBookings, toDbStatus } from '../../../services/bookingTransformers';

const CheckBookingPanel = ({ branchId }) => {
  const [currentBooking, setCurrentBooking] = useState(null);
  const [bookingHistory, setBookingHistory] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchPerformed, setSearchPerformed] = useState(false);
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [showCancellationModal, setShowCancellationModal] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [notification, setNotification] = useState(null);

  const showNotification = (message, type) => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 5000);
  };

  const handleSearch = async (query) => {
    setIsSearching(true);
    setSearchPerformed(true);

    try {
      const result = await searchBookings(branchId, query);

      if (result.error) {
        showNotification('Failed to search bookings. Please try again.', 'error');
        setCurrentBooking(null);
        setBookingHistory([]);
      } else if (result.data && result.data.length > 0) {
        const transformed = transformBookings(result.data);
        setCurrentBooking(transformed[0]);
        setBookingHistory(transformed.slice(1));
      } else {
        setCurrentBooking(null);
        setBookingHistory([]);
      }
    } catch (error) {
      showNotification('Failed to search booking. Please try again.', 'error');
    } finally {
      setIsSearching(false);
    }
  };

  const handleReschedule = (booking) => {
    setSelectedBooking(booking);
    setShowRescheduleModal(true);
  };

  const handleCancel = async (booking) => {
    const dbStatus = toDbStatus('cancelled');
    const result = await updateBookingStatus({ bookingId: booking.bookingId, newStatus: dbStatus });

    if (result.error) {
      showNotification(result.error.message || 'Failed to cancel booking.', 'error');
    } else {
      showNotification('Booking cancelled successfully.', 'success');
      setCurrentBooking(prev => prev ? { ...prev, status: 'cancelled' } : null);
    }
  };

  const handleRescheduleConfirm = async ({ bookingId, newDate, newStartTime }) => {
    const result = await rescheduleBooking({ bookingId, newDate, newStartTime });

    if (result.error) {
      return result; // RescheduleModal displays error
    }

    if (result.data) {
      const transformed = transformBookings([result.data]);
      if (transformed.length > 0) {
        setCurrentBooking(transformed[0]);
      }
    }
    showNotification('Booking rescheduled successfully!', 'success');
    return result;
  };

  const handleCancellationConfirm = (cancelledBooking) => {
    setCurrentBooking({ ...cancelledBooking, status: 'cancelled' });
    showNotification('Booking cancelled successfully.', 'success');
  };

  const getNotificationIcon = (type) => {
    switch (type) {
      case 'success': return 'CheckCircle';
      case 'error': return 'XCircle';
      case 'warning': return 'AlertTriangle';
      default: return 'Info';
    }
  };

  const getNotificationColor = (type) => {
    switch (type) {
      case 'success': return 'bg-success/10 border-success/20 text-success';
      case 'error': return 'bg-error/10 border-error/20 text-error';
      case 'warning': return 'bg-warning/10 border-warning/20 text-warning';
      default: return 'bg-primary/10 border-primary/20 text-primary';
    }
  };

  return (
    <div className="space-y-6">
      {notification && (
        <div className={`flex items-center space-x-3 px-4 py-3 rounded-spa border spa-shadow-elevated ${getNotificationColor(notification.type)}`}>
          <Icon name={getNotificationIcon(notification.type)} size={16} />
          <span className="font-body font-body-normal text-sm">
            {notification.message}
          </span>
          <button
            onClick={() => setNotification(null)}
            className="p-1 rounded hover:bg-black/10 spa-transition-fast ml-auto"
          >
            <Icon name="X" size={14} />
          </button>
        </div>
      )}

      <BookingSearch onSearch={handleSearch} isLoading={isSearching} />

      {searchPerformed && (
        <div className="space-y-8">
          {currentBooking ? (
            <>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-heading font-heading-semibold text-xl text-text-primary">
                    Booking Found
                  </h2>
                  <div className="flex items-center space-x-2 text-sm text-text-secondary">
                    <Icon name="Clock" size={16} />
                    <span className="font-caption font-caption-normal">
                      Last updated: {new Date().toLocaleString('en-GB')}
                    </span>
                  </div>
                </div>
                <BookingCard
                  booking={currentBooking}
                  onReschedule={handleReschedule}
                  onCancel={handleCancel}
                />
              </div>

              {bookingHistory.length > 0 && (
                <div className="border-t border-border pt-8">
                  <BookingHistory bookings={bookingHistory} />
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-text-secondary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Icon name="Search" size={24} className="text-text-secondary" />
              </div>
              <h3 className="font-heading font-heading-medium text-xl text-text-primary mb-2">
                No Booking Found
              </h3>
              <p className="font-body font-body-normal text-text-secondary max-w-md mx-auto">
                No booking matched that search. Check the booking ID, name, or phone number and try again.
              </p>
            </div>
          )}
        </div>
      )}

      <RescheduleModal
        isOpen={showRescheduleModal}
        onClose={() => setShowRescheduleModal(false)}
        booking={selectedBooking}
        onConfirm={handleRescheduleConfirm}
      />

      <CancellationModal
        isOpen={showCancellationModal}
        onClose={() => setShowCancellationModal(false)}
        booking={selectedBooking}
        onConfirm={handleCancellationConfirm}
      />
    </div>
  );
};

export default CheckBookingPanel;
