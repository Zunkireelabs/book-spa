// ZNLY-402 / ZNLY-423: the ONE place that picks old vs visit behaviour from the org setting multi_service_bookings (OrgContext.multiServiceBookings).
// false = the original rules (booking group, else customer name + date; sameClient.js); true = the visit rules (visit_id; sameVisit.js).
import { fetchRelatedUnpaidBookings, fetchGroupBookings, fetchVisitRelatedUnpaidBookings, fetchVisitSiblings } from '../services/api';

/** { related(booking), siblings(booking) } for the Payment / Discount tabs. `booking` is a transformed booking. */
export const relatedFetchers = (multi) => (multi
  ? {
    related: (b) => fetchVisitRelatedUnpaidBookings({ excludeBookingId: b.bookingId, visitId: b.visitId, customerId: b.customerId }),
    siblings: (b) => fetchVisitSiblings({ visitId: b.visitId, excludeBookingId: b.bookingId, customerId: b.customerId }),
  }
  : {
    related: (b) => fetchRelatedUnpaidBookings({ customerName: b.customerName, date: b.date, excludeBookingId: b.bookingId, bookingGroupId: b.bookingGroupId, customerId: b.customerId }),
    siblings: (b) => fetchGroupBookings({ bookingGroupId: b.bookingGroupId, customerName: b.customerName, date: b.date, excludeBookingId: b.bookingId }),
  });
