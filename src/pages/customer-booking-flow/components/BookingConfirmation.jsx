import React, { useState } from 'react';
import Button from '../../../components/ui/Button';
import Icon from '../../../components/AppIcon';
import Image from '../../../components/AppImage';

const BookingConfirmation = ({ 
  selectedBranch, 
  selectedService, 
  selectedDateTime, 
  customerInfo, 
  genderPreference,
  onConfirmBooking,
  onEditBooking 
}) => {
  const [isConfirming, setIsConfirming] = useState(false);
  const [showQRCode, setShowQRCode] = useState(false);

  const formatDateTime = () => {
    if (!selectedDateTime?.date || !selectedDateTime?.time) return '';
    
    const date = new Date(selectedDateTime.date);
    const dateStr = date.toLocaleDateString('en-GB', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    
    const timeObj = new Date();
    const [hours, minutes] = selectedDateTime.time.split(':');
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

  const generateBookingId = () => {
    return `BK-${new Date().getFullYear()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  };

  const handleConfirmBooking = async () => {
    setIsConfirming(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate API call
      const bookingId = generateBookingId();
      onConfirmBooking({ bookingId });
    } catch (error) {
      console.error('Booking confirmation failed:', error);
    } finally {
      setIsConfirming(false);
    }
  };

  const getGenderPreferenceLabel = () => {
    switch (genderPreference) {
      case 'male': return 'Male Therapist';
      case 'female': return 'Female Therapist';
      case 'no-preference': return 'No Preference';
      default: return 'Not specified';
    }
  };

  const bookingDetails = [
    {
      label: 'Branch',
      value: selectedBranch?.name,
      icon: 'MapPin'
    },
    {
      label: 'Service',
      value: selectedService?.name,
      icon: 'Sparkles'
    },
    {
      label: 'Duration',
      value: selectedService?.duration,
      icon: 'Clock'
    },
    {
      label: 'Date & Time',
      value: formatDateTime(),
      icon: 'Calendar'
    },
    {
      label: 'Therapist Preference',
      value: getGenderPreferenceLabel(),
      icon: 'User'
    },
    {
      label: 'Price',
      value: formatPrice(selectedService?.price || 0),
      icon: 'CreditCard',
      highlight: true
    }
  ];

  const customerDetails = [
    {
      label: 'Name',
      value: `${customerInfo.firstName} ${customerInfo.lastName}`,
      icon: 'User'
    },
    {
      label: 'Email',
      value: customerInfo.email,
      icon: 'Mail'
    },
    {
      label: 'Phone',
      value: `+977 ${customerInfo.phone}`,
      icon: 'Phone'
    },
    {
      label: 'Gender',
      value: customerInfo.gender?.charAt(0).toUpperCase() + customerInfo.gender?.slice(1),
      icon: 'User'
    }
  ];

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <Icon name="CheckCircle" size={32} className="text-primary" />
        </div>
        <h2 className="font-heading font-heading-semibold text-2xl text-text-primary mb-2">
          Confirm Your Booking
        </h2>
        <p className="font-body font-body-normal text-text-secondary">
          Please review your booking details before confirming
        </p>
      </div>

      {/* Service Image */}
      <div className="relative overflow-hidden rounded-spa-lg">
        <Image
          src={selectedService?.image}
          alt={selectedService?.name}
          className="w-full h-64 object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-text-primary/50 to-transparent"></div>
        <div className="absolute bottom-4 left-4 right-4">
          <h3 className="font-heading font-heading-semibold text-xl text-white mb-2">
            {selectedService?.name}
          </h3>
          <p className="font-body font-body-normal text-sm text-white/90">
            {selectedService?.description}
          </p>
        </div>
      </div>

      {/* Booking Details */}
      <div className="bg-surface rounded-spa-lg border border-border p-6">
        <h3 className="font-heading font-heading-medium text-lg text-text-primary mb-4">
          Booking Details
        </h3>
        <div className="space-y-4">
          {bookingDetails.map((detail, index) => (
            <div key={index} className="flex items-center justify-between py-2">
              <div className="flex items-center space-x-3">
                <Icon name={detail.icon} size={16} className="text-text-secondary" />
                <span className="font-body font-body-medium text-sm text-text-secondary">
                  {detail.label}
                </span>
              </div>
              <span className={`font-body font-body-normal text-sm ${
                detail.highlight ? 'text-primary font-heading-semibold text-lg' : 'text-text-primary'
              }`}>
                {detail.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Customer Details */}
      <div className="bg-surface rounded-spa-lg border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-heading font-heading-medium text-lg text-text-primary">
            Customer Information
          </h3>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onEditBooking(3)}
            iconName="Edit"
            iconSize={14}
          >
            Edit
          </Button>
        </div>
        <div className="space-y-4">
          {customerDetails.map((detail, index) => (
            <div key={index} className="flex items-center justify-between py-2">
              <div className="flex items-center space-x-3">
                <Icon name={detail.icon} size={16} className="text-text-secondary" />
                <span className="font-body font-body-medium text-sm text-text-secondary">
                  {detail.label}
                </span>
              </div>
              <span className="font-body font-body-normal text-sm text-text-primary">
                {detail.value}
              </span>
            </div>
          ))}
        </div>
        
        {customerInfo.specialRequests && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex items-start space-x-3">
              <Icon name="MessageSquare" size={16} className="text-text-secondary mt-0.5" />
              <div className="flex-1">
                <span className="font-body font-body-medium text-sm text-text-secondary">
                  Special Requests
                </span>
                <p className="font-body font-body-normal text-sm text-text-primary mt-1">
                  {customerInfo.specialRequests}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Branch Information */}
      <div className="bg-surface rounded-spa-lg border border-border p-6">
        <h3 className="font-heading font-heading-medium text-lg text-text-primary mb-4">
          Branch Information
        </h3>
        <div className="space-y-3">
          <div className="flex items-center space-x-3">
            <Icon name="MapPin" size={16} className="text-text-secondary" />
            <span className="font-body font-body-normal text-sm text-text-primary">
              {selectedBranch?.address}
            </span>
          </div>
          <div className="flex items-center space-x-3">
            <Icon name="Phone" size={16} className="text-text-secondary" />
            <a 
              href={`tel:${selectedBranch?.phone}`}
              className="font-body font-body-normal text-sm text-primary hover:text-primary/80 spa-transition-fast"
            >
              {selectedBranch?.phone}
            </a>
          </div>
          <div className="flex items-center space-x-3">
            <Icon name="Clock" size={16} className="text-text-secondary" />
            <span className="font-body font-body-normal text-sm text-text-primary">
              {selectedBranch?.openHours}
            </span>
          </div>
        </div>
      </div>

      {/* Important Notes */}
      <div className="bg-warning/10 border border-warning/20 rounded-spa p-4">
        <div className="flex items-start space-x-3">
          <Icon name="AlertTriangle" size={16} className="text-warning mt-0.5" />
          <div className="flex-1">
            <h4 className="font-body font-body-medium text-sm text-warning mb-2">
              Important Notes
            </h4>
            <ul className="space-y-1 font-caption font-caption-normal text-xs text-text-secondary">
              <li>• Please arrive 15 minutes before your appointment time</li>
              <li>• Cancellations must be made at least 24 hours in advance</li>
              <li>• You will receive confirmation via email and SMS</li>
              <li>• Bring a valid ID for verification</li>
            </ul>
          </div>
        </div>
      </div>

      {/* QR Code Section */}
      {showQRCode && (
        <div className="bg-surface rounded-spa-lg border border-border p-6 text-center">
          <h3 className="font-heading font-heading-medium text-lg text-text-primary mb-4">
            Quick Access QR Code
          </h3>
          <div className="w-32 h-32 bg-background rounded-spa mx-auto mb-4 flex items-center justify-center">
            <Icon name="QrCode" size={64} className="text-text-secondary" />
          </div>
          <p className="font-caption font-caption-normal text-sm text-text-secondary">
            Scan this QR code to quickly access your booking details
          </p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-4">
        <Button
          variant="outline"
          onClick={() => setShowQRCode(!showQRCode)}
          iconName="QrCode"
          iconSize={16}
          className="sm:w-auto"
        >
          {showQRCode ? 'Hide' : 'Show'} QR Code
        </Button>
        <Button
          variant="primary"
          onClick={handleConfirmBooking}
          loading={isConfirming}
          iconName="Check"
          iconSize={16}
          className="flex-1"
        >
          {isConfirming ? 'Confirming Booking...' : 'Confirm Booking'}
        </Button>
      </div>

      {/* Edit Options */}
      <div className="bg-background rounded-spa p-4">
        <h4 className="font-body font-body-medium text-sm text-text-primary mb-3">
          Need to make changes?
        </h4>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="text"
            size="sm"
            onClick={() => onEditBooking(0)}
            iconName="MapPin"
            iconSize={14}
          >
            Change Branch
          </Button>
          <Button
            variant="text"
            size="sm"
            onClick={() => onEditBooking(1)}
            iconName="Sparkles"
            iconSize={14}
          >
            Change Service
          </Button>
          <Button
            variant="text"
            size="sm"
            onClick={() => onEditBooking(2)}
            iconName="Calendar"
            iconSize={14}
          >
            Change Date/Time
          </Button>
        </div>
      </div>
    </div>
  );
};

export default BookingConfirmation;