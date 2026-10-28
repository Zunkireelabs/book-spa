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

function spanSlots(startMin, durationMinutes) {
  const slots = [];
  for (let offset = 0; offset < durationMinutes; offset += 30) slots.push(startMin + offset);
  return slots;
}

// Attempts to reserve every person for this candidate slot, in order, against
// the real occupancy plus whatever earlier people in this same slot already
// claimed. Returns true only if every person could be placed. Three resources
// are tracked incrementally as people are claimed (not just checked and
// discarded): the therapist each person is assigned, the branch's online-
// capacity counter (seeded from EXISTING online bookings, not just this
// group's own members), and room usage per room per 30-min slot (seeded from
// existing bookings the same way).
function allPeopleFitSlot({ people, allTherapists, therapistOccupancy, byRoom, byBranch, rooms, enableRooms, onlineCapacity, date, startMin }) {
  const claimedTherapistIds = new Set();
  const roomUsage = new Map(); // `${roomId}:${slotMin}` -> extra claimed count
  let onlineClaimedCount = 0;

  for (const person of people) {
    const duration = person.service?.duration_minutes || 60;
    const spans = spanSlots(startMin, duration);
    let therapistId = null;

    if (person.professional?.mode === 'specific') {
      const candidateId = person.professional.therapist?.id;
      if (!candidateId || claimedTherapistIds.has(candidateId)) return false;
      if (!isTherapistFree(therapistOccupancy, candidateId, date, startMin, duration)) return false;
      therapistId = candidateId;
    } else {
      // 'any' — same reserve anyProfessionalFree (solo flow) enforces: don't let
      // more unassigned-pending bookings exist than there are free therapists
      // left to eventually cover them. Reserve the max backlog seen across this
      // person's span, then pick the first free-and-unclaimed therapist beyond it.
      const reserveCount = Math.max(0, ...spans.map((m) => therapistOccupancy.unassigned[date]?.get(m) || 0), 0);
      const freeCandidates = allTherapists
        .map((t) => t.id)
        .filter((id) => !claimedTherapistIds.has(id) && isTherapistFree(therapistOccupancy, id, date, startMin, duration));
      if (freeCandidates.length <= reserveCount) return false;
      therapistId = freeCandidates[0];
    }

    claimedTherapistIds.add(therapistId);

    if (person.professional?.mode !== 'specific') {
      onlineClaimedCount += 1;
      if (onlineCapacity !== null) {
        const existingMax = Math.max(0, ...spans.map((m) => byBranch[date]?.get(m) || 0));
        if (existingMax + onlineClaimedCount > onlineCapacity) return false;
      }
    }

    if (enableRooms) {
      const room = rooms.find((r) => {
        const capacity = getRoomCapacity(r);
        return spans.every((m) => {
          const existing = byRoom[date]?.[r.id]?.get(m) || 0;
          const claimed = roomUsage.get(`${r.id}:${m}`) || 0;
          return existing + claimed < capacity;
        });
      });
      if (!room) return false;
      spans.forEach((m) => {
        const key = `${room.id}:${m}`;
        roomUsage.set(key, (roomUsage.get(key) || 0) + 1);
      });
    }
  }

  return true;
}

export function computeGroupSlots({ dates, availabilityWindow, therapistWindow, closedRanges, enableRooms, onlineCapacity, people, allTherapists }) {
  const rooms = availabilityWindow?.rooms || [];
  const { byRoom, byBranch } = buildOccupancy(availabilityWindow?.bookings || []);
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
        byBranch,
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
