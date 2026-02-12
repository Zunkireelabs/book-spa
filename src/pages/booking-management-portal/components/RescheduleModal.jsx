import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';

const RescheduleModal = ({ isOpen, onClose, booking, onConfirm }) => {
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Mock available slots - in real app this would come from API
  const availableSlots = [
    { date: '2024-01-16', times: ['10:00 AM', '2:00 PM', '4:00 PM'] },
    { date: '2024-01-17', times: ['9:00 AM', '11:00 AM', '3:00 PM', '5:00 PM'] },
    { date: '2024-01-18', times: ['10:00 AM', '1:00 PM', '3:00 PM'] },
    { date: '2024-01-19', times: ['9:00 AM', '2:00 PM', '4:00 PM', '6:00 PM'] },
    { date: '2024-01-20', times: ['10:00 AM', '12:00 PM', '2:00 PM'] }
  ];

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  };

  const handleConfirm = async () => {
    if (!selectedDate || !selectedTime) return;

    setIsLoading(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 1500));
      onConfirm({
        ...booking,
        date: formatDate(selectedDate),
        time: selectedTime
      });
      onClose();
    } catch (error) {
      console.error('Reschedule failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-text-primary/50 backdrop-blur-sm z-modal flex items-center justify-center p-4">
      <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-2xl max-h-[90vh] overflow-hidden animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
              <Icon name="Calendar" size={20} className="text-primary" />
            </div>
            <div>
              <h2 className="font-heading font-heading-semibold text-lg text-text-primary">
                Reschedule Booking
              </h2>
              <p className="font-caption font-caption-normal text-sm text-text-secondary">
                {booking?.service} • {booking?.id}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 rounded-spa hover:bg-background spa-transition-fast"
          >
            <Icon name="X" size={20} className="text-text-secondary" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-96">
          {/* Current Booking Info */}
          <div className="mb-6 p-4 bg-background rounded-spa">
            <h3 className="font-heading font-heading-medium text-base text-text-primary mb-2">
              Current Booking
            </h3>
            <div className="flex items-center space-x-4 text-sm">
              <span className="font-body font-body-normal text-text-secondary">
                {booking?.date} at {booking?.time}
              </span>
              <span className="font-body font-body-normal text-text-secondary">
                {booking?.therapist || 'Therapist TBA'}
              </span>
            </div>
          </div>

          {/* Available Slots */}
          <div className="space-y-4">
            <h3 className="font-heading font-heading-medium text-base text-text-primary">
              Select New Date & Time
            </h3>
            
            <div className="space-y-3">
              {availableSlots.map((slot) => (
                <div key={slot.date} className="border border-border rounded-spa p-4">
                  <h4 className="font-body font-body-medium text-sm text-text-primary mb-3">
                    {formatDate(slot.date)}
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {slot.times.map((time) => (
                      <button
                        key={time}
                        onClick={() => {
                          setSelectedDate(slot.date);
                          setSelectedTime(time);
                        }}
                        className={`p-2 rounded-spa text-sm font-body font-body-normal spa-transition-fast spa-touch-target ${
                          selectedDate === slot.date && selectedTime === time
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-background hover:bg-border text-text-primary'
                        }`}
                      >
                        {time}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Selection Summary */}
          {selectedDate && selectedTime && (
            <div className="mt-6 p-4 bg-success/10 border border-success/20 rounded-spa">
              <div className="flex items-center space-x-2">
                <Icon name="CheckCircle" size={16} className="text-success" />
                <span className="font-body font-body-medium text-sm text-success">
                  New appointment: {formatDate(selectedDate)} at {selectedTime}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-border">
          <div className="text-xs text-text-secondary">
            <p className="font-caption font-caption-normal">
              • Free rescheduling up to 24 hours before appointment
            </p>
            <p className="font-caption font-caption-normal">
              • Same therapist will be assigned if available
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button 
              variant="primary" 
              onClick={handleConfirm}
              loading={isLoading}
              disabled={!selectedDate || !selectedTime}
            >
              Confirm Reschedule
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RescheduleModal;