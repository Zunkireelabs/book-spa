import { createBooking, createComboBookingItems } from '../../../../services/api';
import { wordBranch } from '../../../../utils/industryTerms';

// Create the booking(s) from the QuickCreatePanel form. Shared by the Calendar and the Dashboard so both host the panel identically.
// Resolves { error } (a message: the panel stays open) or { toast: { msg, type? } } (done: the caller closes the panel and refreshes).
export async function submitQuickCreate({ formData, branchId, guard }) {
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
        specialRequests: formData.specialRequests,
        therapistIds: person.therapistIds,
        roomId: person.roomId || undefined,
        bookingGroupId: groupId,
        overrideReason,
      }));
      if (result.error) {
        const who = person.customerName || `person ${i + 1}`;
        const tail = created > 0 ? ` (${created} booking${created > 1 ? 's' : ''} already created)` : '';
        return { error: `Failed for ${who}: ${result.error.message || 'could not create booking.'}${tail}` };
      }
      created++;
    }
    return { toast: { msg: `${created} group bookings created successfully` } };
  }

  const result = await guard((overrideReason) => createBooking({
    branchId,
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
    overrideReason,
  }));
  if (result.error) return { error: result.error.message || 'Failed to create booking.' };

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
      return { toast: { msg: `Booking created, but combo components failed: ${comboResult.error.message || 'unknown error'}`, type: 'error' }, bookingId: result.data?.id };
    }
  }

  if (result.data?._therapistAssignmentWarning) {
    return { toast: { msg: `Booking created, but: ${result.data._therapistAssignmentWarning}`, type: 'error' }, bookingId: result.data?.id };
  }
  return { toast: { msg: 'Booking created successfully' }, bookingId: result.data?.id };
}
