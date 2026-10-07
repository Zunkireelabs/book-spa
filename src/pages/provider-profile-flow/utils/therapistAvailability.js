// Pure per-therapist occupancy model backing the provider-profile booking drawer's
// "Select professional" + per-person time-slot filtering. Mirrors
// customer-booking-flow/utils/availability.js's buildOccupancy() 30-min-grid,
// align-down rule exactly, so the two models agree on what "overlaps" means —
// this one is keyed by therapist_id (and a NULL-therapist "unassigned" bucket)
// instead of room_id/gender.

const SLOT_MINUTES = 30;

function timeToMinutes(t) {
  const [h, m] = String(t).slice(0, 5).split(':').map(Number);
  return h * 60 + m;
}

// rows: public_check_therapist_bookings_range shape —
// { therapist_id, busy_date, start_time, duration_minutes, source }
// therapist_id === null rows are unassigned online bookings; they count toward
// anyProfessionalFree's unassigned headcount, never against a specific therapist.
export function buildTherapistOccupancy(rows) {
  const byTherapist = {}; // date -> therapistId -> Map(slotMin -> count)
  const unassigned = {}; // date -> Map(slotMin -> count)

  for (const row of rows || []) {
    const date = row.busy_date;
    const startMin = timeToMinutes(row.start_time || '00:00');
    const duration = row.duration_minutes || 60;
    const endMin = startMin + duration;
    const gridStart = Math.floor(startMin / SLOT_MINUTES) * SLOT_MINUTES;

    for (let slotMin = gridStart; slotMin < endMin; slotMin += SLOT_MINUTES) {
      if (row.therapist_id) {
        byTherapist[date] = byTherapist[date] || {};
        byTherapist[date][row.therapist_id] = byTherapist[date][row.therapist_id] || new Map();
        const map = byTherapist[date][row.therapist_id];
        map.set(slotMin, (map.get(slotMin) || 0) + 1);
      } else {
        unassigned[date] = unassigned[date] || new Map();
        unassigned[date].set(slotMin, (unassigned[date].get(slotMin) || 0) + 1);
      }
    }
  }

  return { byTherapist, unassigned };
}

function spanSlots(startMin, durationMinutes) {
  const endMin = startMin + durationMinutes;
  const gridStart = Math.floor(startMin / SLOT_MINUTES) * SLOT_MINUTES;
  const slots = [];
  for (let slotMin = gridStart; slotMin < endMin; slotMin += SLOT_MINUTES) slots.push(slotMin);
  return slots;
}

// Is this one therapist free for the service's entire span starting at startMin?
export function isTherapistFree(occupancy, therapistId, date, startMin, durationMinutes) {
  const perSlot = occupancy.byTherapist[date]?.[therapistId];
  if (!perSlot) return true;
  return spanSlots(startMin, durationMinutes).every((slotMin) => !(perSlot.get(slotMin) > 0));
}

// "Any professional" is only honest if, at every 30-min slot the service would
// occupy, more eligible therapists are free than there are unassigned (pending,
// not-yet-assigned) online bookings already claiming a slot — otherwise accepting
// this booking could leave more unassigned bookings than staff to cover them.
export function anyProfessionalFree(occupancy, eligibleTherapistIds, date, startMin, durationMinutes) {
  if (!eligibleTherapistIds || eligibleTherapistIds.length === 0) return false;

  return spanSlots(startMin, durationMinutes).every((slotMin) => {
    const freeCount = eligibleTherapistIds.filter(
      (id) => !(occupancy.byTherapist[date]?.[id]?.get(slotMin) > 0)
    ).length;
    const unassignedCount = occupancy.unassigned[date]?.get(slotMin) || 0;
    return freeCount > unassignedCount;
  });
}
