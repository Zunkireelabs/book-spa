import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { to12h } from '../../../services/bookingTransformers';

const BookingCard = ({ booking, onReschedule, onCancel }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const getStatusColor = (status) => {
    switch (status) {
      case 'confirmed':
        return 'bg-success/10 text-success border-success/20';
      case 'completed':
        return 'bg-text-secondary/10 text-text-secondary border-text-secondary/20';
      case 'cancelled':
        return 'bg-error/10 text-error border-error/20';
      default:
        return 'bg-warning/10 text-warning border-warning/20';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'confirmed':
        return 'CheckCircle';
      case 'completed':
        return 'Check';
      case 'cancelled':
        return 'XCircle';
      default:
        return 'Clock';
    }
  };

  return (
    <div className="bg-surface rounded-spa-lg spa-shadow-resting border border-border overflow-hidden">
      {/* Header */}
      <div className="p-4 sm:p-6 border-b border-border">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center space-x-3 mb-2">
              <h3 className="font-heading font-heading-semibold text-lg text-text-primary">
                {booking.service}
              </h3>
              <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-caption font-caption-normal border ${getStatusColor(booking.status)} capitalize`}>
                <Icon name={getStatusIcon(booking.status)} size={12} className="mr-1" />
                {booking.status}
              </span>
            </div>
            <p className="font-body font-body-normal text-sm text-text-secondary mb-1">
              Booking ID: {booking.id}
            </p>
            <p className="font-body font-body-medium text-sm text-text-primary">
              {booking.date} at {to12h(booking.time)}
            </p>
          </div>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-2 rounded-spa hover:bg-background spa-transition-fast"
          >
            <Icon 
              name={isExpanded ? "ChevronUp" : "ChevronDown"} 
              size={20} 
              className="text-text-secondary" 
            />
          </button>
        </div>
      </div>

      {/* Expandable Content */}
      {isExpanded && (
        <div className="p-4 sm:p-6 space-y-6">
          {/* Service Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-3">
              <h4 className="font-heading font-heading-medium text-base text-text-primary">
                Service Information
              </h4>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Icon name="Clock" size={16} className="text-text-secondary" />
                  <span className="font-body font-body-normal text-sm text-text-primary">
                    {booking.duration}
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <Icon name="MapPin" size={16} className="text-text-secondary" />
                  <span className="font-body font-body-normal text-sm text-text-primary">
                    {booking.branch}
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <Icon name="User" size={16} className="text-text-secondary" />
                  <span className="font-body font-body-normal text-sm text-text-primary">
                    {booking.therapist || 'To be assigned'}
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="font-heading font-heading-medium text-base text-text-primary">
                Booking Details
              </h4>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-body font-body-normal text-sm text-text-secondary">
                    Service Cost:
                  </span>
                  <span className="font-body font-body-medium text-sm text-text-primary">
                    NPR {booking.price}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-body font-body-normal text-sm text-text-secondary">
                    Booking Date:
                  </span>
                  <span className="font-body font-body-normal text-sm text-text-primary">
                    {booking.bookingDate}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-body font-body-normal text-sm text-text-secondary">
                    Gender Preference:
                  </span>
                  <span className="font-body font-body-normal text-sm text-text-primary capitalize">
                    {booking.genderPreference}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Special Requests */}
          {booking.specialRequests && (
            <div className="space-y-2">
              <h4 className="font-heading font-heading-medium text-base text-text-primary">
                Special Requests
              </h4>
              <div className="p-3 bg-background rounded-spa">
                <p className="font-body font-body-normal text-sm text-text-primary">
                  {booking.specialRequests}
                </p>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          {booking.status === 'confirmed' && (
            <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-border">
              <Button
                variant="primary"
                iconName="Calendar"
                iconPosition="left"
                onClick={() => onReschedule(booking)}
                className="flex-1 sm:flex-none"
              >
                Reschedule Booking
              </Button>
              <Button
                variant="outline"
                iconName="X"
                iconPosition="left"
                onClick={() => onCancel(booking)}
                className="flex-1 sm:flex-none text-error border-error hover:bg-error/10"
              >
                Cancel Booking
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default BookingCard;