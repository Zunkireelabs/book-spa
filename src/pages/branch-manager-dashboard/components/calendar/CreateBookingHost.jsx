import React, { useEffect, useState } from 'react';
import QuickCreatePanel from './QuickCreatePanel';
import { submitQuickCreate } from './quickCreateSubmit';
import { useAvailabilityGuard } from '../../../../contexts/AvailabilityOverrideContext';
import { fetchAttendance, fetchServices, getCalendarBookings, updateBookingStatus } from '../../../../services/api';

/** The Calendar's New-booking panel on a given day, prefilled from `slot` ({ day, hour, minute, colType, colId }). */
export const CreateBookingHost = ({ slot, branchId, onClose, onBack, onCreated }) => {
  const { guard } = useAvailabilityGuard();
  const [data, setData] = useState(null);
  const [services, setServices] = useState(null);
  const [absent, setAbsent] = useState({});
  const day = slot?.day;

  useEffect(() => {
    if (!slot || !branchId) return undefined;
    let alive = true;
    (async () => {
      const [cal, sv, att] = await Promise.all([getCalendarBookings(branchId, day, day), fetchServices(branchId), fetchAttendance({ branchId, date: day })]);
      if (!alive) return;
      setData(cal.data || { therapists: [], rooms: [], bookings: [] });
      setServices(sv.data || []);
      setAbsent(Object.fromEntries((att.data || []).filter((a) => a.status === 'Absent').map((a) => [a.therapistId, true])));
    })();
    return () => { alive = false; };
  }, [slot, branchId, day]);

  if (!slot) return null;
  const therapists = data?.therapists || [];
  return (
    <QuickCreatePanel
      slotInfo={slot}
      services={services}
      servicesLoading={!services}
      therapists={therapists.filter((t) => t.is_service_staff !== false && !absent[t.id])}
      allTherapists={therapists}
      rooms={data?.rooms || []}
      bookings={data?.bookings || []}
      branchId={branchId}
      branchHours={data?.branchHours}
      onClose={onClose}
      onBack={onBack}
      onSubmit={async (formData) => {
        const r = await submitQuickCreate({ formData, branchId, guard, joinVisitOfBookingId: slot?.joinVisitOfBookingId || null });
        if (r.error) return { message: r.error, code: r.code, raw: r.raw, partial: r.partial, row: r.row };
        // A walk-in is already at the desk, so it starts Confirmed (never "late"); a failed confirm leaves a normal Pending booking.
        if (slot?.walkIn && r.bookingId) await updateBookingStatus({ bookingId: r.bookingId, newStatus: 'Confirmed' });
        onCreated?.(r.toast, { bookingId: r.bookingId, bookingNumber: r.bookingNumber, bookingDate: formData.bookingDate });
        return null;
      }}
    />
  );
};

export default CreateBookingHost;
