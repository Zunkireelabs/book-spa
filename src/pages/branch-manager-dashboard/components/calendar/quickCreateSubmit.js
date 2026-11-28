import { visitUpdate } from '../../../../services/visitApi';
import { createBooking, createBookingGroup, createComboBookingItems, joinVisitOfBooking } from '../../../../services/api';
import { friendlyError } from '../../../../utils/friendlyError';
import { wordBranch } from '../../../../utils/industryTerms';

/** The row a refusal is about: first row the server marks block / warn, else any row with a reason that is not a plain change / keep. */
export const refusedRow = (rows) => {
  const rs = (rows || []).filter((r) => r.booking_id && r.reason);
  return rs.find((r) => r.verdict === 'block') || rs.find((r) => r.verdict === 'warn') || rs.find((r) => r.verdict !== 'change' && r.verdict !== 'keep') || null;
};

// Create the booking(s) from the QuickCreatePanel form. Shared by the Calendar and the Dashboard so both host the panel identically.
// Resolves { error } (a message: the panel stays open) or { toast: { msg, type? } } (done: the caller closes the panel and refreshes).
export async function submitQuickCreate({ formData, branchId, guard, joinVisitOfBookingId = null }) {
  if (!branchId) return { error: `Missing ${wordBranch()} info.` };
  const date = formData.bookingDate;
  const startTime = formData.bookingTime;
  if (!date || !startTime) return { error: 'Date and time are required.' };

  // ZNLY-402 piece 5: Edit booking = ONE all-or-nothing visit_update (nothing is half-saved). A refusal names the service row it is about.
  if (formData.edit) {
    const { visitKey, changes, order } = formData.edit;
    const res = await guard(async (overrideReason) => {
      const x = await visitUpdate({ visitKey, changes, overrideReason });
      // Only 'warn' rows (a manager may book anyway with a reason) make the refusal overridable; any 'block' row is final.
      const rs = x.error?.rows || [];
      if (x.error && rs.some((r) => r.verdict === 'warn') && !rs.some((r) => r.verdict === 'block')) x.error.overridable = true;
      return x;
    });
    if (res.error) {
      // The refused service: the row the server names (booking_id + reason). Its reason is shown on THAT card (index 0 = the first service).
      const bad = refusedRow(res.error.rows);
      const idx = bad ? order.indexOf(bad.booking_id) : -1;
      return { error: bad?.reason || friendlyError(res.error, 'Nothing was saved. Try again.'), code: res.error.code, raw: res.error, row: idx >= 0 ? idx : undefined };
    }
    return { toast: { msg: 'Booking updated' }, bookingId: order[0] };
  }

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
    const joined = await joinVisitOfBooking({ sourceBookingId: joinVisitOfBookingId, branchId, date });
    if (joined.error) return { error: friendlyError(joined.error, 'Could not add this service to the booking.'), code: joined.error.code, raw: joined.error };
    visitId = joined.data || null;
  }

  // ZNLY-402: several services for one person (org setting ON): one Save makes every row with ONE visit_id. createBookingGroup does the work and, when a
  // later row is refused, cancels the rows already made (staffRollback), so nothing is left half-made; the refused row's number comes back as `row`.
  if (formData.multiServices?.length > 1) {
    // A manager / admin can book anyway with a reason (same prompt, same record as a single booking). It is asked ONCE, before anything is created:
    // the first attempt reports the overridable problem without creating, the guard asks for the reason, and the second attempt applies it only to the rows that need it.
    const needing = formData.multiServices.findIndex((s) => s.overrideNeeded);
    const multi = await guard((overrideReason) => (needing >= 0 && !overrideReason
      ? Promise.resolve({ data: null, error: { overridable: true, code: 'OVERRIDE_NEEDED', message: `Service ${needing + 1 + (formData.serviceNumberOffset || 0)}: ${formData.multiServices[needing].overrideNote || 'outside the usual availability'}` } })
      : createBookingGroup({
      branchId,
      date,
      startTime,
      staffRollback: true,
      visitId: visitId || undefined,
      customerName: formData.customerName,
      customerPhone: formData.customerPhone,
      customerEmail: formData.customerEmail,
      customerGender: formData.customerGender,
      specialRequests: formData.specialRequests,
      roomId: formData.roomId || undefined,
      referringCustomerId: formData.referringCustomerId,
      referringRewardType: formData.referringRewardType,
      referringRewardAmount: formData.referringRewardAmount,
      knownCustomerId: formData.knownCustomerId || undefined,
      isWalkIn: formData.isWalkIn || undefined,
      walkInLabel: formData.walkInLabel || undefined,
      services: formData.multiServices.map((s) => (s.overrideNeeded ? { ...s, overrideReason } : s)),
    })));
    if (multi.error) return { error: friendlyError(multi.error, 'Failed to create booking.'), code: multi.error.code, raw: multi.error, row: multi.error.failedRow, partial: multi.error.partial };
    const first = multi.data?.bookings?.[0];
    return { toast: { msg: `Booking created: ${multi.data.bookings.length} services` }, bookingId: first?.id, bookingNumber: first?.booking_number, visitId };
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
  return { toast: { msg: 'Booking created successfully' }, bookingId: result.data?.id, bookingNumber: result.data?.booking_number, visitId };
}
