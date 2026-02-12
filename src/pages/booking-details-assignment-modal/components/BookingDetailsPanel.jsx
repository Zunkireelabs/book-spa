import React from 'react';
import Icon from '../../../components/AppIcon';
import Image from '../../../components/AppImage';

const BookingDetailsPanel = ({ booking, onStatusUpdate, isLoading }) => {
  const statusOptions = [
    { value: 'confirmed', label: 'Confirmed', color: 'success', icon: 'CheckCircle' },
    { value: 'pending', label: 'Pending', color: 'warning', icon: 'Clock' },
    { value: 'cancelled', label: 'Cancelled', color: 'error', icon: 'XCircle' },
    { value: 'completed', label: 'Completed', color: 'text-secondary', icon: 'Check' }
  ];

  const getStatusConfig = (status) => {
    return statusOptions.find(opt => opt.value === status) || statusOptions[1];
  };

  const statusConfig = getStatusConfig(booking.status);

  return (
    <div className="space-y-6">
      {/* Status Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center bg-${statusConfig.color}/10`}>
            <Icon name={statusConfig.icon} size={20} className={`text-${statusConfig.color}`} />
          </div>
          <div>
            <h3 className="font-heading font-heading-semibold text-lg text-text-primary">
              Booking #{booking.id}
            </h3>
            <p className="font-caption font-caption-normal text-sm text-text-secondary">
              {booking.date} at {booking.time}
            </p>
          </div>
        </div>
        <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-caption font-caption-medium bg-${statusConfig.color}/10 text-${statusConfig.color} capitalize`}>
          {booking.status}
        </span>
      </div>

      {/* Quick Status Actions */}
      <div className="grid grid-cols-2 gap-2">
        {statusOptions.map((status) => (
          <button
            key={status.value}
            onClick={() => onStatusUpdate(status.value)}
            disabled={isLoading || booking.status === status.value}
            className={`flex items-center justify-center space-x-2 px-3 py-2 rounded-spa border spa-transition-fast spa-touch-target ${
              booking.status === status.value
                ? `bg-${status.color}/10 border-${status.color}/20 text-${status.color}`
                : 'border-border hover:border-primary/50 text-text-secondary hover:text-text-primary'
            } ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <Icon name={status.icon} size={16} />
            <span className="font-body font-body-medium text-xs">{status.label}</span>
          </button>
        ))}
      </div>

      {/* Customer Information */}
      <div className="space-y-4">
        <h4 className="font-heading font-heading-medium text-base text-text-primary flex items-center space-x-2">
          <Icon name="User" size={18} className="text-primary" />
          <span>Customer Information</span>
        </h4>
        
        <div className="bg-background rounded-spa p-4 space-y-3">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
              <Icon name="User" size={20} className="text-primary" />
            </div>
            <div className="flex-1">
              <p className="font-body font-body-semibold text-base text-text-primary">
                {booking.customerName}
              </p>
              <p className="font-caption font-caption-normal text-sm text-text-secondary">
                {booking.customerGender} • {booking.customerAge} years old
              </p>
            </div>
          </div>
          
          <div className="grid grid-cols-1 gap-3 pt-2">
            <div className="flex items-center space-x-3">
              <Icon name="Mail" size={16} className="text-text-secondary" />
              <span className="font-body font-body-normal text-sm text-text-primary">
                {booking.customerEmail}
              </span>
            </div>
            <div className="flex items-center space-x-3">
              <Icon name="Phone" size={16} className="text-text-secondary" />
              <span className="font-body font-body-normal text-sm text-text-primary">
                {booking.customerPhone}
              </span>
            </div>
            <div className="flex items-center space-x-3">
              <Icon name="MapPin" size={16} className="text-text-secondary" />
              <span className="font-body font-body-normal text-sm text-text-primary">
                {booking.branch}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Service Details */}
      <div className="space-y-4">
        <h4 className="font-heading font-heading-medium text-base text-text-primary flex items-center space-x-2">
          <Icon name="Sparkles" size={18} className="text-primary" />
          <span>Service Details</span>
        </h4>
        
        <div className="bg-background rounded-spa p-4 space-y-4">
          <div className="flex items-start space-x-3">
            <Image 
              src="https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=80&h=80&fit=crop&crop=center"
              alt={booking.service}
              className="w-16 h-16 rounded-spa object-cover"
            />
            <div className="flex-1">
              <h5 className="font-body font-body-semibold text-base text-text-primary">
                {booking.service}
              </h5>
              <p className="font-caption font-caption-normal text-sm text-text-secondary mt-1">
                {booking.serviceDescription}
              </p>
              <div className="flex items-center space-x-4 mt-2">
                <span className="flex items-center space-x-1 text-text-secondary">
                  <Icon name="Clock" size={14} />
                  <span className="font-caption font-caption-normal text-xs">{booking.duration}</span>
                </span>
                <span className="flex items-center space-x-1 text-text-secondary">
                  <Icon name="DollarSign" size={14} />
                  <span className="font-caption font-caption-normal text-xs">{booking.price}</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Special Requests */}
      {booking.specialRequests && (
        <div className="space-y-4">
          <h4 className="font-heading font-heading-medium text-base text-text-primary flex items-center space-x-2">
            <Icon name="MessageSquare" size={18} className="text-primary" />
            <span>Special Requests</span>
          </h4>
          
          <div className="bg-warning/5 border border-warning/20 rounded-spa p-4">
            <p className="font-body font-body-normal text-sm text-text-primary">
              {booking.specialRequests}
            </p>
          </div>
        </div>
      )}

      {/* Customer Preferences */}
      <div className="space-y-4">
        <h4 className="font-heading font-heading-medium text-base text-text-primary flex items-center space-x-2">
          <Icon name="Settings" size={18} className="text-primary" />
          <span>Preferences</span>
        </h4>
        
        <div className="bg-background rounded-spa p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-body font-body-medium text-sm text-text-secondary">
              Therapist Gender Preference
            </span>
            <span className="font-body font-body-normal text-sm text-text-primary capitalize">
              {booking.therapistGenderPreference}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-body font-body-medium text-sm text-text-secondary">
              Pressure Level
            </span>
            <span className="font-body font-body-normal text-sm text-text-primary capitalize">
              {booking.pressureLevel}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-body font-body-medium text-sm text-text-secondary">
              Room Temperature
            </span>
            <span className="font-body font-body-normal text-sm text-text-primary capitalize">
              {booking.roomTemperature}
            </span>
          </div>
        </div>
      </div>

      {/* Previous Visits */}
      {booking.previousVisits && booking.previousVisits.length > 0 && (
        <div className="space-y-4">
          <h4 className="font-heading font-heading-medium text-base text-text-primary flex items-center space-x-2">
            <Icon name="History" size={18} className="text-primary" />
            <span>Previous Visits</span>
          </h4>
          
          <div className="space-y-2">
            {booking.previousVisits.slice(0, 3).map((visit, index) => (
              <div key={index} className="flex items-center space-x-3 p-3 bg-background rounded-spa">
                <div className="w-2 h-2 bg-success rounded-full"></div>
                <div className="flex-1">
                  <p className="font-body font-body-medium text-sm text-text-primary">
                    {visit.service}
                  </p>
                  <p className="font-caption font-caption-normal text-xs text-text-secondary">
                    {visit.date} • {visit.therapist}
                  </p>
                </div>
                <span className="font-caption font-caption-normal text-xs text-text-secondary">
                  {visit.rating}/5 ⭐
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default BookingDetailsPanel;