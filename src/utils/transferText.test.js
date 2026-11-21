import { describe, it, expect } from 'vitest';
import { describeTransfer, toTransferInput, transferState, transferWindowLine, transferTitle, transferDurationText } from './transferText';

const NP = (d, t) => `${d}T${t}:00+05:45`;
const base = { fromBranch: 'Lazimpat', toBranch: 'Sanepa' };
const temp = { ...base, isPermanent: false, applied: true, reverted: false, startAt: NP('2026-10-27', '12:00'), revertAt: NP('2026-10-27', '16:00') };
const at = (d, t) => new Date(NP(d, t));
const home = (t, o = {}) => describeTransfer(t, { viewpoint: 'home', use24h: true, ...o });
const recv = (t, o = {}) => describeTransfer(t, { viewpoint: 'receiving', use24h: true, ...o });

describe('describeTransfer – table A', () => {
  const upcoming = { ...temp, applied: false };
  it('temporary upcoming', () => {
    const now = at('2026-10-26', '17:00');
    expect(home(upcoming, { now })).toMatchObject({ state: 'upcoming', pill: 'Upcoming', sentence: 'To Sanepa Tue 27 Oct 12:00–16:00, back at Lazimpat 16:00' });
    expect(recv(upcoming, { now }).sentence).toBe('From Lazimpat Tue 27 Oct 12:00–16:00');
  });
  it('temporary now', () => {
    const now = at('2026-10-27', '13:00');
    expect(home(temp, { now })).toMatchObject({ state: 'now', pill: 'At Sanepa', sentence: 'At Sanepa until 16:00, back at Lazimpat 16:00' });
    expect(recv(temp, { now }).sentence).toBe('Visiting from Lazimpat until 16:00');
    expect(recv(temp, { now }).pill).toBe('Visiting');
    expect(recv({ ...temp, applied: false }, { now: at('2026-10-26', '09:00') }).pill).toBe('Upcoming');
  });
  it('temporary multi-day', () => {
    const t = { ...temp, revertAt: NP('2026-10-29', '16:00') };
    const now = at('2026-10-27', '13:00');
    expect(home(t, { now }).sentence).toBe('At Sanepa until Thu 29 Oct 16:00, back at Lazimpat then');
    expect(recv(t, { now }).sentence).toBe('Visiting from Lazimpat until Thu 29 Oct 16:00');
    expect(home({ ...t, applied: false }, { now: at('2026-10-26', '10:00') }).sentence)
      .toBe('To Sanepa Tue 27 Oct 12:00 – Thu 29 Oct 16:00, back at Lazimpat 16:00');
  });
  it('midnight-spanning is multi-day in Nepal time', () => {
    const t = { ...temp, startAt: NP('2026-10-27', '22:00'), revertAt: NP('2026-10-28', '02:00') };
    expect(home({ ...t, applied: false }, { now: at('2026-10-27', '09:00') }).sentence).toContain('Tue 27 Oct 22:00 – Wed 28 Oct 02:00');
  });
  it('permanent upcoming / done', () => {
    const p = { ...base, isPermanent: true, revertAt: null, startAt: NP('2026-10-28', '09:00'), applied: false };
    expect(home(p)).toMatchObject({ state: 'permanent-upcoming', pill: 'Moving', sentence: 'Moves to Sanepa on Wed 28 Oct 09:00 · permanent' });
    expect(recv(p).sentence).toBe('Joins from Lazimpat on Wed 28 Oct 09:00 · permanent');
    expect(home({ ...p, applied: true })).toMatchObject({ state: 'permanent-done', pill: 'Permanent', sentence: 'Moved from Lazimpat to Sanepa on Wed 28 Oct 09:00' });
  });
  it('ended and back early', () => {
    const ended = { ...temp, reverted: true, revertedAt: NP('2026-10-27', '16:00') };
    expect(home(ended)).toMatchObject({ state: 'ended', pill: 'Ended', sentence: 'Was at Sanepa Tue 27 Oct 12:00–16:00' });
    expect(recv(ended).sentence).toBe('Visited from Lazimpat Tue 27 Oct 12:00–16:00');
    const early = { ...temp, reverted: true, revertedAt: NP('2026-10-27', '14:10') };
    expect(home(early)).toMatchObject({ state: 'back-early', pill: 'Back early', sentence: 'Was at Sanepa Tue 27 Oct 12:00–14:10 (planned 16:00)' });
    expect(recv(early).sentence).toBe('Visited from Lazimpat Tue 27 Oct 12:00–14:10 (planned 16:00)');
  });
  it('passed revert_at not yet reverted reads as ended', () => {
    expect(transferState(temp, at('2026-10-27', '17:00'))).toBe('ended');
  });
});

describe('short forms', () => {
  const now = at('2026-10-27', '13:00');
  it('drops the date for the day shown', () => {
    expect(home({ ...temp, applied: false }, { now: at('2026-10-27', '09:00'), short: true, day: '2026-10-27' }).short).toBe('To Sanepa 12:00');
    expect(home(temp, { now, day: '2026-10-27' }).short).toBe('At Sanepa · back 16:00');
    expect(recv(temp, { now, day: '2026-10-27' }).short).toBe('From Lazimpat · until 16:00');
    expect(home(temp, { now, day: '2026-10-27' }).tiny).toBe('At Sanepa');
  });
  it('keeps the date for other days', () => {
    const p = { ...base, isPermanent: true, revertAt: null, startAt: NP('2026-10-28', '09:00'), applied: false };
    expect(home(p).short).toBe('Moves to Sanepa 28 Oct');
    expect(home({ ...temp, applied: false }, { now: at('2026-10-26', '09:00'), day: '2026-10-26' }).short).toBe('To Sanepa 27 Oct 12:00');
  });
});

describe('formats and fallbacks', () => {
  it('12h clock', () => {
    expect(describeTransfer({ ...temp, applied: false }, { now: at('2026-10-26', '09:00') }).sentence)
      .toBe('To Sanepa Tue 27 Oct 12:00pm–4:00pm, back at Lazimpat 4:00pm');
  });
  it('missing branch name uses the industry word', () => {
    expect(home({ ...temp, toBranch: null }, { now: at('2026-10-27', '13:00'), labels: { branch: 'outlet' } }).sentence).toContain('At another outlet');
    expect(home({ ...temp, toBranch: null }, { now: at('2026-10-27', '13:00') }).sentence).toContain('At another branch');
  });
  it('toTransferInput maps a snake_case row', () => {
    const t = toTransferInput({ effective_date: '2026-10-27', start_time: '12:00:00', revert_at: NP('2026-10-27', '16:00'), is_permanent: false, applied: false, toBranch: 'Sanepa' });
    expect(t.startAt).toBe(NP('2026-10-27', '12:00'));
    expect(transferState(t, at('2026-10-26', '09:00'))).toBe('upcoming');
  });
  it('window line and title', () => {
    const early = { ...temp, reverted: true, revertedAt: NP('2026-10-27', '14:10') };
    expect(transferWindowLine(early, { use24h: true })).toBe('Tue 27 Oct 12:00–14:10 (planned 16:00)');
    expect(transferTitle(temp)).toBe('Temporary transfer to Sanepa');
    expect(transferTitle({ ...temp, isPermanent: true, revertAt: null })).toBe('Moved from Lazimpat to Sanepa');
  });
});

describe('tiny and word forms per state', () => {
  const P = { ...base, isPermanent: true, revertAt: null, startAt: NP('2026-10-28', '09:00') };
  const cases = [
    ['upcoming', { ...temp, applied: false }, at('2026-10-27', '09:00'), 'To Sanepa', 'Out 12:00', 'From Lazimpat', 'In 12:00'],
    ['now', temp, at('2026-10-27', '13:00'), 'At Sanepa', 'Away', 'From Lazimpat', 'Visiting'],
    ['ended', { ...temp, reverted: true, revertedAt: NP('2026-10-27', '16:00') }, at('2026-10-27', '17:00'), 'Was at Sanepa', 'Ended', 'Visited from Lazimpat', 'Ended'],
    ['back-early', { ...temp, reverted: true, revertedAt: NP('2026-10-27', '14:10') }, at('2026-10-27', '17:00'), 'Was at Sanepa', 'Back early', 'Visited from Lazimpat', 'Back early'],
    ['permanent-upcoming', { ...P, applied: false }, at('2026-10-27', '09:00'), 'Moves to Sanepa', 'Moving', 'Joins from Lazimpat', 'Joining'],
    ['permanent-done', { ...P, applied: true }, at('2026-10-29', '09:00'), 'Moved to Sanepa', 'Moved', 'Moved to Sanepa', 'Moved'],
  ];
  it.each(cases)('%s', (state, t, now, hTiny, hWord, rTiny, rWord) => {
    const h = home(t, { now, day: '2026-10-27' }); const r = recv(t, { now, day: '2026-10-27' });
    expect([h.state, h.tiny, h.word]).toEqual([state, hTiny, hWord]);
    expect([r.tiny, r.word]).toEqual([rTiny, rWord]);
  });
});

describe('transferDurationText', () => {
  it('follows the real window, not the original duration', () => {
    expect(transferDurationText(temp)).toBe('4 h');
    expect(transferDurationText({ ...temp, revertAt: NP('2026-10-27', '15:30') })).toBe('3 h 30 min');
    expect(transferDurationText({ ...temp, reverted: true, revertedAt: NP('2026-10-27', '14:10') })).toBe('2 h 10 min');
    expect(transferDurationText({ ...temp, revertAt: NP('2026-10-29', '16:00') })).toBe('2 d 4 h');
    expect(transferDurationText({ ...temp, revertAt: NP('2026-10-27', '12:45') })).toBe('45 min');
    expect(transferDurationText({ ...temp, revertAt: null })).toBe('');
  });
});

describe('never throws', () => {
  it('survives the exact row Attendance passes for an applied away staffer (fetchTherapistTransferStatus shape)', () => {
    const row = { id: 'x', therapistId: 't', therapistName: 'Govind', fromBranchId: 'a', toBranchId: 'b', fromBranch: 'Lazimpat', toBranch: 'Sanepa',
      transferredAt: NP('2026-10-27', '09:00'), effectiveDate: '2026-10-27', startTime: '12:00:00', durationValue: 4, durationUnit: 'hour',
      revertAt: NP('2026-10-27', '15:30'), isPermanent: false, applied: true, reverted: false, revertedAt: null, note: null, transferredByName: null };
    const d = describeTransfer(toTransferInput(row), { viewpoint: 'home', short: true, day: '2026-10-27', now: at('2026-10-27', '13:00') });
    expect(d.state).toBe('now');
    expect(d.short).toBe('At Sanepa · back 15:30'.replace('15:30', '3:30pm'));
  });
  it('degrades on missing or garbage fields', () => {
    for (const bad of [undefined, null, {}, { startAt: 'nope', revertAt: 'nope', applied: true }, { applied: true, revertAt: 'x', reverted: true }]) {
      expect(() => describeTransfer(bad, { now: 'bad' })).not.toThrow();
      expect(typeof describeTransfer(bad).sentence).toBe('string');
    }
    expect(() => transferState({})).not.toThrow();
  });
});
