// @vitest-environment jsdom
// Smoke render: the panel must mount with an on-roster person, a scheduled transfer and an APPLIED (away) transfer without
// throwing (it once crashed to the error screen on a use-before-define after the away rows were merged into the main list).
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const NP = (d, t) => `${d}T${t}:00+05:45`;
const today = new Date().toISOString().split('T')[0];

vi.mock('../../../../services/api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchAttendance: vi.fn(async () => ({ data: [{ therapistId: 'own', therapistName: 'Asha', status: 'Present', isServiceStaff: true }], error: null })),
  fetchAttendanceSummary: vi.fn(async () => ({ data: {}, error: null })),
  fetchShiftsForRange: vi.fn(async () => ({ data: [], error: null })),
  fetchAttendanceByTherapistIds: vi.fn(async () => ({ data: {}, error: null })),
  fetchPendingTransfers: vi.fn(async () => ({ data: [], error: null })),
  fetchTherapistTransferStatus: vi.fn(async () => ({
    error: null,
    data: {
      away: {
        id: 'x', therapistId: 'away', therapistName: 'Govind', fromBranchId: 'b1', toBranchId: 'b2', fromBranch: 'Lazimpat', toBranch: 'Sanepa',
        transferredAt: NP(today, '09:00'), effectiveDate: today, startTime: '00:01:00', durationValue: 4, durationUnit: 'hour',
        revertAt: new Date(Date.now() + 3600e3).toISOString(), isPermanent: false, applied: true, reverted: false, revertedAt: null, note: null,
      },
    },
  })),
}));
vi.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'u', org_id: 'o', role: 'manager' } }) }));
vi.mock('../../../../hooks/useIndustry', () => ({ useIndustry: () => ({ staffLabel: 'Therapist', staffLabelPlural: 'Therapists', locationLabel: 'Branch' }) }));
vi.mock('../../../../hooks/useAutoRefresh', () => ({ useAutoRefresh: () => {} }));
vi.mock('../../../../hooks/useAvailabilityConflictGuard', () => ({ useAvailabilityConflictGuard: () => ({ confirmConflicts: async () => true, conflictModal: null }) }));

import AttendancePanel from './AttendancePanel';

describe('AttendancePanel smoke', () => {
  it('lists the on-roster person and the away person with the transfer pill', async () => {
    render(<MemoryRouter><AttendancePanel branchId="b1" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Govind')).toBeTruthy());
    expect(screen.getByText('Asha')).toBeTruthy();
    expect(document.querySelector('[data-transfer-cell="now"]')).toBeTruthy();
  });
});
