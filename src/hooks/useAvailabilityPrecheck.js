import { useEffect, useMemo, useState } from 'react';
import { fetchAvailabilityDay } from '../services/api';
import { evaluateAvailability, nextFreeStarts, firstOtherFreeTherapist, hhmmToMinutes, minutesToHHMM } from '../services/availability';
import { useOrg } from '../contexts/OrgContext';
import { useIndustry } from './useIndustry';
import { useAuth } from '../contexts/AuthContext';

// Live "can this therapist take this slot?" while a booking form is filled in (ZNLY-100, panel B). No write: it
// reads the rule's own shift data (therapist_shifts_for_range) plus the day's bookings and shows the guard's verdict
// before Save. The database still enforces the rule on the write itself.
// excludeBookingId: the booking being edited (so it doesn't overlap itself).
export function useAvailabilityPrecheck({ branchId, date, therapistId, startTime, durationMin, excludeBookingId = null, enabled = true }) {
  const { enforceStaffAvailability } = useOrg();
  const { staffLabel } = useIndustry();
  const { profile } = useAuth();
  const canOverride = profile?.role === 'manager' || profile?.role === 'admin';
  const active = Boolean(enabled && enforceStaffAvailability && branchId && date && therapistId && therapistId !== 'unassigned');

  const [day, setDay] = useState(null);   // { key, therapists }
  const key = `${branchId}|${date}`;

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    fetchAvailabilityDay({ branchId, date }).then(({ data }) => {
      if (!cancelled && data) setDay({ key, therapists: data.therapists });
    });
    return () => { cancelled = true; };
  }, [active, branchId, date, key]);

  return useMemo(() => {
    const none = { active, loading: active && day?.key !== key, verdict: null, nextFree: [], otherFree: null, blocked: false, warn: false, canOverride };
    if (!active || day?.key !== key) return none;
    const startMin = hhmmToMinutes(startTime);
    if (startMin === null || !durationMin) return none;
    const endMin = startMin + durationMin;
    const forTherapist = (t) => ({
      ...t, bookings: (t.bookings || []).filter((b) => !excludeBookingId || b.id !== excludeBookingId),
    });
    const candidates = day.therapists.map(forTherapist);
    const me = candidates.find((t) => t.id === therapistId);
    if (!me) return none;
    const verdict = evaluateAvailability({ shiftDay: me.shiftDay, bookings: me.bookings, startMin, endMin, therapistName: me.name, staffLabel: staffLabel?.toLowerCase() });
    if (!verdict) return none;
    const other = firstOtherFreeTherapist({ candidates, excludeId: therapistId, startMin, endMin });
    return {
      ...none,
      loading: false,
      verdict,
      nextFree: nextFreeStarts({ shiftDay: me.shiftDay, bookings: me.bookings, durationMin, fromMin: startMin }),
      otherFree: other ? { id: other.id, name: other.name, time: minutesToHHMM(startMin) } : null,
      blocked: !(verdict.overridable && canOverride),
      warn: verdict.overridable && canOverride,
    };
  }, [active, day, key, startTime, durationMin, therapistId, excludeBookingId, staffLabel, canOverride]);
}

export default useAvailabilityPrecheck;
