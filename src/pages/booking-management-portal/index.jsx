import React, { useState } from 'react';
import { Helmet } from 'react-helmet';
import CustomerHeader from '../../components/ui/CustomerHeader';
import BookingSearch from './components/BookingSearch';
import BookingCard from './components/BookingCard';
import BookingHistory from './components/BookingHistory';
import RescheduleModal from './components/RescheduleModal';
import CancellationModal from './components/CancellationModal';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import { searchBookings, updateBookingStatus, rescheduleBooking } from '../../services/api';
import { transformBookings, toDbStatus } from '../../services/bookingTransformers';
import { useBranch } from '../../contexts/BranchContext';

const BookingManagementPortal = () => {
  const { branchId } = useBranch();
  const [currentBooking, setCurrentBooking] = useState(null);
  const [bookingHistory, setBookingHistory] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchPerformed, setSearchPerformed] = useState(false);
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [showCancellationModal, setShowCancellationModal] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [notification, setNotification] = useState(null);

  const handleSearch = async (query, searchType) => {
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
        // First result = most relevant/recent, rest = history
        setCurrentBooking(transformed[0]);
        setBookingHistory(transformed.slice(1));
        showNotification(`Found ${transformed.length} booking(s)`, 'success');
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
    // Use real API to cancel
    const dbStatus = toDbStatus('cancelled');
    const result = await updateBookingStatus({ bookingId: booking.bookingId, newStatus: dbStatus });

    if (result.error) {
      showNotification(result.error.message || 'Failed to cancel booking.', 'error');
    } else {
      showNotification('Booking cancelled successfully.', 'success');
      // Refresh by re-searching
      setCurrentBooking(prev => prev ? { ...prev, status: 'cancelled' } : null);
    }
  };

  const handleRescheduleConfirm = async ({ bookingId, newDate, newStartTime }) => {
    const result = await rescheduleBooking({ bookingId, newDate, newStartTime });

    if (result.error) {
      return result; // RescheduleModal displays error
    }

    // Refresh current booking with updated data
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

  const showNotification = (message, type) => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 5000);
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
    <>
      <Helmet>
        <title>Booking Management Portal - Zenly</title>
        <meta name="description" content="Manage your bookings - reschedule, cancel, or view booking history at Zenly Nepal" />
      </Helmet>

      <div className="min-h-screen bg-background">
        <CustomerHeader />

        {/* Notification */}
        {notification && (
          <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-notification">
            <div className={`flex items-center space-x-3 px-4 py-3 rounded-spa border spa-shadow-elevated animate-fade-in ${getNotificationColor(notification.type)}`}>
              <Icon name={getNotificationIcon(notification.type)} size={16} />
              <span className="font-body font-body-normal text-sm">
                {notification.message}
              </span>
              <button
                onClick={() => setNotification(null)}
                className="p-1 rounded hover:bg-black/10 spa-transition-fast"
              >
                <Icon name="X" size={14} />
              </button>
            </div>
          </div>
        )}

        <main className="pt-16">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {/* Page Header */}
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Icon name="Settings" size={24} className="text-primary" />
              </div>
              <h1 className="font-heading font-heading-bold text-3xl text-text-primary mb-2">
                Manage Your Booking
              </h1>
              <p className="font-body font-body-normal text-lg text-text-secondary max-w-2xl mx-auto">
                Search by booking number, customer name, or phone number.
              </p>
            </div>

            {/* Search Section */}
            <div className="mb-8">
              <BookingSearch onSearch={handleSearch} isLoading={isSearching} />
            </div>

            {/* Results Section */}
            {searchPerformed && (
              <div className="space-y-8">
                {currentBooking ? (
                  <>
                    {/* Current Booking */}
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

                    {/* More Results */}
                    {bookingHistory.length > 0 && (
                      <div className="border-t border-border pt-8">
                        <BookingHistory bookings={bookingHistory} />
                      </div>
                    )}
                  </>
                ) : (
                  /* No Results */
                  <div className="text-center py-12">
                    <div className="w-16 h-16 bg-text-secondary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Icon name="Search" size={24} className="text-text-secondary" />
                    </div>
                    <h3 className="font-heading font-heading-medium text-xl text-text-primary mb-2">
                      No Booking Found
                    </h3>
                    <p className="font-body font-body-normal text-text-secondary mb-6 max-w-md mx-auto">
                      We couldn't find any booking with the provided information. Please check your details and try again.
                    </p>
                    <div className="space-y-3">
                      <Button
                        variant="primary"
                        iconName="Calendar"
                        iconPosition="left"
                        onClick={() => window.location.href = '/customer-booking-flow'}
                      >
                        Make New Booking
                      </Button>
                      <div className="text-sm text-text-secondary">
                        <p className="font-caption font-caption-normal">
                          Need help? Contact us at{' '}
                          <a href="tel:+977-1-4441234" className="text-primary hover:underline">
                            +977-1-4441234
                          </a>
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Help Section */}
            {!searchPerformed && (
              <div className="mt-12 bg-surface rounded-spa-lg spa-shadow-resting border border-border p-6">
                <div className="text-center">
                  <div className="w-12 h-12 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Icon name="HelpCircle" size={20} className="text-accent" />
                  </div>
                  <h3 className="font-heading font-heading-medium text-lg text-text-primary mb-2">
                    Need Help?
                  </h3>
                  <p className="font-body font-body-normal text-sm text-text-secondary mb-4">
                    Can't find your booking information? Our support team is here to help.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <Button
                      variant="outline"
                      iconName="Phone"
                      iconPosition="left"
                      onClick={() => window.location.href = 'tel:+977-1-4441234'}
                    >
                      Call Support
                    </Button>
                    <Button
                      variant="outline"
                      iconName="Mail"
                      iconPosition="left"
                      onClick={() => window.location.href = 'mailto:support@bookspa.com.np'}
                    >
                      Email Us
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>

        {/* Footer */}
        <footer className="bg-surface border-t border-border mt-16">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="text-center">
              <div className="flex items-center justify-center space-x-2 mb-4">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    className="text-primary-foreground"
                  >
                    <path
                      d="M12 2L13.09 8.26L20 9L13.09 9.74L12 16L10.91 9.74L4 9L10.91 8.26L12 2Z"
                      fill="currentColor"
                    />
                    <circle cx="12" cy="19" r="2" fill="currentColor" opacity="0.7"/>
                  </svg>
                </div>
                <span className="font-heading font-heading-semibold text-lg text-text-primary">
                  Zenly
                </span>
              </div>
              <p className="font-caption font-caption-normal text-sm text-text-secondary mb-4">
                Your wellness journey, simplified and secure.
              </p>
              <p className="font-caption font-caption-normal text-xs text-text-secondary mt-4">
                &copy; {new Date().getFullYear()} Zenly Nepal. All rights reserved.
              </p>
            </div>
          </div>
        </footer>

        {/* Modals */}
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
    </>
  );
};

export default BookingManagementPortal;
