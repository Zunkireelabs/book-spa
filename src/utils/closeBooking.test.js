import { describe, it, expect, vi } from 'vitest';
import { planClose, runCloseSteps } from './closeBooking';

describe('planClose', () => {
  it('walks the state machine one valid step at a time', () => {
    expect(planClose('Pending', 'completed')).toEqual([['Confirmed'], ['In-Progress'], ['Completed']]);
    expect(planClose('Confirmed', 'completed')).toEqual([['In-Progress'], ['Completed']]);
    expect(planClose('In-Progress', 'completed')).toEqual([['Completed']]);
  });
  it('no-show is a single step with its reason, only from Pending / Confirmed', () => {
    expect(planClose('Confirmed', 'no_show', 'did not come')).toEqual([['No Show', 'did not come']]);
    expect(planClose('In-Progress', 'no_show', 'x')).toBeNull();
  });
  it('already closed bookings cannot be closed again', () => {
    expect(planClose('Completed', 'completed')).toBeNull();
    expect(planClose('Cancelled', 'completed')).toBeNull();
  });
});

describe('runCloseSteps', () => {
  const ok = () => Promise.resolve({ data: {} });
  it('runs every step in order and reports where it ended', async () => {
    const update = vi.fn(ok);
    const res = await runCloseSteps([['Confirmed'], ['In-Progress'], ['Completed']], update);
    expect(update.mock.calls.map((c) => c[0])).toEqual(['Confirmed', 'In-Progress', 'Completed']);
    expect(res).toEqual({ data: { status: 'Completed' }, error: null });
  });
  it('a later failure names where it stopped and stops walking', async () => {
    const update = vi.fn((s) => (s === 'Completed' ? Promise.resolve({ error: { message: 'closed_day: this day is locked' } }) : ok()));
    const res = await runCloseSteps([['Confirmed'], ['In-Progress'], ['Completed']], update, (e) => e.message.replace(/^closed_day:\s*/, ''));
    expect(update).toHaveBeenCalledTimes(3);
    expect(res.data).toBeNull();
    expect(res.error).toMatchObject({ code: 'PARTIAL', reachedStatus: 'In-Progress', message: 'Moved to In-Progress, but couldn’t complete: this day is locked' });
  });
  it('a failure after the first step stops later steps', async () => {
    const update = vi.fn((s) => (s === 'In-Progress' ? Promise.resolve({ error: { message: 'nope' } }) : ok()));
    const res = await runCloseSteps([['Confirmed'], ['In-Progress'], ['Completed']], update);
    expect(update.mock.calls.map((c) => c[0])).toEqual(['Confirmed', 'In-Progress']);
    expect(res.error).toMatchObject({ code: 'PARTIAL', reachedStatus: 'Confirmed' });
  });
  it('a failure on the very first step changes nothing and returns that step’s own error', async () => {
    const err = { code: 'BOOKING_LOCKED', message: 'locked' };
    const res = await runCloseSteps([['Confirmed'], ['In-Progress']], () => Promise.resolve({ error: err }));
    expect(res).toEqual({ data: null, error: err });
  });
  it('a single-step no-show that fails is just that error', async () => {
    const res = await runCloseSteps([['No Show', 'r']], () => Promise.resolve({ error: { message: 'reason required' } }));
    expect(res.error.code).toBeUndefined();
    expect(res.error.message).toBe('reason required');
  });
});
