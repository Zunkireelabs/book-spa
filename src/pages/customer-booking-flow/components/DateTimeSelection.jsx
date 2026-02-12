import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';

const DateTimeSelection = ({ selectedDateTime, onDateTimeSelect, selectedService, genderPreference, onGenderPreferenceChange }) => {
  const [selectedDate, setSelectedDate] = useState(selectedDateTime?.date || '');
  const [selectedTime, setSelectedTime] = useState(selectedDateTime?.time || '');

  // Generate next 30 days
  const generateDates = () => {
    const dates = [];
    const today = new Date();
    
    for (let i = 0; i < 30; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      
      const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
      const dayNumber = date.getDate();
      const monthName = date.toLocaleDateString('en-US', { month: 'short' });
      const fullDate = date.toISOString().split('T')[0];
      
      dates.push({
        dayName,
        dayNumber,
        monthName,
        fullDate,
        isToday: i === 0,
        isWeekend: date.getDay() === 0 || date.getDay() === 6
      });
    }
    
    return dates;
  };

  // Generate time slots
  const generateTimeSlots = () => {
    const slots = [];
    const startHour = 9; // 9 AM
    const endHour = 21; // 9 PM
    
    for (let hour = startHour; hour < endHour; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        const time24 = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        const timeObj = new Date();
        timeObj.setHours(hour, minute);
        const time12 = timeObj.toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          minute: '2-digit', 
          hour12: true 
        });
        
        // Mock availability based on time and gender preference
        const maleAvailable = Math.random() > 0.3;
        const femaleAvailable = Math.random() > 0.2;
        
        slots.push({
          time24,
          time12,
          maleAvailable,
          femaleAvailable,
          isAvailable: (genderPreference === 'male' && maleAvailable) || 
                      (genderPreference === 'female' && femaleAvailable) ||
                      (genderPreference === 'no-preference' && (maleAvailable || femaleAvailable))
        });
      }
    }
    
    return slots;
  };

  const dates = generateDates();
  const timeSlots = generateTimeSlots();

  const handleDateSelect = (date) => {
    setSelectedDate(date);
    setSelectedTime(''); // Reset time when date changes
    onDateTimeSelect({ date, time: '' });
  };

  const handleTimeSelect = (time) => {
    setSelectedTime(time);
    onDateTimeSelect({ date: selectedDate, time });
  };

  const getTherapistIcon = (slot) => {
    if (genderPreference === 'male' && slot.maleAvailable) {
      return <Icon name="User" size={12} className="text-blue-600" />;
    } else if (genderPreference === 'female' && slot.femaleAvailable) {
      return <Icon name="User" size={12} className="text-pink-600" />;
    } else if (genderPreference === 'no-preference') {
      if (slot.maleAvailable && slot.femaleAvailable) {
        return <Icon name="Users" size={12} className="text-primary" />;
      } else if (slot.maleAvailable) {
        return <Icon name="User" size={12} className="text-blue-600" />;
      } else if (slot.femaleAvailable) {
        return <Icon name="User" size={12} className="text-pink-600" />;
      }
    }
    return null;
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="font-heading font-heading-semibold text-2xl text-text-primary mb-2">
          Select Date & Time
        </h2>
        <p className="font-body font-body-normal text-text-secondary">
          Choose your preferred appointment time for {selectedService?.name}
        </p>
      </div>

      {/* Gender Preference */}
      <div className="bg-surface rounded-spa-lg border border-border p-6">
        <h3 className="font-heading font-heading-medium text-lg text-text-primary mb-4">
          Therapist Gender Preference
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { value: 'female', label: 'Female Therapist', icon: 'User', color: 'pink' },
            { value: 'male', label: 'Male Therapist', icon: 'User', color: 'blue' },
            { value: 'no-preference', label: 'No Preference', icon: 'Users', color: 'primary' }
          ].map((option) => (
            <label
              key={option.value}
              className={`flex items-center space-x-3 p-4 rounded-spa border-2 cursor-pointer spa-transition-fast ${
                genderPreference === option.value
                  ? 'border-primary bg-primary/5' :'border-border hover:border-primary/50'
              }`}
            >
              <input
                type="radio"
                name="genderPreference"
                value={option.value}
                checked={genderPreference === option.value}
                onChange={(e) => onGenderPreferenceChange(e.target.value)}
                className="text-primary focus:ring-primary"
              />
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                option.color === 'pink' ? 'bg-pink-100' :
                option.color === 'blue' ? 'bg-blue-100' : 'bg-primary/10'
              }`}>
                <Icon 
                  name={option.icon} 
                  size={16} 
                  className={
                    option.color === 'pink' ? 'text-pink-600' :
                    option.color === 'blue' ? 'text-blue-600' : 'text-primary'
                  } 
                />
              </div>
              <span className="font-body font-body-medium text-sm text-text-primary">
                {option.label}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Date Selection */}
      <div className="bg-surface rounded-spa-lg border border-border p-6">
        <h3 className="font-heading font-heading-medium text-lg text-text-primary mb-4">
          Select Date
        </h3>
        <div className="grid grid-cols-7 gap-2 overflow-x-auto">
          {dates.slice(0, 14).map((date) => (
            <button
              key={date.fullDate}
              onClick={() => handleDateSelect(date.fullDate)}
              className={`flex flex-col items-center p-3 rounded-spa spa-transition-fast spa-touch-target ${
                selectedDate === date.fullDate
                  ? 'bg-primary text-primary-foreground'
                  : date.isToday
                    ? 'bg-accent/10 text-accent hover:bg-accent/20' :'hover:bg-background text-text-secondary hover:text-text-primary'
              }`}
            >
              <span className="font-caption font-caption-normal text-xs mb-1">
                {date.dayName}
              </span>
              <span className="font-heading font-heading-semibold text-lg">
                {date.dayNumber}
              </span>
              <span className="font-caption font-caption-normal text-xs">
                {date.monthName}
              </span>
              {date.isToday && (
                <div className="w-1 h-1 bg-current rounded-full mt-1"></div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Time Selection */}
      {selectedDate && (
        <div className="bg-surface rounded-spa-lg border border-border p-6">
          <h3 className="font-heading font-heading-medium text-lg text-text-primary mb-4">
            Available Time Slots
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {timeSlots.map((slot) => (
              <button
                key={slot.time24}
                onClick={() => slot.isAvailable && handleTimeSelect(slot.time24)}
                disabled={!slot.isAvailable}
                className={`flex flex-col items-center p-3 rounded-spa spa-transition-fast spa-touch-target ${
                  !slot.isAvailable
                    ? 'opacity-50 cursor-not-allowed bg-background text-text-secondary'
                    : selectedTime === slot.time24
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-background text-text-secondary hover:text-text-primary border border-border hover:border-primary/50'
                }`}
              >
                <span className="font-body font-body-medium text-sm mb-1">
                  {slot.time12}
                </span>
                {slot.isAvailable && (
                  <div className="flex items-center space-x-1">
                    {getTherapistIcon(slot)}
                  </div>
                )}
              </button>
            ))}
          </div>
          
          {timeSlots.filter(slot => slot.isAvailable).length === 0 && (
            <div className="text-center py-8">
              <Icon name="Calendar" size={48} className="text-text-secondary mx-auto mb-4" />
              <p className="font-body font-body-normal text-text-secondary">
                No available slots for selected date and preference.
              </p>
              <p className="font-caption font-caption-normal text-sm text-text-secondary mt-2">
                Try selecting a different date or gender preference.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="bg-background rounded-spa p-4">
        <h4 className="font-body font-body-medium text-sm text-text-primary mb-3">
          Therapist Availability Legend
        </h4>
        <div className="flex flex-wrap gap-4 text-xs">
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 bg-blue-100 rounded-full flex items-center justify-center">
              <Icon name="User" size={8} className="text-blue-600" />
            </div>
            <span className="font-caption font-caption-normal text-text-secondary">
              Male Therapist Available
            </span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 bg-pink-100 rounded-full flex items-center justify-center">
              <Icon name="User" size={8} className="text-pink-600" />
            </div>
            <span className="font-caption font-caption-normal text-text-secondary">
              Female Therapist Available
            </span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 bg-primary/10 rounded-full flex items-center justify-center">
              <Icon name="Users" size={8} className="text-primary" />
            </div>
            <span className="font-caption font-caption-normal text-text-secondary">
              Both Available
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DateTimeSelection;