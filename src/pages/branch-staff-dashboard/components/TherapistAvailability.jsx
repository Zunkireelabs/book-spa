import React, { useState, useRef, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';

const TherapistAvailability = ({ therapists, pendingBookings = [], onAssignTherapist }) => {
  const [selectedTimeSlot, setSelectedTimeSlot] = useState('current');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  const timeSlots = [
    { value: 'current', label: 'Current Hour' },
    { value: 'next', label: 'Next Hour' },
    { value: 'afternoon', label: 'Afternoon' },
    { value: 'evening', label: 'Evening' }
  ];

  const selectedLabel = timeSlots.find(s => s.value === selectedTimeSlot)?.label || 'Current Hour';

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsDropdownOpen(false);
      }
    };
    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isDropdownOpen]);

  const getAvailabilityColor = (status) => {
    const colors = {
      available: 'emerald',
      busy: 'red',
      break: 'amber',
      upcoming: 'blue',
      'off-duty': 'gray'
    };
    return colors[status] || 'gray';
  };

  const getAvailabilityIcon = (status) => {
    const icons = {
      available: 'CheckCircle',
      busy: 'Clock',
      break: 'Coffee',
      upcoming: 'Calendar',
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
      {/* Pending Assignments — from real data */}
      {pendingBookings.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="flex items-center justify-between p-3 border-b border-gray-200">
            <h2 className="text-sm font-semibold text-gray-900">
              Pending Assignments
            </h2>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
              {pendingBookings.length} pending
            </span>
          </div>

          <div className="divide-y divide-gray-100">
            {pendingBookings.map((booking) => (
              <div
                key={booking.bookingId}
                className="p-3"
              >
                <div className="text-sm font-medium text-gray-900">
                  {booking.customerName}
                </div>
                <div className="text-xs text-gray-500 mt-1 space-y-0.5">
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
      <div className="bg-white rounded-lg border border-gray-200 p-3">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">
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

      {/* Therapist Availability */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="flex items-center justify-between p-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900">
            Therapist Availability
          </h2>
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="flex items-center gap-1.5 h-7 px-2.5 text-xs border border-gray-200 rounded-md bg-white text-gray-700 hover:border-gray-300 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary cursor-pointer whitespace-nowrap"
            >
              <span>{selectedLabel}</span>
              <Icon name="ChevronDown" size={12} className={`text-gray-400 flex-shrink-0 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            {isDropdownOpen && (
              <div className="absolute right-0 top-full mt-1 w-32 bg-white border border-gray-200 rounded-md shadow-lg z-50 py-1">
                {timeSlots.map((slot) => (
                  <button
                    key={slot.value}
                    type="button"
                    onClick={() => {
                      setSelectedTimeSlot(slot.value);
                      setIsDropdownOpen(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 ${
                      selectedTimeSlot === slot.value ? 'text-primary font-medium bg-gray-50' : 'text-gray-700'
                    }`}
                  >
                    {slot.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="divide-y divide-gray-100">
          {therapists.map((therapist) => {
            const color = getAvailabilityColor(therapist.status);
            const icon = getAvailabilityIcon(therapist.status);

            return (
              <div
                key={therapist.id}
                className="p-3 hover:bg-gray-50 transition-colors"
              >
                {/* Row 1: Avatar + Name + Status */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 shrink-0 bg-gray-100 rounded-full flex items-center justify-center">
                      <Icon
                        name={therapist.gender === 'Female' ? 'User' : 'UserCheck'}
                        size={16}
                        className="text-gray-500"
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {therapist.name}
                      </div>
                      <div className="text-xs text-gray-500">
                        {therapist.gender}
                        {therapist.room && ` · Room ${therapist.room}`}
                      </div>
                    </div>
                  </div>
                  <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-${color}-100 text-${color}-700`}>
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
                        className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-xs"
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
    </div>
  );
};

export default TherapistAvailability;
