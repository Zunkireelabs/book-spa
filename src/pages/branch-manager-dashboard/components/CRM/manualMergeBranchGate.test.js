import { describe, it, expect } from 'vitest';
import { canSearchForMerge } from './manualMergeBranchGate';

describe('canSearchForMerge', () => {
  it('allows search when a real branch id is available and not in Overall view', () => {
    expect(canSearchForMerge({ isOverall: false, branchId: 'b0000000-0000-0000-0000-000000000001' })).toBe(true);
  });

  it('allows search when in Overall view but the caller still resolved a real branch id (e.g. admin has a home branch)', () => {
    expect(canSearchForMerge({ isOverall: true, branchId: 'b0000000-0000-0000-0000-000000000001' })).toBe(true);
  });

  it('blocks search when in Overall view and no real branch id is available', () => {
    expect(canSearchForMerge({ isOverall: true, branchId: null })).toBe(false);
    expect(canSearchForMerge({ isOverall: true, branchId: undefined })).toBe(false);
    expect(canSearchForMerge({ isOverall: true, branchId: '__overall__' })).toBe(false);
  });

  it('blocks search when branchId is missing even outside Overall view (defensive)', () => {
    expect(canSearchForMerge({ isOverall: false, branchId: null })).toBe(false);
  });
});
