// ZNLY-365: "+ Service" and Rebook open the New booking panel pre-filled and locked to the booking's client.
// buildAddServiceSlot() returns the slotInfo the panel reads (lockedClient, defaults, title). Pure, so it is table-tested.

const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const IDLE = new Set(['Cancelled', 'No Show']);

// The booking's client, locked: a walk-in stays a walk-in (no phone, no profile), a known client is used by record.
// An old booking with neither a customer record nor a phone cannot be locked: the panel then asks for the missing details.
export function lockedClientOf(booking) {
  // Same rule as isClientlessWalkIn: a walk-in that later got a client linked is that client, by record (never a clientless walk-in).
  // A walk-in booking's customer_name is "Walk-in · Sahil", not the client's: leave it empty so the panel shows the client record's own name.
  if (booking.customerId) return { kind: 'existing', customerId: booking.customerId, name: booking.isWalkIn ? '' : (booking.customerName || ''), bookingNumber: booking.id || '' };
  if (booking.isWalkIn) return { kind: 'walkin', walkInLabel: booking.walkInLabel || '', bookingNumber: booking.id || '' };
  return null;
}

// The same people as this booking, if they are free at `atMin` (nobody else of theirs is in a booking covering that minute).
// One service = one person, so only the first person is preset (`max` > 1 only for a couple service).
export function sameStaffIfFree(booking, rawBookings, atMin, max = 1) {
  const ids = (booking.therapists || []).map((t) => t.id).filter(Boolean).slice(0, max);
  if (!ids.length || atMin == null) return [];
  const busy = new Set();
  for (const b of rawBookings || []) {
    if (b.id === booking.bookingId || b.date !== booking.date || IDLE.has(b.status)) continue;
    const s = toMin(b.start_time); const e = toMin(b.end_time);
    if (s == null || e == null || !(s <= atMin && atMin < e)) continue;
    if (b.booking_therapists?.length) b.booking_therapists.forEach((bt) => busy.add(bt.therapist_id));
    else if (b.therapist_id) busy.add(b.therapist_id);
  }
  return ids.every((id) => !busy.has(id)) ? ids : [];
}

export function buildAddServiceSlot({ booking, mode = 'add-service', rawBookings = [] }) {
  const lockedClient = lockedClientOf(booking);
  const endMin = toMin(booking.endTime) ?? toMin(booking.startTime) ?? toMin(booking.time);
  const slot = {
    day: booking.date,
    title: mode === 'rebook' ? 'Rebook' : 'Add a service',
    lockedClient,
    openServiceFirst: mode === 'add-service',
    sourceBookingId: booking.bookingId,
  };
  if (mode === 'add-service' && endMin != null) {
    slot.hour = Math.floor(endMin / 60);
    slot.minute = endMin % 60;
    slot.defaultTherapistIds = sameStaffIfFree(booking, rawBookings, endMin);
  }
  if (mode === 'rebook') {
    slot.defaultServiceId = booking.serviceId || '';
    // Rebook starts from the original booking's own start time (the day is the booking's day until the user picks another).
    const startMin = toMin(booking.startTime) ?? toMin(booking.time);
    if (startMin != null) {
      slot.hour = Math.floor(startMin / 60);
      slot.minute = startMin % 60;
      slot.defaultTherapistIds = sameStaffIfFree(booking, rawBookings, startMin);
    }
  }
  if (!lockedClient) {
    // Old booking with no client record: carry the name and phone it has; the panel asks for whatever is missing.
    const m = /^(\+\d{1,3})(\d+)$/.exec(booking.customerPhone || '');
    slot.defaultCustomerName = booking.customerName || '';
    slot.defaultCustomerPhone = m ? m[2] : (booking.customerPhone || '');
    slot.defaultCustomerCountryCode = m ? m[1] : '+977';
  } else if (lockedClient.kind === 'existing') {
    slot.defaultCustomerId = booking.customerId;
    slot.defaultCustomerName = lockedClient.name;
  }
  return slot;
}
