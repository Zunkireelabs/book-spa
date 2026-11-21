import { describe, it, expect } from 'vitest';
import { addDays, daysInclusive, previousPeriod, getReportRange, computeDelta } from './reportPeriod';

describe('period math', () => {
  it('counts both ends and crosses month and year edges', () => {
    expect(daysInclusive('2026-10-01', '2026-10-30')).toBe(30);
    expect(daysInclusive('2026-10-30', '2026-10-30')).toBe(1);
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
  it('the previous period is the equal-length range right before', () => {
    expect(previousPeriod('2026-10-01', '2026-10-30')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(previousPeriod('2026-10-10', '2026-10-10')).toEqual({ from: '2026-10-09', to: '2026-10-09' });
    const p = previousPeriod('2026-03-05', '2026-03-11');
    expect(daysInclusive(p.from, p.to)).toBe(7);
    expect(addDays(p.to, 1)).toBe('2026-03-05');
  });
  it('last 30 days ends today, is 30 days long, and has a 30 day previous period', () => {
    const r = getReportRange('last30', new Date(2026, 9, 30));
    expect(r).toMatchObject({ from: '2026-10-01', to: '2026-10-30', days: 30, vsLabel: 'vs previous 30' });
    expect(r.prev).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });
  it('this month runs from the 1st; previous is as long, not the calendar month', () => {
    const r = getReportRange('month', new Date(2026, 9, 12));
    expect(r.from).toBe('2026-10-01');
    expect(r.days).toBe(12);
    expect(r.prev).toEqual({ from: '2026-09-19', to: '2026-09-30' });
  });
  it('falls back to last 30 for an unknown id', () => {
    expect(getReportRange('nope', new Date(2026, 9, 30)).days).toBe(30);
  });
});

describe('custom range', () => {
  it('uses the dates given, with the equal-length range right before', () => {
    const r = getReportRange('custom', new Date(2026, 9, 30), { from: '2026-10-16', to: '2026-10-30' });
    expect(r).toMatchObject({ id: 'custom', from: '2026-10-16', to: '2026-10-30', days: 15, vsLabel: 'vs previous 15' });
    expect(r.prev).toEqual({ from: '2026-10-01', to: '2026-10-15' });
  });
  it('falls back to last 30 days when the dates are missing, reversed or malformed', () => {
    for (const bad of [null, { from: '2026-10-30', to: '2026-10-16' }, { from: 'x', to: 'y' }, { from: '2026-10-01' }]) {
      expect(getReportRange('custom', new Date(2026, 9, 30), bad).id).toBe('last30');
    }
  });
});

describe('computeDelta', () => {
  it('up is green when up is good, red when up is bad', () => {
    expect(computeDelta(112, 100)).toMatchObject({ dir: 'up', value: 12, tone: 'good', text: '▲ 12%' });
    expect(computeDelta(112, 100, { goodWhen: 'down' })).toMatchObject({ dir: 'up', tone: 'bad' });
  });
  it('down is red when up is good, green when down is good', () => {
    expect(computeDelta(90, 100)).toMatchObject({ dir: 'down', value: 10, tone: 'bad', text: '▼ 10%' });
    expect(computeDelta(90, 100, { goodWhen: 'down' })).toMatchObject({ dir: 'down', tone: 'good' });
  });
  it('shares move in points', () => {
    expect(computeDelta(0.64, 0.67, { unit: 'pts' })).toMatchObject({ dir: 'down', value: 3, tone: 'bad', text: '▼ 3 pts' });
    expect(computeDelta(0.41, 0.39, { unit: 'pts' })).toMatchObject({ dir: 'up', value: 2, tone: 'good' });
  });
  it('no honest comparison gives null: missing values, or a % off zero', () => {
    expect(computeDelta(5, null)).toBeNull();
    expect(computeDelta(null, 5)).toBeNull();
    expect(computeDelta(5, 0)).toBeNull();
    expect(computeDelta(0.5, 0, { unit: 'pts' })).not.toBeNull();
  });
  it('a zero change is flat, whatever goodWhen says', () => {
    expect(computeDelta(100, 100)).toMatchObject({ dir: 'flat', tone: 'flat' });
    expect(computeDelta(100.2, 100)).toMatchObject({ dir: 'flat', tone: 'flat' });
  });
});
