import React, { useEffect, useState } from 'react';
import InboxBookingPanel from '../inbox/InboxBookingPanel';
import QuickCreatePanel from '../branch-manager-dashboard/components/calendar/QuickCreatePanel';
import { submitQuickCreate } from '../branch-manager-dashboard/components/calendar/quickCreateSubmit';
import PaymentModal from '../../components/ui/PaymentModal';
import { submitCheckout } from '../../services/checkoutSubmit';
import { useAvailabilityGuard } from '../../contexts/AvailabilityOverrideContext';
import { fetchAttendance, fetchServices, getCalendarBookings, recordPayment, recordTip } from '../../services/api';

// Hosts for the panels the Calendar already owns, so the dashboard can open them in place (it stays put behind the panel).

/** The Calendar's New-booking panel on a given day, prefilled from `slot` ({ day, hour, minute, colType, colId }). */
export const CreateBookingHost = ({ slot, branchId, onClose, onCreated }) => {
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
      onSubmit={async (formData) => {
        const r = await submitQuickCreate({ formData, branchId, guard });
        if (r.error) return r.error;
        onCreated?.(r.toast);
        return null;
      }}
    />
  );
};

/** The V17 centred checkout for one booking. `booking` is a bookings row (id, booking_number, final_amount, amount_paid, service_name_snapshot). */
export const CollectHost = ({ booking, branchId, onClose, onPaid }) => {
  const [submitting, setSubmitting] = useState(false);
  if (!booking) return null;

  // ZNLY-233: every checkout goes through the one shared submit, so products on the bill are saved (never dropped); no products => the treatment-only path below.
  const confirm = (payload) => submitCheckout({ bookingId: booking.id, payload, treatment: recordTreatmentOnly, onSaved: () => onPaid?.() });
  const recordTreatmentOnly = async ({ tenders, dueHolderName, notes, tipSplits }) => {
    setSubmitting(true);
    const result = await recordPayment({ bookingId: booking.id, tenders, dueHolderName, notes });
    if (result.error) { setSubmitting(false); return { error: result.error }; }
    for (const split of (tipSplits || [])) {
      const tip = await recordTip({ bookingId: booking.id, amount: split.amount, receivedBy: split.receivedBy });
      if (tip.error) console.warn('[Tips] recordTip failed:', tip.error.message);
    }
    setSubmitting(false);
    onPaid?.();
    return { error: null };
  };

  return (
    <PaymentModal
      booking={{
        bookingId: booking.id, booking_number: booking.booking_number, branchId: booking.branch_id || branchId,
        finalAmount: Number(booking.final_amount) || 0, amountPaid: Number(booking.amount_paid) || 0, service: booking.service_name_snapshot, dueHolderName: '',
      }}
      additionalBookings={[]}
      onConfirm={confirm}
          savesProducts
      onClose={(res) => { if (!submitting) onClose(res); }}
      isSubmitting={submitting}
    />
  );
};

/** Renders whichever dashboard panel is open: { type: 'booking', id } | { type: 'create', slot } | { type: 'collect', booking }. */
export const DashPanels = ({ panel, branchId, onClose, onChanged }) => {
  if (!panel) return null;
  if (panel.type === 'booking') return <InboxBookingPanel bookingId={panel.id} onClose={onClose} onChanged={onChanged} />;
  if (panel.type === 'create') return <CreateBookingHost slot={panel.slot} branchId={branchId} onClose={onClose} onCreated={() => { onClose(); onChanged?.(); }} />;
  if (panel.type === 'collect') return <CollectHost booking={panel.booking} branchId={branchId} onClose={onClose} onPaid={onChanged} />;
  return null;
};
