import React from 'react';
import Icon from '../../../../components/AppIcon';
import { useOrg } from '../../../../contexts/OrgContext';

// ZNLY-281 / ZNLY-402: "4 bookings today for this client · 2:00–5:45 pm"; with the org setting multi_service_bookings ON: "Also booked today · 2 · 2:00–5:45 pm" = the client's OTHER bookings that day (not this visit) (light green band with a calendar icon). `range` comes from compactRange(first, last).
// Never carries a name, so it is safe for logins whose client details are hidden.
const ClientDayLine = ({ info, range, className = '' }) => {
  const { multiServiceBookings } = useOrg();
  return (info ? (
  <div className={`flex items-center gap-2 px-2.5 py-2 rounded-lg bg-primary/[0.07] text-[13px] font-medium text-[#1f3f1b] ${className}`} data-client-day-line>
    <Icon name="CalendarDays" size={16} className="text-primary flex-shrink-0" />
    <span>{multiServiceBookings ? `Also booked today · ${info.count}` : `${info.count} bookings today for this client`}{range ? ` · ${range}` : ''}</span>
  </div>
) : null);
};

export default ClientDayLine;
