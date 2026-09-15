// The primary therapist (junction row index 0) always uses the booking's own room_id —
// a room override only ever applies to a companion. This must be enforced here,
// unconditionally, rather than left to whatever the caller's override map happens to
// contain: BookingActionModal only ever builds an override entry for non-primary
// therapists, so if a former companion gets promoted to index 0 (the old primary was
// removed), their stale override would otherwise silently carry over with no UI to
// see or clear it.
export function resolveJunctionRoomId({ index, therapistId, overridesMap, existingRoomId }) {
  if (index === 0) return null;
  if (overridesMap && Object.prototype.hasOwnProperty.call(overridesMap, therapistId)) {
    return overridesMap[therapistId] || null;
  }
  return existingRoomId || null;
}
