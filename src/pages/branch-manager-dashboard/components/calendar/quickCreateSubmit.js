import { createBooking, createComboBookingItems, joinVisitOfBooking } from '../../../../services/api';
import { friendlyError } from '../../../../utils/friendlyError';
import { wordBranch } from '../../../../utils/industryTerms';

// Create the booking(s) from the QuickCreatePanel form. Shared by the Calendar and the Dashboard so both host the panel identically.
// Resolves { error } (a message: the panel stays open) or { toast: { msg, type? } } (done: the caller closes the panel and refreshes).
export async function submitQuickCreate({ formData, branchId, guard, joinVisitOfBookingId = null }) {
  if (!branchId) return { error: `Missing ${wordBranch()} info.` };
  const date = formData.bookingDate;
  const startTime = formData.bookingTime;
  if (!date || !startTime) return { error: 'Date and time are required.' };

  // Group booking: one booking per person, all sharing one booking_group_id.
  // Created sequentially so each room-capacity check sees prior group members
  // (matters for a Couple sharing one room, and Separate rooms running low).
  if (formData.mode === 'group') {
    const people = formData.people || [];
    if (people.length === 0) return { error: 'Add at least one person.' };
    const groupId = crypto.randomUUID();
    let created = 0;
    for (let i = 0; i < people.length; i++) {
      const person = people[i];
      const result = await guard((overrideReason) => createBooking({
        branchId,
        serviceId: person.serviceId,
        date,
        startTime,
        customerName: person.customerName,
        customerPhone: person.customerPhone,
        customerEmail: person.customerEmail,
        customerGender: person.customerGender,
        knownCustomerId: person.knownCustomerId || undefined, // ZNLY-303: a guest picked from customer search links to that customer
        isWalkIn: person.isWalkIn || undefined, // ZNLY-327
        walkInLabel: person.walkInLabel || undefined,
        specialRequests: formData.specialRequests,
        therapistIds: person.therapistIds,
        roomId: person.roomId || undefined,
        bookingGroupId: groupId,
        overrideReason,
      }));
      if (result.error) {
        const who = person.customerName || `person ${i + 1}`;
        const tail = created > 0 ? ` (${created} booking${created > 1 ? 's' : ''} already created)` : '';
        return { error: `Failed for ${who}: ${friendlyError(result.error, 'could not create booking.')}${tail}`, code: result.error.code, raw: result.error, partial: created > 0 ? { created, total: people.length } : undefined };
      }
      created++;
    }
    return { toast: { msg: `${created} bookings created for ${people[0]?.customerName || 'the group'}` } };
  }

  // ZNLY-402: "+ Service" joins the source booking's visit (ON orgs; the source is stamped first when it has none). OFF org / no source: visitId stays null.
  let visitId = null;
  if (joinVisitOfBookingId) {
    const joined = await joinVisitOfBooking({ sourceBookingId: joinVisitOfBookingId, branchId });
    if (joined.error) return { error: friendlyError(joined.error, 'Could not add this service to the booking.'), code: joined.error.code, raw: joined.error };
    visitId = joined.data || null;
  }

  const result = await guard((overrideReason) => createBooking({
    branchId,
    visitId: visitId || undefined,
    serviceId: formData.serviceId,
    date,
    startTime,
    customerName: formData.customerName,
    customerPhone: formData.customerPhone,
    customerEmail: formData.customerEmail,
    customerGender: formData.customerGender,
    specialRequests: formData.specialRequests,
    therapistIds: formData.therapistIds || (formData.therapistId ? [formData.therapistId] : null),
    // Zennly: bookings.room_id is NOT NULL, so "Any available" must let createBooking auto-assign a room ('none' would insert NULL).
    roomId: formData.roomId || undefined,
    therapistRoomOverrides: formData.therapistRoomOverrides,
    companionName: formData.companionName,
    companionPhone: formData.companionPhone,
    referringCustomerId: formData.referringCustomerId,
    referringRewardType: formData.referringRewardType,
    referringRewardAmount: formData.referringRewardAmount,
    knownCustomerId: formData.knownCustomerId || undefined,
    isWalkIn: formData.isWalkIn || undefined, // ZNLY-327: no customer profile
    walkInLabel: formData.walkInLabel || undefined,
    overrideReason,
  }));
  if (result.error) return { error: friendlyError(result.error, 'Failed to create booking.'), code: result.error.code, raw: result.error };

  if (formData.comboAssignments?.length > 0 && result.data?.id) {
    const comboResult = await createComboBookingItems({
      bookingId: result.data.id,
      branchId,
      date,
      startTime,
      roomId: formData.roomId && formData.roomId !== 'none' ? formData.roomId : null,
      components: formData.comboAssignments,
      overrideReason: result.overrideReason,
    });
    if (comboResult.error) {
      return { toast: { msg: `Booking created, but combo components failed: ${friendlyError(comboResult.error, 'please check the booking')}`, type: 'error' }, bookingId: result.data?.id };
    }
  }

  if (result.data?._therapistAssignmentWarning) {
    return { toast: { msg: `Booking created, but: ${result.data._therapistAssignmentWarning}`, type: 'error' }, bookingId: result.data?.id, bookingNumber: result.data?.booking_number };
  }
  return { toast: { msg: 'Booking created successfully' }, bookingId: result.data?.id, bookingNumber: result.data?.booking_number };
}
