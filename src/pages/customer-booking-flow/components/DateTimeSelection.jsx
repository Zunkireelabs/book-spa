import React, { useState, useEffect, useMemo } from 'react';
import Icon from '../../../components/AppIcon';
import { supabase } from '../../../lib/supabase';
import { fetchBranchAvailabilityWindow, getRoomCapacity } from '../../../services/api';
import { useTenant } from '../../../contexts/TenantContext';
import {
  START_HOUR,
  END_HOUR,
  getNepalNow,
  getNepalToday,
  minutesToTime24,
  minutesToTime12,
  buildOccupancy,
} from '../utils/availability';

const WINDOW_DAYS = 14; // matches the 14 date-chips rendered below — one fetch covers all of them

const DateTimeSelection = ({ selectedDateTime, onDateTimeSelect, selectedService, selectedBranch, genderPreference, onGenderPreferenceChange }) => {
  const { enableStaffGender, enableRooms, staffLabel } = useTenant();
  const [selectedDate, setSelectedDate] = useState(selectedDateTime?.date || '');
  const [selectedTime, setSelectedTime] = useState(selectedDateTime?.time || '');
  const [therapistCounts, setTherapistCounts] = useState({ male: 0, female: 0 });
  const [availabilityWindow, setAvailabilityWindow] = useState(null); // days 0..13
  const [extendedWindow, setExtendedWindow] = useState(null); // days 14..29, fetched on demand
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [loadingExtended, setLoadingExtended] = useState(false);

  // Fetch therapist counts for the selected branch (once) — advisory gender signal only; real
  // availability is gated by room capacity below.
  useEffect(() => {
    if (!selectedBranch?.id) return;
    async function fetchTherapistCounts() {
      const { data } = await supabase
        .from('therapists')
        .select('gender')
        .eq('branch_id', selectedBranch.id)
        .eq('is_active', true);
      if (data) {
        const male = data.filter(t => t.gender?.toLowerCase() === 'male').length;
        const female = data.filter(t => t.gender?.toLowerCase() === 'female').length;
        setTherapistCounts({ male, female });
      }
    }
    fetchTherapistCounts();
  }, [selectedBranch?.id]);

  // Generate next 30 days (date-chip strip)
  const dates = useMemo(() => {
    const result = [];
    const today = new Date();

    for (let i = 0; i < 30; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);

      const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
      const dayNumber = date.getDate();
      const monthName = date.toLocaleDateString('en-US', { month: 'short' });
      const fullDate = date.toISOString().split('T')[0];

      result.push({
        dayName,
        dayNumber,
        monthName,
        fullDate,
        isToday: i === 0,
        isWeekend: date.getDay() === 0 || date.getDay() === 6
      });
    }

    return result;
  }, []);

  // Fetch the rolling 14-day real-availability window once per branch — replaces the old
  // per-date-click fetch. Duration/service changes don't need a refetch; they only change which
  // of the already-fetched bookings block a candidate slot (computed in `computedDays` below).
  useEffect(() => {
    if (!selectedBranch?.id) return;
    setLoadingSlots(true);
    setExtendedWindow(null);
    fetchBranchAvailabilityWindow(selectedBranch.id, dates[0].fullDate, dates[WINDOW_DAYS - 1].fullDate)
      .then(setAvailabilityWindow)
      .catch((err) => console.error('[DateTimeSelection] availability fetch failed:', err.message))
      .finally(() => setLoadingSlots(false));
  }, [selectedBranch?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadFurtherAhead = () => {
    if (!selectedBranch?.id || loadingExtended || extendedWindow) return;
    setLoadingExtended(true);
    fetchBranchAvailabilityWindow(selectedBranch.id, dates[WINDOW_DAYS].fullDate, dates[29].fullDate)
      .then(setExtendedWindow)
      .catch((err) => console.error('[DateTimeSelection] extended availability fetch failed:', err.message))
      .finally(() => setLoadingExtended(false));
  };

  // Real, duration-aware, per-room-capacity availability across the whole fetched window.
  const computedDays = useMemo(() => {
    if (!availabilityWindow) return [];

    const rooms = availabilityWindow.rooms || [];
    const allBookings = [...(availabilityWindow.bookings || []), ...(extendedWindow?.bookings || [])];
    const { byRoom, byGender } = buildOccupancy(allBookings);

    const duration = selectedService?.durationMinutes || 60;
    const nepalToday = getNepalToday();
    const nepalNow = getNepalNow();
    const nowMinutes = nepalNow.getHours() * 60 + nepalNow.getMinutes();
    const dayList = extendedWindow ? dates.slice(0, 30) : dates.slice(0, WINDOW_DAYS);

    return dayList.map((d) => {
      const isToday = d.fullDate === nepalToday;
      const slots = [];

      for (let start = START_HOUR * 60; start + duration <= END_HOUR * 60; start += 30) {
        const isPast = isToday && start <= nowMinutes;

        let roomAvailable = true;
        if (enableRooms) {
          roomAvailable = rooms.some((room) => {
            const capacity = getRoomCapacity(room);
            for (let offset = 0; offset < duration; offset += 30) {
              const occupied = byRoom[d.fullDate]?.[room.id]?.get(start + offset) || 0;
              if (occupied >= capacity) return false;
            }
            return true;
          });
        }

        let maleAvailable = true;
        let femaleAvailable = true;
        for (let offset = 0; offset < duration; offset += 30) {
          const booked = byGender[d.fullDate]?.get(start + offset) || { male: 0, female: 0 };
          if (therapistCounts.male - booked.male <= 0) maleAvailable = false;
          if (therapistCounts.female - booked.female <= 0) femaleAvailable = false;
        }

        const genderOk =
          (genderPreference === 'male' && maleAvailable) ||
          (genderPreference === 'female' && femaleAvailable) ||
          (genderPreference === 'no-preference' && (maleAvailable || femaleAvailable));

        const isAvailable = !isPast && roomAvailable && genderOk;

        slots.push({
          time24: minutesToTime24(start),
          time12: minutesToTime12(start),
          maleAvailable,
          femaleAvailable,
          isPast,
          isAvailable,
        });
      }

      return { date: d.fullDate, slots };
    });
  }, [availabilityWindow, extendedWindow, selectedService?.durationMinutes, genderPreference, enableRooms, therapistCounts, dates]);

  const timeSlots = useMemo(
    () => computedDays.find((d) => d.date === selectedDate)?.slots || [],
    [computedDays, selectedDate]
  );

  // Nearest open slots across the whole fetched window — clicking one jumps straight to that
  // date+time instead of the customer having to browse day by day. Capped at one slot per day so
  // the 3 picks are genuinely different options, not 3 near-identical times an hour apart.
  const nearestSlots = useMemo(() => {
    const picks = [];
    for (const d of computedDays) {
      const earliest = d.slots.find((s) => s.isAvailable);
      if (earliest) picks.push({ ...earliest, date: d.date });
      if (picks.length === 3) break;
    }
    return picks;
  }, [computedDays]);

  const datesWithNoAvailability = useMemo(() => {
    const set = new Set();
    computedDays.forEach((d) => {
      if (!d.slots.some((s) => s.isAvailable)) set.add(d.date);
    });
    return set;
  }, [computedDays]);

  // Some (but not all) slots are taken — distinct from fully booked, so customers can see a day
  // still has openings before they tap into it.
  const datesPartiallyBooked = useMemo(() => {
    const set = new Set();
    computedDays.forEach((d) => {
      const upcoming = d.slots.filter((s) => !s.isPast);
      if (upcoming.length === 0) return;
      const availableCount = upcoming.filter((s) => s.isAvailable).length;
      if (availableCount > 0 && availableCount < upcoming.length) set.add(d.date);
    });
    return set;
  }, [computedDays]);

  const noSlotsInWindow = computedDays.length > 0 && nearestSlots.length === 0;

  const handleDateSelect = (date) => {
    setSelectedDate(date);
    setSelectedTime('');
    onDateTimeSelect({ date, time: '' });
  };

  const handleTimeSelect = (time) => {
    setSelectedTime(time);
    onDateTimeSelect({ date: selectedDate, time });
  };

  const handleQuickPick = (slot) => {
    setSelectedDate(slot.date);
    setSelectedTime(slot.time24);
    onDateTimeSelect({ date: slot.date, time: slot.time24 });
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

  const formatQuickPickLabel = (slot) => {
    const dateInfo = dates.find((d) => d.fullDate === slot.date);
    const dayLabel = dateInfo?.isToday ? 'Today' : dateInfo ? `${dateInfo.dayName} ${dateInfo.dayNumber}` : slot.date;
    return `${dayLabel}, ${slot.time12}`;
  };

  return (
    <div className="space-y-4">
      {selectedService && (
        <div className="flex items-center gap-2 px-4 py-2 bg-primary/5 border border-primary/10 rounded-spa text-sm">
          <Icon name="Clock" size={14} className="text-primary" />
          <span className="font-body font-body-normal text-text-secondary">
            Showing real availability for <span className="font-body font-body-medium text-text-primary">{selectedService.name}</span>
            {' '}({selectedService.durationMinutes || 60} min) — a slot is only shown open if a room is free for the entire duration.
          </span>
        </div>
      )}

      {/* Gender Preference - only shown for industries that use it */}
      {enableStaffGender && (
        <div className="bg-surface rounded-spa-lg border border-border p-6">
          <h3 className="font-heading font-heading-medium text-lg text-text-primary mb-4">
            {staffLabel} Gender Preference
          </h3>
          <div className="grid grid-cols-3 gap-2 sm:gap-4">
            {[
              { value: 'female', label: `Female ${staffLabel}`, icon: 'User', color: 'pink' },
              { value: 'male', label: `Male ${staffLabel}`, icon: 'User', color: 'blue' },
              { value: 'no-preference', label: 'No Preference', icon: 'Users', color: 'primary' }
            ].map((option) => (
              <label
                key={option.value}
                className={`relative flex flex-col items-center text-center gap-1 sm:gap-2 p-2 sm:p-3 rounded-spa border-2 cursor-pointer spa-transition-fast ${
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
                  className="absolute top-1.5 right-1.5 sm:top-2 sm:right-2 text-primary focus:ring-primary"
                />
                <div className={`w-6 h-6 sm:w-8 sm:h-8 rounded-full flex items-center justify-center ${
                  option.color === 'pink' ? 'bg-pink-100' :
                  option.color === 'blue' ? 'bg-blue-100' : 'bg-primary/10'
                }`}>
                  <Icon
                    name={option.icon}
                    size={14}
                    className={
                      option.color === 'pink' ? 'text-pink-600' :
                      option.color === 'blue' ? 'text-blue-600' : 'text-primary'
                    }
                  />
                </div>
                <span className="font-body font-body-medium text-xs sm:text-sm leading-tight text-text-primary">
                  {option.label}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Quick picks — nearest real openings across the whole window */}
      {!loadingSlots && nearestSlots.length > 0 && (
        <div className="bg-surface rounded-spa-lg border border-border p-6">
          <h3 className="font-heading font-heading-medium text-lg text-text-primary mb-4">
            Quick Picks — Next Available
          </h3>
          <div className="grid grid-cols-3 gap-2">
            {nearestSlots.map((slot, i) => (
              <button
                key={`${slot.date}-${slot.time24}-${i}`}
                onClick={() => handleQuickPick(slot)}
                className={`flex flex-col items-center justify-center text-center gap-1 px-2 py-2 rounded-spa border spa-transition-fast spa-touch-target ${
                  selectedDate === slot.date && selectedTime === slot.time24
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border hover:border-primary/50 text-text-primary'
                }`}
              >
                <Icon name="Zap" size={14} />
                <span className="font-body font-body-medium text-xs sm:text-sm min-w-0 break-words">{formatQuickPickLabel(slot)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Date Selection — @container lets this show fewer, bigger columns when it's rendered
          inside a narrow parent (e.g. the v2 booking drawer) and the full 7 columns when it
          has a wide page-width parent (v1), without either caller needing to pass a prop. */}
      <div className="@container bg-surface rounded-spa-lg border border-border p-6">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
          <h3 className="font-heading font-heading-medium text-lg text-text-primary">
            Select Date
          </h3>
          {(computedDays.some((d) => !d.slots.some((s) => s.isAvailable)) || datesPartiallyBooked.size > 0) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">
              {computedDays.some((d) => !d.slots.some((s) => s.isAvailable)) && (
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-error inline-block" />
                  <span className="font-caption">Fully booked</span>
                </div>
              )}
              {datesPartiallyBooked.size > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-warning inline-block" />
                  <span className="font-caption">Limited availability</span>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="grid grid-cols-4 @2xl:grid-cols-7 gap-2">
          {dates.slice(0, 14).map((date) => {
            const isFull = datesWithNoAvailability.has(date.fullDate);
            const isPartial = !isFull && datesPartiallyBooked.has(date.fullDate);
            const isSelected = selectedDate === date.fullDate;
            return (
              <button
                key={date.fullDate}
                onClick={() => handleDateSelect(date.fullDate)}
                className={`relative flex flex-col items-center p-3 rounded-spa spa-transition-fast spa-touch-target ${
                  isSelected
                    ? 'bg-primary text-primary-foreground'
                    : isFull
                      ? 'bg-error/5 border border-error/20 text-text-secondary hover:bg-error/10'
                      : isPartial
                        ? 'bg-warning/5 border border-warning/20 text-text-secondary hover:bg-warning/10'
                        : date.isToday
                          ? 'bg-accent/10 text-accent hover:bg-accent/20' :'hover:bg-background text-text-secondary hover:text-text-primary'
                }`}
              >
                {(isFull || isPartial) && (
                  <span
                    title={isFull ? 'Fully booked for this service' : 'Limited availability for this service'}
                    className={`absolute -top-1.5 -right-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-caption font-caption-medium leading-none whitespace-nowrap text-white border ${
                      isSelected ? 'border-primary-foreground/40' : 'border-surface'
                    } ${isFull ? 'bg-error' : 'bg-warning'}`}
                  >
                    {isFull ? 'Full' : 'Low'}
                  </span>
                )}
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
                  <div className={`w-1 h-1 rounded-full mt-1 ${isSelected ? 'bg-primary-foreground' : 'bg-accent'}`}></div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Time Selection — @container: same reasoning as the date grid above, fewer/wider
          columns when this renders inside the narrow v2 drawer than inside the wide v1 page. */}
      {selectedDate && (
        <div className="@container bg-surface rounded-spa-lg border border-border p-6">
          <h3 className="font-heading font-heading-medium text-lg text-text-primary mb-4">
            Available Time Slots
          </h3>
          {loadingSlots ? (
            <div className="text-center py-8">
              <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
              <p className="font-body font-body-normal text-text-secondary">Checking availability...</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 @sm:grid-cols-5 @2xl:grid-cols-6 gap-3">
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
                  {slot.isPast && (
                    <span className="font-caption text-xs text-text-secondary">Past</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {!loadingSlots && timeSlots.filter(slot => slot.isAvailable).length === 0 && (
            <div className="text-center py-8">
              <Icon name="CalendarX" size={48} className="text-error/60 mx-auto mb-4" />
              <p className="font-body font-body-medium text-text-primary">
                {datesWithNoAvailability.has(selectedDate)
                  ? 'This day is fully booked for the selected service.'
                  : 'No available slots for selected date and preference.'}
              </p>
              <p className="font-caption font-caption-normal text-sm text-text-secondary mt-2">
                Try a different date{enableStaffGender ? ' or gender preference' : ''} — or tap a Quick Pick above.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Empty-window fallback — only fetched on demand, never eagerly */}
      {!loadingSlots && noSlotsInWindow && (
        <div className="bg-background rounded-spa p-4 text-center">
          {extendedWindow ? (
            <p className="font-body font-body-normal text-sm text-text-secondary">
              No openings found in the next 30 days for this service.
            </p>
          ) : (
            <>
              <p className="font-body font-body-normal text-sm text-text-secondary mb-3">
                No openings in the next {WINDOW_DAYS} days.
              </p>
              <button
                onClick={loadFurtherAhead}
                disabled={loadingExtended}
                className="text-sm font-body font-body-medium text-primary hover:text-primary/80 spa-transition-fast"
              >
                {loadingExtended ? 'Checking further out…' : 'Check further ahead (up to 30 days)'}
              </button>
            </>
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
