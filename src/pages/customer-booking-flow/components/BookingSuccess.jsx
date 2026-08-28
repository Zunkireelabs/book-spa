import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../../../components/ui/Button';
import Icon from '../../../components/AppIcon';

const BookingSuccess = ({ bookingData }) => {
  const navigate = useNavigate();
  const [countdown, setCountdown] = useState(10);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const formatDateTime = () => {
    if (!bookingData?.selectedDateTime?.date || !bookingData?.selectedDateTime?.time) return '';
    
    const date = new Date(bookingData.selectedDateTime.date);
    const dateStr = date.toLocaleDateString('en-GB', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    
    const timeObj = new Date();
    const [hours, minutes] = bookingData.selectedDateTime.time.split(':');
    timeObj.setHours(parseInt(hours), parseInt(minutes));
    const timeStr = timeObj.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    
    return `${dateStr} at ${timeStr}`;
  };

  const formatPrice = (price) => {
    return new Intl.NumberFormat('ne-NP', {
      style: 'currency',
      currency: 'NPR',
      minimumFractionDigits: 0
    }).format(price);
  };

  const generateModificationLink = () => {
    return `https://bookspa.com/modify/${bookingData?.bookingId}`;
  };

  const generateCancellationLink = () => {
    return `https://bookspa.com/cancel/${bookingData?.bookingId}`;
  };

  const handleCopyLink = (link, type) => {
    navigator.clipboard.writeText(link);
    // You could add a toast notification here
  };

  const handleNewBooking = () => {
    navigate('/customer-booking-flow');
  };

  const handleManageBooking = () => {
    navigate('/booking-management-portal');
  };

  return (
    <div className="space-y-6">
      {/* Success Animation */}
      <div className="text-center">
        <div className="relative">
          <div className="w-24 h-24 bg-success/10 rounded-full flex items-center justify-center mx-auto mb-6 animate-pulse">
            <div className="w-16 h-16 bg-success/20 rounded-full flex items-center justify-center">
              <Icon name="CheckCircle" size={40} className="text-success" />
            </div>
          </div>
          <div className="absolute -top-2 -right-2 w-8 h-8 bg-accent rounded-full flex items-center justify-center animate-bounce">
            <Icon name="Sparkles" size={16} className="text-accent-foreground" />
          </div>
        </div>
        
        <h2 className="font-heading font-heading-semibold text-3xl text-text-primary mb-2">
          Booking Confirmed!
        </h2>
        <p className="font-body font-body-normal text-lg text-text-secondary mb-4">
          Your spa appointment has been successfully booked
        </p>
        
        <div className="inline-flex items-center space-x-2 bg-success/10 text-success px-4 py-2 rounded-spa">
          <Icon name="Calendar" size={16} />
          <span className="font-body font-body-medium text-sm">
            Booking ID: {bookingData?.bookingId}
          </span>
        </div>
      </div>

      {/* Quick Summary */}
      <div className="bg-primary/5 rounded-spa-lg border border-primary/20 p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <div className="flex items-center space-x-3">
              <Icon name="MapPin" size={16} className="text-primary" />
              <div>
                <span className="font-body font-body-medium text-sm text-text-secondary">Branch</span>
                <p className="font-body font-body-normal text-sm text-text-primary">
                  {bookingData?.selectedBranch?.name}
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <Icon name="Sparkles" size={16} className="text-primary" />
              <div>
                <span className="font-body font-body-medium text-sm text-text-secondary">Service</span>
                <p className="font-body font-body-normal text-sm text-text-primary">
                  {bookingData?.selectedService?.name}
                </p>
              </div>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex items-center space-x-3">
              <Icon name="Calendar" size={16} className="text-primary" />
              <div>
                <span className="font-body font-body-medium text-sm text-text-secondary">Date & Time</span>
                <p className="font-body font-body-normal text-sm text-text-primary">
                  {formatDateTime()}
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <Icon name="CreditCard" size={16} className="text-primary" />
              <div>
                <span className="font-body font-body-medium text-sm text-text-secondary">Total Amount</span>
                <p className="font-heading font-heading-semibold text-lg text-primary">
                  {formatPrice(bookingData?.selectedService?.price || 0)}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Details */}
      <div className="bg-surface rounded-spa-lg border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-heading font-heading-medium text-lg text-text-primary">
            Confirmation Details
          </h3>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDetails(!showDetails)}
            iconName={showDetails ? "ChevronUp" : "ChevronDown"}
            iconSize={14}
          >
            {showDetails ? 'Hide' : 'Show'} Details
          </Button>
        </div>

        <div className="space-y-4">
          <div className="flex items-center space-x-3 p-3 bg-success/10 rounded-spa">
            <Icon name="Mail" size={16} className="text-success" />
            <div className="flex-1">
              <span className="font-body font-body-medium text-sm text-text-primary">
                Email Confirmation Sent
              </span>
              <p className="font-caption font-caption-normal text-xs text-text-secondary">
                Check your inbox at {bookingData?.customerInfo?.email}
              </p>
            </div>
            <Icon name="CheckCircle" size={16} className="text-success" />
          </div>

          <div className="flex items-center space-x-3 p-3 bg-success/10 rounded-spa">
            <Icon name="MessageSquare" size={16} className="text-success" />
            <div className="flex-1">
              <span className="font-body font-body-medium text-sm text-text-primary">
                SMS Confirmation Sent
              </span>
              <p className="font-caption font-caption-normal text-xs text-text-secondary">
                Message sent to +977 {bookingData?.customerInfo?.phone}
              </p>
            </div>
            <Icon name="CheckCircle" size={16} className="text-success" />
          </div>
        </div>

        {showDetails && (
          <div className="mt-6 pt-6 border-t border-border space-y-4">
            <div>
              <h4 className="font-body font-body-medium text-sm text-text-primary mb-2">
                Customer Information
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-body font-body-medium text-text-secondary">Name:</span>
                  <span className="font-body font-body-normal text-text-primary ml-2">
                    {bookingData?.customerInfo?.firstName} {bookingData?.customerInfo?.lastName}
                  </span>
                </div>
                <div>
                  <span className="font-body font-body-medium text-text-secondary">Gender:</span>
                  <span className="font-body font-body-normal text-text-primary ml-2 capitalize">
                    {bookingData?.customerInfo?.gender}
                  </span>
                </div>
              </div>
            </div>

            {bookingData?.customerInfo?.specialRequests && (
              <div>
                <h4 className="font-body font-body-medium text-sm text-text-primary mb-2">
                  Special Requests
                </h4>
                <p className="font-body font-body-normal text-sm text-text-secondary bg-background p-3 rounded-spa">
                  {bookingData.customerInfo.specialRequests}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Management Links */}
      <div className="bg-surface rounded-spa-lg border border-border p-6">
        <h3 className="font-heading font-heading-medium text-lg text-text-primary mb-4">
          Manage Your Booking
        </h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 bg-background rounded-spa">
            <div className="flex items-center space-x-3">
              <Icon name="Edit" size={16} className="text-primary" />
              <div>
                <span className="font-body font-body-medium text-sm text-text-primary">
                  Modify Booking
                </span>
                <p className="font-caption font-caption-normal text-xs text-text-secondary">
                  Change date, time, or service
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleCopyLink(generateModificationLink(), 'modify')}
              iconName="Copy"
              iconSize={14}
            >
              Copy Link
            </Button>
          </div>

          <div className="flex items-center justify-between p-3 bg-background rounded-spa">
            <div className="flex items-center space-x-3">
              <Icon name="X" size={16} className="text-error" />
              <div>
                <span className="font-body font-body-medium text-sm text-text-primary">
                  Cancel Booking
                </span>
                <p className="font-caption font-caption-normal text-xs text-text-secondary">
                  Cancel at least 24 hours in advance
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleCopyLink(generateCancellationLink(), 'cancel')}
              iconName="Copy"
              iconSize={14}
            >
              Copy Link
            </Button>
          </div>
        </div>
      </div>

      {/* QR Code */}
      <div className="bg-surface rounded-spa-lg border border-border p-6 text-center">
        <h3 className="font-heading font-heading-medium text-lg text-text-primary mb-4">
          Quick Access QR Code
        </h3>
        <div className="w-32 h-32 bg-background rounded-spa mx-auto mb-4 flex items-center justify-center">
          <Icon name="QrCode" size={64} className="text-text-secondary" />
        </div>
        <p className="font-caption font-caption-normal text-sm text-text-secondary mb-4">
          Save this QR code to quickly access your booking details
        </p>
        <Button
          variant="outline"
          size="sm"
          iconName="Download"
          iconSize={14}
        >
          Download QR Code
        </Button>
      </div>

      {/* Important Reminders */}
      <div className="bg-warning/10 border border-warning/20 rounded-spa p-4">
        <div className="flex items-start space-x-3">
          <Icon name="AlertTriangle" size={16} className="text-warning mt-0.5" />
          <div className="flex-1">
            <h4 className="font-body font-body-medium text-sm text-warning mb-2">
              Important Reminders
            </h4>
            <ul className="space-y-1 font-caption font-caption-normal text-xs text-text-secondary">
              <li>• Bring a valid ID for verification</li>
              <li>• Wear comfortable, loose-fitting clothing</li>
              <li>• Inform us of any health conditions or allergies</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-4">
        <Button
          variant="outline"
          onClick={handleManageBooking}
          iconName="Settings"
          iconSize={16}
          className="sm:w-auto"
        >
          Manage Bookings
        </Button>
        <Button
          variant="primary"
          onClick={handleNewBooking}
          iconName="Plus"
          iconSize={16}
          className="flex-1"
        >
          Book Another Service
        </Button>
      </div>

      {/* Auto-redirect Notice */}
      {countdown > 0 && (
        <div className="text-center p-4 bg-background rounded-spa">
          <p className="font-caption font-caption-normal text-sm text-text-secondary">
            Redirecting to booking management in {countdown} seconds...
          </p>
        </div>
      )}
    </div>
  );
};

export default BookingSuccess;