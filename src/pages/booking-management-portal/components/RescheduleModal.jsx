import React, { useState, useMemo } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';

const RescheduleModal = ({ isOpen, onClose, booking, onConfirm }) => {
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Generate next 14 days
  const dates = useMemo(() => {
    const result = [];
    const today = new Date();
    for (let i = 1; i <= 14; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      result.push({
        fullDate: date.toISOString().split('T')[0],
        display: date.toLocaleDateString('en-GB', {
          weekday: 'short', day: 'numeric', month: 'short'
        })
      });
    }
    return result;
  }, []);

  // Generate time slots 9AM-9PM
  const timeSlots = useMemo(() => {
    const slots = [];
    for (let hour = 9; hour < 21; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        const time24 = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        const timeObj = new Date();
        timeObj.setHours(hour, minute);
        const time12 = timeObj.toLocaleTimeString('en-US', {
          hour: 'numeric', minute: '2-digit', hour12: true
        });
        slots.push({ time24, time12 });
      }
    }
    return slots;
  }, []);

  const handleConfirm = async () => {
    if (!selectedDate || !selectedTime) return;
    setIsLoading(true);
    setError(null);

    try {
      const result = await onConfirm({
        bookingId: booking.bookingId,
        newDate: selectedDate,
        newStartTime: selectedTime
      });

      if (result?.error) {
        setError(result.error.message || 'Failed to reschedule booking.');
      } else {
        onClose();
      }
    } catch (err) {
      setError('An unexpected error occurred.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-text-primary/50 backdrop-blur-sm z-modal flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="reschedule-modal-title">
      <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-2xl max-h-[90vh] overflow-hidden animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
              <Icon name="Calendar" size={20} className="text-primary" />
            </div>
            <div>
              <h2 id="reschedule-modal-title" className="font-heading font-heading-semibold text-lg text-text-primary">
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
                {booking?.therapist?.name || 'Therapist TBA'}
              </span>
            </div>
          </div>

          {/* Date Selection */}
          <div className="space-y-4">
            <h3 className="font-heading font-heading-medium text-base text-text-primary">
              Select New Date
            </h3>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {dates.map(d => (
                <button
                  key={d.fullDate}
                  onClick={() => { setSelectedDate(d.fullDate); setSelectedTime(''); }}
                  className={`p-2 rounded-spa text-sm font-body spa-transition-fast spa-touch-target text-center ${
                    selectedDate === d.fullDate
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background hover:bg-border text-text-primary'
                  }`}
                >
                  {d.display}
                </button>
              ))}
            </div>
          </div>

          {/* Time Selection */}
          {selectedDate && (
            <div className="space-y-4 mt-6">
              <h3 className="font-heading font-heading-medium text-base text-text-primary">
                Select New Time
              </h3>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {timeSlots.map(s => (
                  <button
                    key={s.time24}
                    onClick={() => setSelectedTime(s.time24)}
                    className={`p-2 rounded-spa text-sm font-body spa-transition-fast spa-touch-target ${
                      selectedTime === s.time24
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-background hover:bg-border text-text-primary'
                    }`}
                  >
                    {s.time12}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Selection Summary */}
          {selectedDate && selectedTime && (
            <div className="mt-6 p-4 bg-success/10 border border-success/20 rounded-spa">
              <div className="flex items-center space-x-2">
                <Icon name="CheckCircle" size={16} className="text-success" />
                <span className="font-body font-body-medium text-sm text-success">
                  New appointment: {dates.find(d => d.fullDate === selectedDate)?.display} at{' '}
                  {timeSlots.find(s => s.time24 === selectedTime)?.time12}
                </span>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mt-4 p-3 bg-error/10 border border-error/20 rounded-spa">
              <div className="flex items-center space-x-2">
                <Icon name="AlertTriangle" size={16} className="text-error" />
                <span className="font-body font-body-normal text-sm text-error">{error}</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-border">
          <div className="text-xs text-text-secondary">
            <p className="font-caption font-caption-normal">
              • Room availability will be checked automatically
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
