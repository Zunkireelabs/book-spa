import { describe, it, expect } from 'vitest';
import { arrangeAssignees } from './assignList';

const P = [{ id: 'a', name: 'Asha' }, { id: 'b', name: 'Bikash' }, { id: 'c', name: 'Rabina' }, { id: 'd', name: 'Tara Gurung' }];
describe('arrangeAssignees', () => {
  it('no query: everyone, assigned first, nothing pinned', () => {
    const r = arrangeAssignees(P, { assignedIds: ['c'] });
    expect(r.rows.map((p) => p.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(r.pinned).toEqual([]); expect(r.matchCount).toBe(4); expect(r.total).toBe(4); expect(r.filtering).toBe(false);
  });
  it('query filters case-insensitively; count equals visible match rows', () => {
    const r = arrangeAssignees(P, { query: ' RA ' });
    expect(r.rows.map((p) => p.id)).toEqual(['c', 'd']); expect(r.matchCount).toBe(2);
  });
  it('selected non-matching people are pinned, not counted', () => {
    const r = arrangeAssignees(P, { query: 'ra', selectedIds: ['a', 'c'], assignedIds: ['a'] });
    expect(r.rows.map((p) => p.id)).toEqual(['c', 'd']); expect(r.pinned.map((p) => p.id)).toEqual(['a']); expect(r.matchCount).toBe(2);
  });
  it('counts selected people outside the list as hidden', () => {
    const r = arrangeAssignees(P, { selectedIds: ['a', 'ghost1', 'ghost2'] });
    expect(r.selectedVisible).toBe(1); expect(r.hiddenSelected).toBe(2);
    expect(arrangeAssignees(P, { selectedIds: ['a', 'b'] }).hiddenSelected).toBe(0);
  });
  it('no match', () => {
    const r = arrangeAssignees(P, { query: 'zzz' });
    expect(r.rows).toEqual([]); expect(r.matchCount).toBe(0);
  });
});
