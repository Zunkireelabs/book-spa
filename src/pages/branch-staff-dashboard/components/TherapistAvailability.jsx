import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';

const TherapistAvailability = ({ therapists, pendingBookings = [], onAssignTherapist }) => {
  const [selectedTimeSlot, setSelectedTimeSlot] = useState('current');

  const timeSlots = [
    { value: 'current', label: 'Current Hour' },
    { value: 'next', label: 'Next Hour' },
    { value: 'afternoon', label: 'Afternoon' },
    { value: 'evening', label: 'Evening' }
  ];

  const getAvailabilityColor = (status) => {
    const colors = {
      available: 'success',
      busy: 'error',
      break: 'warning',
      'off-duty': 'text-secondary'
    };
    return colors[status] || 'text-secondary';
  };

  const getAvailabilityIcon = (status) => {
    const icons = {
      available: 'CheckCircle',
      busy: 'Clock',
      break: 'Coffee',
      'off-duty': 'Moon'
    };
    return icons[status] || 'Circle';
  };

  const formatTime = (timeString) => {
    if (!timeString) return '';
    return new Date(`2024-01-01 ${timeString}`).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  return (
    <div className="space-y-3">
      {/* Therapist Availability */}
      <div className="bg-surface rounded-spa-lg border border-[rgba(0,0,29,0.102)] p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-heading font-heading-semibold text-base text-text-primary">
            Therapist Availability
          </h2>
          <select
            value={selectedTimeSlot}
            onChange={(e) => setSelectedTimeSlot(e.target.value)}
            className="px-2 py-1 text-xs border border-border rounded-spa bg-surface text-text-primary focus:ring-2 focus:ring-primary focus:border-primary"
          >
            {timeSlots.map((slot) => (
              <option key={slot.value} value={slot.value}>
                {slot.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          {therapists.map((therapist) => {
            const color = getAvailabilityColor(therapist.status);
            const icon = getAvailabilityIcon(therapist.status);

            return (
              <div
                key={therapist.id}
                className="p-3 bg-background rounded-spa hover:bg-border/30 spa-transition-fast"
              >
                {/* Row 1: Avatar + Name + Status */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 shrink-0 bg-primary/10 rounded-full flex items-center justify-center">
                      <Icon
                        name={therapist.gender === 'Female' ? 'User' : 'UserCheck'}
                        size={16}
                        className="text-primary"
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="font-body font-body-medium text-sm text-text-primary truncate">
                        {therapist.name}
                      </div>
                      <div className="font-caption font-caption-normal text-xs text-text-secondary">
                        {therapist.gender}
                        {therapist.room && ` \u00B7 Room ${therapist.room}`}
                      </div>
                    </div>
                  </div>
                  <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-caption font-caption-normal bg-${color}/10 text-${color}`}>
                    <Icon name={icon} size={10} />
                    {therapist.status.replace('-', ' ')}
                  </span>
                </div>

                {/* Row 2: Specialties */}
                {therapist.specialties && therapist.specialties.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2 pl-10">
                    {therapist.specialties.slice(0, 3).map((specialty) => (
                      <span
                        key={specialty}
                        className="px-1.5 py-0.5 bg-accent/10 text-accent-foreground rounded text-xs font-caption font-caption-normal"
                      >
                        {specialty}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Pending Assignments — from real data */}
      {pendingBookings.length > 0 && (
        <div className="bg-surface rounded-spa-lg border border-[rgba(0,0,29,0.102)] p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-heading font-heading-semibold text-base text-text-primary">
              Pending Assignments
            </h2>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-caption font-caption-normal bg-warning/10 text-warning">
              {pendingBookings.length} pending
            </span>
          </div>

          <div className="space-y-2">
            {pendingBookings.map((booking) => (
              <div
                key={booking.bookingId}
                className="p-3 bg-warning/5 border border-warning/20 rounded-spa"
              >
                <div className="font-body font-body-medium text-sm text-text-primary">
                  {booking.customerName}
                </div>
                <div className="font-caption font-caption-normal text-xs text-text-secondary mt-1 space-y-0.5">
                  <div>{booking.service}</div>
                  <div className="flex items-center gap-1.5">
                    <Icon name="Clock" size={10} className="shrink-0" />
                    <span>{formatTime(booking.time)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="bg-surface rounded-spa-lg border border-[rgba(0,0,29,0.102)] p-4">
        <h2 className="font-heading font-heading-semibold text-base text-text-primary mb-3">
          Quick Actions
        </h2>
        <div className="grid grid-cols-1 gap-2">
          <Button
            variant="outline"
            size="sm"
            fullWidth
            iconName="UserPlus"
            iconPosition="left"
            onClick={() => window.location.href = '/customer-booking-flow'}
          >
            Add Walk-in Customer
          </Button>
          <Button
            variant="outline"
            size="sm"
            fullWidth
            iconName="Calendar"
            iconPosition="left"
          >
            View Full Schedule
          </Button>
        </div>
      </div>
    </div>
  );
};

export default TherapistAvailability;
