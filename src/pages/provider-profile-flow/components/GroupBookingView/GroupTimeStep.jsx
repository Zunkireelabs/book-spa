import React, { useState, useEffect, useMemo } from 'react';
import Icon from '../../../../components/AppIcon';
import { useTenant } from '../../../../contexts/TenantContext';
import { fetchBranchAvailabilityWindow, fetchTherapistAvailabilityWindow, fetchClosedDateRanges } from '../../../../services/api';
import { isDateInRanges } from '../../../customer-booking-flow/utils/availability';
import { computeGroupSlots } from '../../utils/groupAvailability';

// Shared time-slot step — one calendar for the whole party. Fetches the branch-wide
// bookings window and the branch-wide therapist busy-rows window ONCE (both already
// cover every therapist/room, not filtered per selection — same two fetches the solo
// DateTimeSelection makes), then computeGroupSlots (Task 2) finds slots where every
// person's pick is simultaneously satisfiable. Rendering mirrors DateTimeSelection.jsx's
// date-chip-strip + time-grid, simplified: no gender preference or quick-picks, since
// v1 group booking has neither.
const GroupTimeStep = ({ selectedBranch, orgSlug, people, therapists, selectedDateTime, onDateTimeSelect }) => {
  const { enableRooms } = useTenant();
  const [selectedDate, setSelectedDate] = useState(selectedDateTime?.date || '');
  const [availabilityWindow, setAvailabilityWindow] = useState(null);
  const [therapistWindow, setTherapistWindow] = useState(null);
  const [closedRanges, setClosedRanges] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  const effectiveWindow = selectedBranch?.advance_booking_days ?? 30;

  const dates = useMemo(() => {
    const result = [];
    const today = new Date();
    for (let i = 0; i < effectiveWindow; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      result.push({
        dayName: date.toLocaleDateString('en-US', { weekday: 'short' }),
        dayNumber: date.getDate(),
        monthName: date.toLocaleDateString('en-US', { month: 'short' }),
        fullDate: date.toISOString().split('T')[0],
        isToday: i === 0,
      });
    }
    return result;
  }, [effectiveWindow]);

  useEffect(() => {
    if (!selectedBranch?.id) return;
    setLoadingSlots(true);
    fetchBranchAvailabilityWindow(selectedBranch.id, dates[0].fullDate, dates[effectiveWindow - 1].fullDate)
      .then(setAvailabilityWindow)
      .catch((err) => console.error('[GroupTimeStep] availability fetch failed:', err.message))
      .finally(() => setLoadingSlots(false));
  }, [selectedBranch?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedBranch?.id) return;
    fetchTherapistAvailabilityWindow(orgSlug, selectedBranch.id, dates[0].fullDate, dates[effectiveWindow - 1].fullDate)
      .then(setTherapistWindow)
      .catch((err) => console.error('[GroupTimeStep] therapist availability fetch failed:', err.message));
  }, [selectedBranch?.id, orgSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedBranch?.id) { setClosedRanges([]); return; }
    fetchClosedDateRanges(selectedBranch.id)
      .then(({ data }) => setClosedRanges(data || []))
      .catch((err) => console.error('[GroupTimeStep] closed-dates fetch failed:', err.message));
  }, [selectedBranch?.id]);

  const resolvedPeople = useMemo(() => people.map((p) => ({
    id: p.id,
    service: p.service,
    professional: p.professional,
  })), [people]);

  const onlineCapacity = selectedBranch?.online_booking_capacity ?? null;

  const computedDays = useMemo(() => {
    if (!availabilityWindow) return [];
    return computeGroupSlots({
      dates,
      availabilityWindow,
      therapistWindow,
      closedRanges,
      enableRooms,
      onlineCapacity,
      people: resolvedPeople,
      allTherapists: therapists || [],
    });
  }, [availabilityWindow, therapistWindow, closedRanges, enableRooms, onlineCapacity, resolvedPeople, therapists, dates]);

  const closedDatesSet = useMemo(() => {
    const set = new Set();
    dates.forEach((d) => { if (isDateInRanges(d.fullDate, closedRanges)) set.add(d.fullDate); });
    return set;
  }, [dates, closedRanges]);

  const datesWithNoAvailability = useMemo(() => {
    const set = new Set();
    computedDays.forEach((d) => { if (!d.slots.some((s) => s.isAvailable)) set.add(d.date); });
    return set;
  }, [computedDays]);

  const timeSlots = useMemo(
    () => computedDays.find((d) => d.date === selectedDate)?.slots || [],
    [computedDays, selectedDate]
  );

  const handleDateSelect = (date) => {
    setSelectedDate(date);
    onDateTimeSelect({ date, time: '' });
  };

  const handleTimeSelect = (time) => {
    onDateTimeSelect({ date: selectedDate, time });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-4 py-2 bg-[var(--zn-primary-tint)] border border-[var(--zn-primary-soft)] rounded-[var(--zn-radius-lg)] text-sm">
        <Icon name="Clock" size={14} className="text-[var(--zn-primary)]" />
        <span className="text-[var(--zn-muted-foreground)]">
          Showing a time that works for all {people.length} {people.length === 1 ? 'person' : 'people'} in your group.
        </span>
      </div>

      <div className="@container bg-[var(--zn-card)] rounded-[var(--zn-radius-lg)] border border-[var(--zn-border)] p-6">
        <h3 className="font-medium text-lg text-[var(--zn-foreground)] mb-4">Select date</h3>
        <div className="grid grid-cols-4 @2xl:grid-cols-7 gap-2">
          {dates.map((date) => {
            const isClosed = closedDatesSet.has(date.fullDate);
            const isFull = !isClosed && datesWithNoAvailability.has(date.fullDate);
            const isSelected = selectedDate === date.fullDate;
            return (
              <button
                key={date.fullDate}
                onClick={() => !isClosed && handleDateSelect(date.fullDate)}
                disabled={isClosed}
                className={`relative flex flex-col items-center py-2 px-1 rounded-[var(--zn-radius-md)] transition-colors ${
                  isClosed
                    ? 'bg-[var(--zn-background)] border border-[var(--zn-border)] text-[var(--zn-muted-foreground)]/50 cursor-not-allowed opacity-70'
                    : isSelected
                      ? 'bg-[var(--zn-primary)] text-[var(--zn-primary-foreground)]'
                      : isFull
                        ? 'bg-error/5 border border-error/20 text-[var(--zn-muted-foreground)]'
                        : 'hover:bg-[var(--zn-background)] text-[var(--zn-muted-foreground)] hover:text-[var(--zn-foreground)]'
                }`}
              >
                <span className="text-[10px] mb-0.5">{date.dayName}</span>
                <span className="font-semibold text-base">{date.dayNumber}</span>
                <span className="text-[10px]">{date.monthName}</span>
              </button>
            );
          })}
        </div>
      </div>

      {selectedDate && (
        <div className="@container bg-[var(--zn-card)] rounded-[var(--zn-radius-lg)] border border-[var(--zn-border)] p-6">
          <h3 className="font-medium text-lg text-[var(--zn-foreground)] mb-4">Available time slots</h3>
          {loadingSlots ? (
            <div className="text-center py-8">
              <div className="animate-spin w-8 h-8 border-2 border-[var(--zn-primary)] border-t-transparent rounded-full mx-auto mb-4" />
              <p className="text-sm text-[var(--zn-muted-foreground)]">Checking availability…</p>
            </div>
          ) : (
            <div className="grid grid-cols-4 @sm:grid-cols-6 @2xl:grid-cols-8 gap-2">
              {timeSlots.map((slot) => (
                <button
                  key={slot.time24}
                  onClick={() => slot.isAvailable && handleTimeSelect(slot.time24)}
                  disabled={!slot.isAvailable}
                  className={`aspect-[5/4] flex flex-col items-center justify-center py-2 px-1 rounded-[var(--zn-radius-md)] transition-colors ${
                    !slot.isAvailable
                      ? 'opacity-50 cursor-not-allowed bg-[var(--zn-background)] text-[var(--zn-muted-foreground)]'
                      : selectedDateTime.time === slot.time24
                        ? 'bg-[var(--zn-primary)] text-[var(--zn-primary-foreground)]'
                        : 'hover:bg-[var(--zn-background)] text-[var(--zn-muted-foreground)] hover:text-[var(--zn-foreground)] border border-[var(--zn-border)]'
                  }`}
                >
                  <span className="text-xs">{slot.time12}</span>
                  {slot.isPast && <span className="text-[10px] text-[var(--zn-muted-foreground)]">Past</span>}
                </button>
              ))}
            </div>
          )}

          {!loadingSlots && timeSlots.filter((s) => s.isAvailable).length === 0 && (
            <div className="text-center py-8">
              <Icon name="CalendarX" size={48} className="text-error/60 mx-auto mb-4" />
              <p className="text-[var(--zn-foreground)] font-medium">
                No shared time works for everyone on this date.
              </p>
              <p className="text-sm text-[var(--zn-muted-foreground)] mt-2">Try a different date.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default GroupTimeStep;
