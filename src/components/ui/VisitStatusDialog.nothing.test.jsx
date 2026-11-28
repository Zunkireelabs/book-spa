// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
const visitSetStatus = vi.fn();
vi.mock('../../services/visitApi', () => ({ visitSetStatus: (...a) => visitSetStatus(...a) }));
import { VisitStatusFlow } from './VisitStatusDialog';

afterEach(() => { cleanup(); visitSetStatus.mockReset(); });

describe('VisitStatusFlow', () => {
  it('NOTHING_TO_CHANGE shows the "nothing can be cancelled" dialog with an OK button, no reason field', async () => {
    visitSetStatus.mockResolvedValue({ data: null, error: { code: 'NOTHING_TO_CHANGE', message: 'x', rows: [{ booking_id: 'a', verdict: 'keep', reason: 'Already started', service: 'Gel' }] } });
    render(<VisitStatusFlow visitKey="v" kind="cancelled" lines={{}} reasonOptions={[]} onClose={() => {}} onDone={() => {}} />);
    await waitFor(() => expect(screen.getByText(/nothing can be cancelled/i)).toBeTruthy());
    expect(screen.getByText('OK')).toBeTruthy();
    expect(screen.queryByText(/Reason/)).toBeNull();
    expect(visitSetStatus).toHaveBeenCalledWith({ visitKey: 'v', status: 'Cancelled', dryRun: true });
  });
});
