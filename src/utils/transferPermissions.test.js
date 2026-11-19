import { describe, it, expect } from 'vitest';
import { canAct } from './transferPermissions';

const actions = ['extend', 'reschedule', 'revertNow', 'cancelScheduled', 'editScheduled'];
const can = (role, side) => actions.filter((a) => canAct(a, { role, side }));

describe('canAct', () => {
  it('home manager: change return, bring back, edit/cancel while upcoming; no extend', () => {
    expect(can('manager', 'home')).toEqual(['reschedule', 'revertNow', 'cancelScheduled', 'editScheduled']);
  });
  it('receiving manager: extend, change return, bring back; no cancel/edit scheduled', () => {
    expect(can('manager', 'receiving')).toEqual(['extend', 'reschedule', 'revertNow']);
  });
  it('admin does everything from either side', () => {
    expect(can('admin', 'home')).toEqual(actions);
    expect(can('admin', 'receiving')).toEqual(actions);
  });
  it('staff and admin_viewer are read-only', () => {
    for (const role of ['staff', 'admin_viewer', undefined]) {
      expect(can(role, 'home')).toEqual([]);
      expect(can(role, 'receiving')).toEqual([]);
    }
  });
  it('unknown action is refused', () => {
    expect(canAct('nope', { role: 'admin', side: 'home' })).toBe(false);
  });
});
