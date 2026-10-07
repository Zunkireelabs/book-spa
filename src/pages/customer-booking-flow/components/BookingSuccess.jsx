import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../../../components/ui/Button';
import Icon from '../../../components/AppIcon';
import { useTenant } from '../../../contexts/TenantContext';
import { formatNPR } from '../../../services/bookingTransformers';

const BookingSuccess = ({ bookingData, orgSlug, onBookAnother }) => {
  const navigate = useNavigate();
  const [showDetails, setShowDetails] = useState(false);
  const { isCleaning, isSalon, isBeauty } = useTenant();

  const getServiceWord = () => {
    if (isCleaning) return 'cleaning';
    if (isSalon) return 'salon';
    if (isBeauty) return 'beauty';
    return 'spa';
  };

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

  // Provider-profile flow sets `selectedServices` (an array, possibly several for a
  // group booking); every other caller sets the singular `selectedService`. Normalize
  // to a list once so both paths render every service and the real combined total.
  const services = bookingData?.selectedServices ?? (bookingData?.selectedService ? [bookingData.selectedService] : []);
  const priceOf = (s) => Number(s?.effective_price_npr ?? s?.price_npr ?? s?.price ?? 0);
  const total = services.reduce((sum, s) => sum + priceOf(s), 0);

  const handleNewBooking = () => {
    if (onBookAnother) {
      onBookAnother();
      return;
    }
    navigate(orgSlug ? `/${orgSlug}` : '/login');
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
          Booking confirmed!
        </h2>
        <p className="font-body font-body-normal text-lg text-text-secondary mb-4">
          Your {getServiceWord()} appointment has been successfully booked
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
                <span className="font-body font-body-medium text-sm text-text-secondary">
                  {services.length > 1 ? 'Services' : 'Service'}
                </span>
                {services.map((s, i) => (
                  <p key={s?.id ?? i} className="font-body font-body-normal text-sm text-text-primary">
                    {s?.name}
                  </p>
                ))}
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
                  {formatNPR(total)}
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
            Confirmation details
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
          {bookingData?.customerInfo?.email && (
            <div className="flex items-center space-x-3 p-3 bg-success/10 rounded-spa">
              <Icon name="Mail" size={16} className="text-success" />
              <div className="flex-1">
                <span className="font-body font-body-medium text-sm text-text-primary">
                  Email confirmation sent
                </span>
                <p className="font-caption font-caption-normal text-xs text-text-secondary">
                  Check your inbox at {bookingData.customerInfo.email}
                </p>
              </div>
              <Icon name="CheckCircle" size={16} className="text-success" />
            </div>
          )}

          <div className="flex items-center space-x-3 p-3 bg-success/10 rounded-spa">
            <Icon name="MessageSquare" size={16} className="text-success" />
            <div className="flex-1">
              <span className="font-body font-body-medium text-sm text-text-primary">
                SMS confirmation sent
              </span>
              <p className="font-caption font-caption-normal text-xs text-text-secondary">
                Message sent to {bookingData?.customerInfo?.phoneCountryCode || '+977'} {bookingData?.customerInfo?.phone}
              </p>
            </div>
            <Icon name="CheckCircle" size={16} className="text-success" />
          </div>
        </div>

        {showDetails && (
          <div className="mt-6 pt-6 border-t border-border space-y-4">
            <div>
              <h4 className="font-body font-body-medium text-sm text-text-primary mb-2">
                Your details
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
                  Special requests
                </h4>
                <p className="font-body font-body-normal text-sm text-text-secondary bg-background p-3 rounded-spa">
                  {bookingData.customerInfo.specialRequests}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div>
        <Button
          variant="primary"
          onClick={handleNewBooking}
          iconName="Plus"
          iconSize={16}
          className="w-full"
        >
          Book another service
        </Button>
      </div>
    </div>
  );
};

export default BookingSuccess;
