// N-way shared-slot availability for group bookings — composes the existing
// per-therapist / per-room / per-branch occupancy primitives (buildOccupancy,
// buildTherapistOccupancy, isTherapistFree, anyProfessionalFree) that already
// power the solo flow's DateTimeSelection.jsx, to find slots where every
// person in the group can be simultaneously reserved.
//
// A candidate slot is tested by simulating reservation of each person in
// order against a per-slot "claimed" set, seeded from the real occupancy —
// this is what stops two "any professional" guests from both passing against
// the same single available therapist (anyProfessionalFree alone only proves
// "at least one" free, not "enough for everyone who still needs one").

import {
  buildOccupancy,
  getNepalToday,
  getNepalNow,
  isDateInRanges,
  minutesToTime24,
  minutesToTime12,
  START_HOUR,
  END_HOUR,
} from '../../customer-booking-flow/utils/availability';
import { buildTherapistOccupancy, isTherapistFree } from './therapistAvailability';
import { getRoomCapacity } from '../../../services/api';

function personFree(occupancy, therapistId, date, startMin, durationMinutes) {
  return isTherapistFree(occupancy, therapistId, date, startMin, durationMinutes);
}

// Attempts to reserve every person for this candidate slot, in order, against
// the real occupancy plus whatever earlier people in this same slot already
// claimed. Returns true only if every person could be placed.
function allPeopleFitSlot({ people, allTherapists, therapistOccupancy, byRoom, rooms, enableRooms, onlineCapacity, date, startMin }) {
  const claimedTherapistIds = new Set();
  let onlineClaimedCount = 0;

  for (const person of people) {
    const duration = person.service?.duration_minutes || 60;
    let therapistId = null;

    if (person.professional?.mode === 'specific') {
      const candidateId = person.professional.therapist?.id;
      if (!candidateId || claimedTherapistIds.has(candidateId)) return false;
      if (!personFree(therapistOccupancy, candidateId, date, startMin, duration)) return false;
      therapistId = candidateId;
    } else {
      // 'any' — pick the first eligible therapist not already claimed in this slot.
      therapistId = allTherapists
        .map((t) => t.id)
        .find((id) => !claimedTherapistIds.has(id) && personFree(therapistOccupancy, id, date, startMin, duration));
      if (!therapistId) return false;
    }

    claimedTherapistIds.add(therapistId);

    if (person.professional?.mode !== 'specific') {
      onlineClaimedCount += 1;
      if (onlineCapacity !== null && onlineClaimedCount > onlineCapacity) return false;
    }

    if (enableRooms) {
      const roomId = rooms.find((room) => {
        const capacity = getRoomCapacity(room);
        for (let offset = 0; offset < duration; offset += 30) {
          const occupied = byRoom[date]?.[room.id]?.get(startMin + offset) || 0;
          if (occupied >= capacity) return false;
        }
        return true;
      })?.id;
      if (!roomId) return false;
    }
  }

  return true;
}

export function computeGroupSlots({ dates, availabilityWindow, therapistWindow, closedRanges, enableRooms, onlineCapacity, people, allTherapists }) {
  const rooms = availabilityWindow?.rooms || [];
  const { byRoom } = buildOccupancy(availabilityWindow?.bookings || []);
  const therapistOccupancy = buildTherapistOccupancy(therapistWindow?.bookings || []);

  const nepalToday = getNepalToday();
  const nepalNow = getNepalNow();
  const nowMinutes = nepalNow.getHours() * 60 + nepalNow.getMinutes();

  return (dates || []).map((d) => {
    const isToday = d.fullDate === nepalToday;
    const isClosed = isDateInRanges(d.fullDate, closedRanges || []);
    const slots = [];

    const maxDuration = people.reduce((max, p) => Math.max(max, p.service?.duration_minutes || 60), 60);

    for (let start = START_HOUR * 60; start + maxDuration <= END_HOUR * 60; start += 30) {
      const isPast = isToday && start <= nowMinutes;

      const isAvailable = !isPast && !isClosed && allPeopleFitSlot({
        people,
        allTherapists,
        therapistOccupancy,
        byRoom,
        rooms,
        enableRooms,
        onlineCapacity,
        date: d.fullDate,
        startMin: start,
      });

      slots.push({
        time24: minutesToTime24(start),
        time12: minutesToTime12(start),
        isPast,
        isAvailable,
      });
    }

    return { date: d.fullDate, slots, isClosed };
  });
}
