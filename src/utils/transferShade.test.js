import { describe, it, expect } from 'vitest';
import { transferShadeSegments, dedupeAgainst } from './transferShade';

const NP = (d, t) => `${d}T${t}:00+05:45`;
const R = { openMin: 9 * 60, closeMin: 21 * 60 };
const out = { transferredOut: true, transferToBranch: 'Sanepa', transferStartAt: NP('2026-10-27', '12:00'), returnsAt: NP('2026-10-27', '16:00') };
const vis = { transferredIn: true, transferFromBranch: 'Lazimpat', transferStartAt: NP('2026-10-27', '12:00'), returnsAt: NP('2026-10-27', '16:00') };

describe('transferShadeSegments', () => {
  it('away: shades the window with the other branch named', () => {
    expect(transferShadeSegments(out, '2026-10-27', R)).toEqual([{ startMin: 720, endMin: 960, label: 'At Sanepa 12:00–16:00' }]);
  });
  it('away: nothing on days outside the window', () => {
    expect(transferShadeSegments(out, '2026-10-26', R)).toEqual([]);
    expect(transferShadeSegments(out, '2026-10-28', R)).toEqual([]);
  });
  it('away multi-day: partial first and last day, whole days between', () => {
    const c = { ...out, returnsAt: NP('2026-10-29', '16:00') };
    expect(transferShadeSegments(c, '2026-10-27', R)[0]).toMatchObject({ startMin: 720, endMin: 1260 });
    expect(transferShadeSegments(c, '2026-10-28', R)[0]).toMatchObject({ startMin: 540, endMin: 1260 });
    expect(transferShadeSegments(c, '2026-10-29', R)[0]).toMatchObject({ startMin: 540, endMin: 960 });
  });
  it('visiting: shaded before arriving and after leaving, free during the visit', () => {
    expect(transferShadeSegments(vis, '2026-10-27', R).map((s) => [s.startMin, s.endMin])).toEqual([[540, 720], [960, 1260]]);
    expect(transferShadeSegments(vis, '2026-10-27', R).map((x) => x.label)).toEqual(['At Lazimpat until 12:00', 'At Lazimpat from 16:00']);
  });
  it('visiting: whole day before the visit, nothing after it', () => {
    expect(transferShadeSegments(vis, '2026-10-26', R)).toEqual([{ startMin: 540, endMin: 1260, label: 'At Lazimpat' }]);
    expect(transferShadeSegments(vis, '2026-10-28', R)).toEqual([]);
  });
  it('multi-day away: from / whole day / until, never a midnight edge', () => {
    const c = { ...out, returnsAt: NP('2026-10-29', '16:00') };
    expect(transferShadeSegments(c, '2026-10-27', R)[0].label).toBe('At Sanepa from 12:00');
    expect(transferShadeSegments(c, '2026-10-28', R)[0].label).toBe('At Sanepa');
    expect(transferShadeSegments(c, '2026-10-29', R)[0].label).toBe('At Sanepa until 16:00');
    expect(transferShadeSegments(c, '2026-10-27', { openMin: 0, closeMin: 1440, fmt: (t) => t })[0].label).toBe('At Sanepa from 12:00');
  });
  it('visiting multi-day: whole middle days are open', () => {
    const c = { ...vis, returnsAt: NP('2026-10-29', '16:00') };
    expect(transferShadeSegments(c, '2026-10-28', R)).toEqual([]);
    expect(transferShadeSegments(c, '2026-10-29', R).map((s) => [s.startMin, s.endMin])).toEqual([[960, 1260]]);
  });
  it('no transfer, no segments', () => {
    expect(transferShadeSegments({}, '2026-10-27', R)).toEqual([]);
  });
  it('upcoming case: the RPC already shades it, so no second layer', () => {
    const segs = transferShadeSegments(out, '2026-10-27', R);
    expect(dedupeAgainst(segs, [{ startMin: 720, endMin: 960 }])).toEqual([]);
    expect(dedupeAgainst(segs, [])).toHaveLength(1);
  });
});

describe('two visits in one day (ZNLY-113)', () => {
  const two = { ...vis, visitWindows: [
    { startAt: NP('2026-10-27', '12:00'), endAt: NP('2026-10-27', '15:30') },
    { startAt: NP('2026-10-27', '18:55'), endAt: NP('2026-10-27', '21:55') },
  ] };
  it('shades before, between and after the visits, never inside either', () => {
    expect(transferShadeSegments(two, '2026-10-27', { openMin: 540, closeMin: 1320 }).map((s) => [s.startMin, s.endMin]))
      .toEqual([[540, 720], [930, 1135], [1315, 1320]]);
  });
  it('nothing once both visits are over', () => {
    expect(transferShadeSegments(two, '2026-10-28', R)).toEqual([]);
  });
});
