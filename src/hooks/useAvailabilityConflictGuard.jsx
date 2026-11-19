import React, { useCallback, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import AvailabilityConflictModal from '../components/ui/AvailabilityConflictModal';
import { fetchAffectedBookings } from '../services/api';
import { toConflictList } from '../services/availabilityConflicts';

// The one "falls outside" check (ZNLY-100, V29c2). Usage at a save point:
//   const { confirmConflicts, conflictModal } = useAvailabilityConflictGuard();
//   if (!(await confirmConflicts({ therapistId, change /* or changes: [...] */, title, summary }))) return;   // ...then save
//   ...render {conflictModal}
// No rows (or the check itself failing) resolves true straight away; rows open the list and resolve on Save anyway / Cancel.
export function useAvailabilityConflictGuard() {
  const { orgSlug } = useParams();
  const [pending, setPending] = useState(null);
  const resolver = useRef(null);

  // One person: { therapistId, change | changes }. Several people (Attendance "Save all"): { checks: [{ therapistId, name, change }] }.
  const confirmConflicts = useCallback(async ({ therapistId, change, changes, checks, title, titleFor, summary, saveLabel }) => {
    const list = checks || (changes || (change ? [change] : [])).map((c) => ({ therapistId, change: c }));
    if (list.length === 0 || list.some((c) => !c.therapistId)) return true;
    const results = await Promise.all(list.map((c) => fetchAffectedBookings({ therapistId: c.therapistId, change: c.change })
      .then((r) => r.data.map((row) => ({ ...row, therapist_id: c.therapistId, who: c.name })))));
    const seen = new Set();
    const rows = results.flat().filter((r) => { const k = `${r.booking_id}:${r.therapist_id}`; return seen.has(k) ? false : seen.add(k); });
    rows.sort((a, b) => `${a.booking_date}${a.start_time}`.localeCompare(`${b.booking_date}${b.start_time}`));
    const conflicts = toConflictList(rows);
    if (conflicts.length === 0) return true;
    return new Promise((resolve) => {
      resolver.current = resolve;
      setPending({
        therapistId: list.length === 1 || list.every((c) => c.therapistId === list[0].therapistId) ? list[0].therapistId : null,
        conflicts,
        saveLabel,
        title: title || titleFor?.(conflicts.length) || `${conflicts.length} upcoming booking${conflicts.length === 1 ? '' : 's'} fall${conflicts.length === 1 ? 's' : ''} outside this change`,
        summary,
      });
    });
  }, []);

  const settle = (ok) => {
    setPending(null);
    const r = resolver.current;
    resolver.current = null;
    if (r) r(ok);
  };

  // New tab, so an unsaved form behind the dialog is not lost.
  const openInCalendar = (c) => {
    const qs = new URLSearchParams({ view: 'calendar', date: c.date, ...(c.therapistId || pending?.therapistId ? { therapist: c.therapistId || pending.therapistId } : {}) });
    window.open(`/${orgSlug}/dashboard?${qs.toString()}`, '_blank', 'noopener');
  };

  const conflictModal = pending ? (
    <AvailabilityConflictModal
      title={pending.title}
      summary={pending.summary}
      conflicts={pending.conflicts}
      saveLabel={pending.saveLabel}
      onBack={() => settle(false)}
      onSaveAnyway={() => settle(true)}
      onOpenInCalendar={openInCalendar}
    />
  ) : null;

  return { confirmConflicts, conflictModal };
}

export default useAvailabilityConflictGuard;
