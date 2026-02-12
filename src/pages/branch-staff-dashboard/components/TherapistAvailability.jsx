import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';

const TherapistAvailability = ({ therapists, onAssignTherapist }) => {
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

  return (
    <div className="space-y-6">
      {/* Therapist Availability */}
      <div className="bg-surface rounded-spa-lg spa-shadow-resting p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-heading font-heading-semibold text-lg text-text-primary">
            Therapist Availability
          </h2>
          <select
            value={selectedTimeSlot}
            onChange={(e) => setSelectedTimeSlot(e.target.value)}
            className="px-3 py-1 text-sm border border-border rounded-spa bg-surface text-text-primary focus:ring-2 focus:ring-primary focus:border-primary"
          >
            {timeSlots.map((slot) => (
              <option key={slot.value} value={slot.value}>
                {slot.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-3">
          {therapists.map((therapist) => (
            <div
              key={therapist.id}
              className="flex items-center justify-between p-3 bg-background rounded-spa hover:bg-border/30 spa-transition-fast"
            >
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                  <Icon 
                    name={therapist.gender === 'Female' ? 'User' : 'UserCheck'} 
                    size={20} 
                    className="text-primary" 
                  />
                </div>
                <div>
                  <div className="font-body font-body-medium text-sm text-text-primary">
                    {therapist.name}
                  </div>
                  <div className="flex items-center space-x-2 text-xs text-text-secondary">
                    <span>{therapist.gender}</span>
                    <span>•</span>
                    <span>Room {therapist.room}</span>
                    <span>•</span>
                    <div className="flex flex-wrap gap-1">
                      {therapist.specialties.slice(0, 2).map((specialty) => (
                        <span 
                          key={specialty}
                          className="px-1 py-0.5 bg-accent/10 text-accent rounded text-xs"
                        >
                          {specialty}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-caption font-caption-normal bg-${getAvailabilityColor(therapist.status)}/10 text-${getAvailabilityColor(therapist.status)}`}>
                  <Icon name={getAvailabilityIcon(therapist.status)} size={12} className="mr-1" />
                  {therapist.status.replace('-', ' ')}
                </span>
                {therapist.status === 'available' && (
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => onAssignTherapist(therapist.id)}
                  >
                    Assign
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Pending Assignments */}
      <div className="bg-surface rounded-spa-lg spa-shadow-resting p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-heading font-heading-semibold text-lg text-text-primary">
            Pending Assignments
          </h2>
          <span className="inline-flex items-center px-2 py-1 rounded text-xs font-caption font-caption-normal bg-warning/10 text-warning">
            3 pending
          </span>
        </div>

        <div className="space-y-3">
          {[
            {
              id: 'BK-001',
              customerName: 'Sarah Johnson',
              service: 'Deep Tissue Massage',
              time: '2:00 PM',
              genderPreference: 'Female'
            },
            {
              id: 'BK-002',
              customerName: 'Michael Chen',
              service: 'Swedish Massage',
              time: '3:30 PM',
              genderPreference: 'Male'
            },
            {
              id: 'BK-003',
              customerName: 'Emma Wilson',
              service: 'Aromatherapy',
              time: '4:00 PM',
              genderPreference: 'Female'
            }
          ].map((booking) => (
            <div
              key={booking.id}
              className="flex items-center justify-between p-3 bg-warning/5 border border-warning/20 rounded-spa"
            >
              <div>
                <div className="font-body font-body-medium text-sm text-text-primary">
                  {booking.customerName}
                </div>
                <div className="flex items-center space-x-2 text-xs text-text-secondary">
                  <span>{booking.service}</span>
                  <span>•</span>
                  <span>{booking.time}</span>
                  <span>•</span>
                  <span>Prefers {booking.genderPreference}</span>
                </div>
              </div>
              <Button
                variant="warning"
                size="xs"
                onClick={() => onAssignTherapist(booking.id)}
              >
                Assign Now
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-surface rounded-spa-lg spa-shadow-resting p-6">
        <h2 className="font-heading font-heading-semibold text-lg text-text-primary mb-4">
          Quick Actions
        </h2>
        <div className="grid grid-cols-1 gap-3">
          <Button
            variant="outline"
            fullWidth
            iconName="UserPlus"
            iconPosition="left"
          >
            Add Walk-in Customer
          </Button>
          <Button
            variant="outline"
            fullWidth
            iconName="Calendar"
            iconPosition="left"
          >
            View Full Schedule
          </Button>
          <Button
            variant="outline"
            fullWidth
            iconName="MessageSquare"
            iconPosition="left"
          >
            Send Customer Update
          </Button>
          <Button
            variant="outline"
            fullWidth
            iconName="AlertTriangle"
            iconPosition="left"
          >
            Report Issue
          </Button>
        </div>
      </div>
    </div>
  );
};

export default TherapistAvailability;