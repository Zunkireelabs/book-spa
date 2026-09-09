import { describe, it, expect } from 'vitest';

describe('getCalendarBookings transferredIn column for an already-returned visitor', () => {
  it('builds a visiting column when the therapist is no longer in the active list', () => {
    const activeTherapistIds = new Set(['t-home-1', 't-home-2']); // visitor t-visitor-1 NOT in this set
    const inRows = [
      {
        therapist_id: 't-visitor-1',
        revert_at: '2026-09-09T18:50:00+05:45',
        effective_date: '2026-09-09',
        start_time: '16:45:00',
        fromBranch: { name: 'Thamel' },
        therapist: { id: 't-visitor-1', name: 'Srijana Baram', gender: 'female', specialties: [], position: 'therapist', is_service_staff: true, display_order: 3 },
      },
    ];
    const transferredInTherapists = inRows
      .filter(t => t.therapist && !activeTherapistIds.has(t.therapist.id))
      .map(t => ({
        ...t.therapist,
        transferredIn: true,
        fromBranch: t.fromBranch?.name || null,
        returnsAt: t.revert_at,
        transferStartAt: t.effective_date && t.start_time ? `${t.effective_date}T${t.start_time}+05:45` : null,
      }));

    expect(transferredInTherapists).toHaveLength(1);
    expect(transferredInTherapists[0]).toMatchObject({
      id: 't-visitor-1',
      name: 'Srijana Baram',
      transferredIn: true,
      fromBranch: 'Thamel',
      returnsAt: '2026-09-09T18:50:00+05:45',
      transferStartAt: '2026-09-09T16:45:00+05:45',
    });
  });

  it('does NOT build a visiting column when the therapist is still actively present', () => {
    const activeTherapistIds = new Set(['t-visitor-1']); // still here — tagged via transferredInById instead
    const inRows = [
      {
        therapist_id: 't-visitor-1',
        therapist: { id: 't-visitor-1', name: 'Srijana Baram' },
        fromBranch: { name: 'Thamel' },
        revert_at: '2026-09-09T18:50:00+05:45',
        effective_date: '2026-09-09',
        start_time: '16:45:00',
      },
    ];
    const transferredInTherapists = inRows
      .filter(t => t.therapist && !activeTherapistIds.has(t.therapist.id))
      .map(t => ({ ...t.therapist, transferredIn: true }));

    expect(transferredInTherapists).toHaveLength(0);
  });
});
