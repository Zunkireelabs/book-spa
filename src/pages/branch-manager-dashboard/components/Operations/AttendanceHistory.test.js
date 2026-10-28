import { describe, it, expect } from 'vitest';
import { lineOf } from './AttendanceSidePanel';

const fmt = (t) => t;
const row = (o) => ({ id: 'r', old_value: null, new_value: null, source: 'panel', punch_id: null, ...o });
const g = (rows) => ({ rows });

describe('history lines always have a description', () => {
  it('legacy punch rows read as an import', () => {
    const rows = [row({ field: 'check_in', new_value: '2026-10-28T07:13:00Z', punch_id: 'p', source: 'legacy' }), row({ field: 'check_out', new_value: '2026-10-28T07:13:00Z', punch_id: 'p', source: 'legacy' })];
    expect(lineOf(g(rows), fmt)).toBe('Imported check-in 12:58 – 12:58 (from the old record)');
  });
  it('old day-level time fields are described, not dropped', () => {
    expect(lineOf(g([row({ field: 'check_in_time', new_value: '2026-10-28T07:13:00Z' })]), fmt)).toContain('Imported check-in 12:58');
  });
  it('an unrecognised field still gets a line', () => {
    expect(lineOf(g([row({ field: 'mystery', new_value: 'x' })]), fmt)).toBe('Record updated');
  });
});
