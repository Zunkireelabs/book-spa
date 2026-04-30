// Convert "HH:MM" or "HH:MM:SS" to 12h format
export function to12h(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const period = h >= 12 ? 'pm' : 'am';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function formatNPR(amount) {
  return `NPR ${Number(amount).toLocaleString('en-IN')}`;
}

// Map lowercase UI statuses back to Title-Case DB values for API calls
const STATUS_TO_DB = {
  'pending': 'Pending',
  'confirmed': 'Confirmed',
  'in-progress': 'In-Progress',
  'completed': 'Completed',
  'cancelled': 'Cancelled',
  'no show': 'No Show',
  'no-show': 'No Show',
};

export function toDbStatus(uiStatus) {
  return STATUS_TO_DB[uiStatus] || uiStatus;
}

export function transformBooking(dbBooking) {
  const therapist = dbBooking.therapist
    ? {
        id: dbBooking.therapist.id,
        name: dbBooking.therapist.name,
        gender: dbBooking.therapist.gender,
        room: dbBooking.room?.name || null,
      }
    : null;

  return {
    id: dbBooking.booking_number,
    bookingId: dbBooking.id,
    customerName: dbBooking.customer_name,
    customerEmail: dbBooking.customer_email || null,
    customerPhone: dbBooking.customer_phone || null,
    service: dbBooking.service?.name || 'Unknown Service',
    duration: dbBooking.service
      ? `${dbBooking.service.duration_minutes} min`
      : '',
    time: dbBooking.start_time ? dbBooking.start_time.slice(0, 5) : '',
    date: dbBooking.date,
    status: dbBooking.status ? dbBooking.status.toLowerCase() : 'pending',
    paymentStatus: dbBooking.payment_status || 'unpaid',
    baseAmount: Number(dbBooking.base_amount || 0),
    discountAmount: Number(dbBooking.discount_amount || 0),
    finalAmount: Number(dbBooking.final_amount || dbBooking.base_amount || 0),
    therapist,
    serviceId: dbBooking.service_id || null,
    roomId: dbBooking.room_id || null,
    roomName: dbBooking.room?.name || null,
    startTime: dbBooking.start_time || null,
    specialRequests: dbBooking.special_requests || null,
    price: formatNPR(dbBooking.final_amount || dbBooking.base_amount || 0),
    isLocked: dbBooking.is_locked || false,
  };
}

export function transformBookings(dbBookings) {
  return dbBookings.map(transformBooking);
}
