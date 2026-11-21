// @vitest-environment jsdom
// Smoke render of the V34b Attendance page: rows + states, the away (transfer) row with its pill, one-button actions going through
// save_attendance with a source, the reason bounce into the side panel, the closed-day and unmarked-day banners.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// 10:45 am Kathmandu on Wed 28 Oct 2026
const NOW = new Date('2026-10-28T05:00:00Z');
const today = '2026-10-28';
const NP = (d, t) => `${d}T${t}:00+05:45`;

const mocks = vi.hoisted(() => ({
  save: vi.fn(async () => ({ data: { id: 'x' }, error: null })),
  punchIn: vi.fn(async () => ({ data: { id: 'p-new' }, error: null })),
  punchOut: vi.fn(async () => ({ data: { id: 'p-new' }, error: null })),
  punches: [],
  day: { isClosed: false },
  gaps: [],
  attendance: [],
  visitors: {},
  settings: { lateGraceMinutes: 10, openCheckoutHours: 4, expectCheckIn: true },
}));

vi.mock('../../../../services/api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchAttendance: vi.fn(async () => ({ data: mocks.attendance, error: null })),
  fetchShiftsForRange: vi.fn(async () => ({
    data: ['own', 'ramesh', 'late', 'leave', 'esha', 'gov'].map((id) => ({ therapist_id: id, works: true, start_time: '09:00:00', end_time: '18:00:00', breaks: [] })), error: null,
  })),
  fetchAttendanceByTherapistIds: vi.fn(async () => ({ data: {}, error: null })),
  fetchPendingTransfers: vi.fn(async () => ({ data: [], error: null })),
  fetchVisitingAttendanceToday: vi.fn(async () => ({ data: mocks.visitors, error: null })),
  fetchBranchesByOrgId: vi.fn(async () => ({ data: [{ id: 'b1', name: 'Lazimpat' }, { id: 'b2', name: 'Sanepa' }], error: null })),
  fetchAttendanceDayStatus: vi.fn(async () => ({ data: mocks.day, error: null })),
  fetchAttendanceGaps: vi.fn(async () => ({ data: mocks.gaps, error: null })),
  fetchTransfersForTherapists: vi.fn(async () => ({ data: [{ therapist_id: 'gov', from_branch_id: 'b1', to_branch_id: 'b2', effective_date: '2026-10-28', start_time: '14:00:00', revert_at: '2026-10-28T16:00:00+05:45', reverted: false, reverted_at: null, is_return_leg: false, is_permanent: false }], error: null })),
  fetchAttendanceSettings: vi.fn(async () => ({ data: mocks.settings, error: null })),
  fetchAttendanceChanges: vi.fn(async () => ({ data: [], error: null })),
  fetchAttendancePayContext: vi.fn(async () => ({ data: { monthlySalary: 30000, daysInMonth: 31, sickUsed: 0, annualUsed: 0, sickCap: 14, annualCap: 18 }, error: null })),
  saveAttendanceRecord: mocks.save,
  fetchAttendancePunches: vi.fn(async () => ({ data: mocks.punches, error: null })),
  punchIn: mocks.punchIn,
  punchOut: mocks.punchOut,
  savePunch: vi.fn(async () => ({ data: {}, error: null })),
  deletePunch: vi.fn(async () => ({ data: {}, error: null })),
  deleteAttendanceRecord: vi.fn(async () => ({ data: {}, error: null })),
  markVisitorAttendance: vi.fn(async () => ({ data: {}, error: null })),
  fetchTherapistTransferStatus: vi.fn(async () => ({
    error: null,
    data: {
      esha: {
        id: 'y', therapistId: 'esha', therapistName: 'Esha', fromBranchId: 'b1', toBranchId: 'b2', fromBranch: 'Lazimpat', toBranch: 'Sanepa',
        transferredAt: NP(today, '00:00'), effectiveDate: today, startTime: '00:00:00', durationValue: 1, durationUnit: 'day',
        revertAt: '2026-10-29T00:00:00+05:45', isPermanent: false, applied: true, reverted: false, revertedAt: null, note: null,
      },
      gov: {
        id: 'z', therapistId: 'gov', therapistName: 'Govind V', fromBranchId: 'b1', toBranchId: 'b2', fromBranch: 'Lazimpat', toBranch: 'Sanepa',
        transferredAt: NP(today, '11:15'), effectiveDate: today, startTime: '14:00:00', durationValue: 2, durationUnit: 'hour',
        revertAt: NP(today, '16:00'), isPermanent: false, applied: true, reverted: false, revertedAt: null, note: null,
      },
      away: {
        id: 'x', therapistId: 'away', therapistName: 'Govind', fromBranchId: 'b1', toBranchId: 'b2', fromBranch: 'Lazimpat', toBranch: 'Sanepa',
        transferredAt: NP(today, '09:00'), effectiveDate: today, startTime: '00:01:00', durationValue: 4, durationUnit: 'hour',
        revertAt: new Date(NOW.getTime() + 3600e3).toISOString(), isPermanent: false, applied: true, reverted: false, revertedAt: null, note: null,
      },
    },
  })),
}));
vi.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'u', org_id: 'o', role: 'manager' } }) }));
vi.mock('../../../../hooks/useIndustry', () => ({ useIndustry: () => ({ staffLabel: 'Therapist', staffLabelPlural: 'Therapists', locationLabel: 'Branch' }) }));
vi.mock('../../../../hooks/useAutoRefresh', () => ({ useAutoRefresh: () => {} }));
vi.mock('../../../../hooks/useAvailabilityConflictGuard', () => ({ useAvailabilityConflictGuard: () => ({ confirmConflicts: async () => true, conflictModal: null }) }));

import AttendancePanel from './AttendancePanel';

const person = (over) => ({ therapistId: 'own', therapistName: 'Asha', status: null, checkInTime: null, checkOutTime: null, isServiceStaff: true, position: 'Therapist', ...over });
const mount = () => render(<MemoryRouter><AttendancePanel branchId="b1" /></MemoryRouter>);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  window.matchMedia = window.matchMedia || (() => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  mocks.save.mockClear(); mocks.punchIn.mockClear(); mocks.punchOut.mockClear(); mocks.punches = [];
  mocks.day = { isClosed: false };
  mocks.gaps = [];
  mocks.visitors = {};
  mocks.settings = { lateGraceMinutes: 10, openCheckoutHours: 4, expectCheckIn: true };
  mocks.attendance = [
    person({ therapistId: 'own', therapistName: 'Asha' }),                                                 // no check-in at 10:45 -> No show
    person({ therapistId: 'late', therapistName: 'Bikash', status: 'Present', checkInTime: '10:13' }),    // late 73 min
    person({ therapistId: 'esha', therapistName: 'Esha' }),                                               // lent out all day -> Away today, not No show
    person({ therapistId: 'gov', therapistName: 'Govind V', status: 'Present', checkInTime: '09:00' }),   // split day: home 9-13, Sanepa from 14:00 (punches below)
    person({ therapistId: 'leave', therapistName: 'Puja', status: 'Sick Leave', isServiceStaff: false }),
  ];
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('AttendancePanel, switch OFF (present by default)', () => {
  beforeEach(() => { mocks.settings = { lateGraceMinutes: 10, openCheckoutHours: 4, expectCheckIn: false }; });

  it('no check-in = grey Present with "no check-in"; no No show, no Needs attention, no unmarked banner; neutral chip', async () => {
    mocks.gaps = [];
    mount();
    await waitFor(() => expect(screen.getByText('Asha')).toBeTruthy());
    const row = document.querySelector('[data-attendance-row="own"]');
    expect(row.getAttribute('data-kind')).toBe('present_default');
    expect(row.textContent).toContain('counts as present');
    expect(row.textContent).toContain('Not checked in');
    expect(screen.queryByText('No show')).toBeNull();
    expect(screen.queryByTestId('unmarked-banner')).toBeNull();
    expect(screen.getAllByText('Not checked in').length).toBeGreaterThan(1);   // pill + chip
    expect(screen.getByTestId('attendance-summary').textContent).toMatch(/present/);
    expect(screen.getByTestId('attendance-summary').textContent).not.toMatch(/no show/);
  });

  it('a real check-in is still judged late (grace) and Check in records the current time', async () => {
    mount();
    await waitFor(() => expect(screen.getByText(/Late 1h 13m|Late 73 min/)).toBeTruthy());
    fireEvent.click(screen.getAllByText('Check in')[0]);
    await waitFor(() => expect(mocks.punchIn).toHaveBeenCalledWith(expect.objectContaining({ therapistId: 'own', branchId: 'b1', source: 'button' })));
  });

  it('end-of-day bar (past day): Confirm all present saves status-only records via save_attendance, source bulk, with the reason', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('Asha')).toBeTruthy());
    expect(screen.queryByTestId('eod-bar')).toBeNull();                      // 10:45 am: shifts are not over
    fireEvent.click(screen.getByLabelText('Previous day'));
    await waitFor(() => expect(screen.getByTestId('eod-bar')).toBeTruthy());
    expect(screen.getByTestId('eod-bar').textContent).toContain('no attendance saved for Tue 27 Oct');
    expect(screen.queryByText('No attendance saved')).toBeNull();
    fireEvent.click(screen.getByText('Confirm all present'));
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ patch: { status: 'Present' }, source: 'bulk', reason: 'Confirmed present at end of day', date: '2026-10-27' }));
  });
});

describe('AttendancePanel, switch ON: mark all present at shift start', () => {
  it('the Needs attention header offers it and writes the shift start (never a future time)', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('Asha')).toBeTruthy());
    fireEvent.click(screen.getByText(/Mark all present at shift start/));
    await waitFor(() => expect(mocks.punchIn).toHaveBeenCalledWith(expect.objectContaining({ therapistId: 'own', branchId: 'b1', source: 'bulk', at: '2026-10-28T09:00:00+05:45' })));
  });
});

describe('AttendancePanel', () => {
  it('split day: home 9-13 + Sanepa from 14:00 = one row, "2 punches", not late, At Sanepa, no No check-out (that open punch is Sanepa\'s)', async () => {
    mocks.punches = [
      { id: 'p1', therapistId: 'gov', branchId: 'b1', checkIn: '09:00', checkOut: '13:00' },
      { id: 'p2', therapistId: 'gov', branchId: 'b2', checkIn: '14:00', checkOut: null },
    ];
    mount();
    await waitFor(() => expect(screen.getByText('Govind V')).toBeTruthy());
    const row = document.querySelector('[data-attendance-row="gov"]');
    expect(document.querySelectorAll('[data-attendance-row="gov"]').length).toBe(1);
    expect(row.textContent).toContain('2 punches');
    expect(row.textContent).toContain('At Sanepa');
    expect(row.textContent).not.toContain('Late');
    expect(row.getAttribute('data-kind')).toBe('in');
  });

  it('the side panel lists the punches (branch + times), with Add punch', async () => {
    mocks.punches = [
      { id: 'p1', therapistId: 'gov', branchId: 'b1', checkIn: '09:00', checkOut: '13:00' },
      { id: 'p2', therapistId: 'gov', branchId: 'b2', checkIn: '14:00', checkOut: null },
    ];
    mount();
    await waitFor(() => expect(screen.getByText('Govind V')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('More for Govind V'));
    fireEvent.click(screen.getByText('Check-ins & times…'));
    await waitFor(() => expect(screen.getByTestId('attendance-punches')).toBeTruthy());
    const rows = document.querySelectorAll('[data-punch-row]');
    expect(rows.length).toBe(2);
    expect(rows[1].textContent).toContain('Sanepa');
    expect(rows[1].textContent).toContain('still in');
    expect(screen.getByText('Add punch')).toBeTruthy();
  });

  it('Late = the first punch against the first scheduled block of that day, wherever the punch is', async () => {
    mocks.punches = [{ id: 'p2', therapistId: 'gov', branchId: 'b2', checkIn: '10:13', checkOut: null }];
    mount();
    await waitFor(() => expect(screen.getByText('Govind V')).toBeTruthy());
    expect(document.querySelector('[data-attendance-row="gov"]').textContent).toContain('Late 1h 13m (due 9:00 am at Lazimpat)');
  });

  it('the ⋯ menu has Add punch… (opens the new-punch box), and a punch edit keeps its Reason inside the box, cleared once typed', async () => {
    mocks.punches = [{ id: 'p1', therapistId: 'gov', branchId: 'b1', checkIn: '09:00', checkOut: '10:00' }];
    mount();
    await waitFor(() => expect(screen.getByText('Govind V')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('More for Govind V'));
    fireEvent.click(screen.getByText('Add punch…'));
    await waitFor(() => expect(screen.getByTestId('add-punch')).toBeTruthy());
    fireEvent.click(screen.getByText('Cancel', { selector: 'li button' }));
    fireEvent.click(screen.getByText('Edit'));
    const box = await screen.findByTestId('edit-punch');
    expect(box.textContent).toContain('Reason');
    fireEvent.click(screen.getByText('Save punch'));
    expect(box.textContent).toContain('Add a reason to save this change.');
    fireEvent.change(box.querySelector('input[placeholder^="e.g."]'), { target: { value: 'updated' } });
    expect(box.textContent).not.toContain('Add a reason to save this change.');
  });

  it('a visitor no-show counts at the visited branch (Needs attention + the no-show count), marked Visiting', async () => {
    mocks.visitors = { v1: { therapistId: 'v1', therapistName: 'Visitor Vee', checkInTime: null, checkOutTime: null, windowFrom: '2026-10-28T03:15:00Z', windowTo: '2026-10-28T15:15:00Z' } };
    mount();
    await waitFor(() => expect(screen.getByText('Visitor Vee')).toBeTruthy());
    const row = document.querySelector('[data-attendance-row="v1"]');
    expect(row.getAttribute('data-kind')).toBe('no_show');
    expect(row.textContent).toContain('Visiting');
    expect(screen.getByTestId('attendance-summary').textContent).toContain('2 no show');   // Asha + the visitor
  });

  it('groups people, shows states, and lists the away person (with the transfer pill) in the collapsed Away group', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('Asha')).toBeTruthy());
    expect(screen.getAllByText('Needs attention').length).toBeGreaterThan(1);   // chip + group heading
    expect(screen.getByText('No show')).toBeTruthy();
    expect(screen.getByText(/Late 1h 13m/)).toBeTruthy();
    expect(screen.getByText('Support staff')).toBeTruthy();
    expect(screen.queryByText('Govind')).toBeNull();                       // collapsed
    expect(screen.queryByText('Esha')).toBeNull();                         // away all shift: in the collapsed group, not a No show row
    expect(screen.getAllByText('No show').length).toBe(1);
    fireEvent.click(screen.getByText('Away today'));
    await waitFor(() => expect(screen.getByText('Govind')).toBeTruthy());
    expect(screen.getByText('Esha')).toBeTruthy();
    expect(document.querySelector('[data-transfer-cell="now"]')).toBeTruthy();
  });

  it('Check in is a punch at THIS branch (source "button", now)', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('Asha')).toBeTruthy());
    fireEvent.click(screen.getAllByText('Check in')[0]);
    await waitFor(() => expect(mocks.punchIn).toHaveBeenCalled());
    expect(mocks.punchIn).toHaveBeenCalledWith(expect.objectContaining({ therapistId: 'own', branchId: 'b1', source: 'button', at: '2026-10-28T05:00:00.000Z' }));
    expect(mocks.save).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(/Asha checked in at/)).toBeTruthy());
    expect(screen.getByText('Undo')).toBeTruthy();
  });

  it('ATTENDANCE_REASON_REQUIRED opens the side panel on the Reason field', async () => {
    mocks.punchIn.mockResolvedValueOnce({ data: null, error: { code: 'ATTENDANCE_REASON_REQUIRED', message: 'x' } });
    mount();
    await waitFor(() => expect(screen.getByText('Asha')).toBeTruthy());
    fireEvent.click(screen.getAllByText('Check in')[0]);
    await waitFor(() => expect(screen.getByTestId('attendance-panel')).toBeTruthy());
    expect(screen.getByPlaceholderText(/Felt unwell/)).toBeTruthy();
  });

  it('shows the closed-day banner on load and no action buttons', async () => {
    mocks.day = { isClosed: true };
    mount();
    await waitFor(() => expect(screen.getByTestId('closed-banner')).toBeTruthy());
    expect(screen.queryByText('Check in')).toBeNull();
  });

  it('shows the unmarked-day banner from attendance_gaps', async () => {
    mocks.gaps = [{ kind: 'unmarked', date: '2026-10-26', therapistId: 'ramesh', therapistName: 'Arjun KC', shiftStart: '09:00', shiftEnd: '18:00' }];
    mount();
    await waitFor(() => expect(screen.getByTestId('unmarked-banner')).toBeTruthy());
    expect(screen.getByTestId('unmarked-banner').textContent).toContain('Arjun KC');
  });
});
