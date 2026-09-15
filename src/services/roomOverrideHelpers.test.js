import { describe, it, expect } from 'vitest';
import { resolveJunctionRoomId } from './roomOverrideHelpers';

describe('resolveJunctionRoomId', () => {
  it('always returns null for the primary (index 0), even with a stale existing override', () => {
    // Regression test for PR #245 finding #2: a former companion promoted to primary
    // (after the old primary was removed) must not carry over their old override room.
    const result = resolveJunctionRoomId({
      index: 0,
      therapistId: 't-2',
      overridesMap: undefined,
      existingRoomId: 'room-b', // stale override from when t-2 was a companion
    });
    expect(result).toBeNull();
  });

  it('uses the override map value for a non-primary therapist', () => {
    const result = resolveJunctionRoomId({
      index: 1,
      therapistId: 't-2',
      overridesMap: { 't-2': 'room-b' },
      existingRoomId: null,
    });
    expect(result).toBe('room-b');
  });

  it('treats an explicit null in the override map as "use the primary room"', () => {
    const result = resolveJunctionRoomId({
      index: 1,
      therapistId: 't-2',
      overridesMap: { 't-2': null },
      existingRoomId: 'room-b', // must NOT fall back to this — the map entry is authoritative
    });
    expect(result).toBeNull();
  });

  it('falls back to the existing room_id when the therapist has no entry in the map at all', () => {
    const result = resolveJunctionRoomId({
      index: 1,
      therapistId: 't-2',
      overridesMap: { 't-3': 'room-c' }, // t-2 not mentioned
      existingRoomId: 'room-b',
    });
    expect(result).toBe('room-b');
  });

  it('returns null when there is no override map and no existing room_id', () => {
    const result = resolveJunctionRoomId({
      index: 1,
      therapistId: 't-2',
      overridesMap: undefined,
      existingRoomId: null,
    });
    expect(result).toBeNull();
  });
});
