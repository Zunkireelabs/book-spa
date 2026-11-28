import React from 'react';
import Icon from '../../../../components/AppIcon';

// ZNLY-281 / ZNLY-402 / ZNLY-435: "Also booked today · 2 other bookings · 2:00pm – 5:45pm" = the client's OTHER bookings that day (a visit counts once, cancelled never; same number from every side; every org) (light green band with a calendar icon). `info` is visitDayInfo(); `range` comes from formatClockRange(first, last).
// Never carries a name, so it is safe for logins whose client details are hidden.
const ClientDayLine = ({ info, range, className = '' }) => {
  return (info ? (
  <div className={`flex items-center gap-2 px-2.5 py-2 rounded-lg bg-primary/[0.07] text-[13px] font-medium text-[#1f3f1b] ${className}`} data-client-day-line>
    <Icon name="CalendarDays" size={16} className="text-primary flex-shrink-0" />
    <span>{`Also booked today · ${info.count} other booking${info.count === 1 ? '' : 's'}`}{range ? ` · ${range}` : ''}</span>
  </div>
) : null);
};

export default ClientDayLine;
