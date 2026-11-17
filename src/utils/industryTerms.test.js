import { describe, it, expect } from 'vitest';
import { setIndustryTerms, wordBranch, wordBranches, wordBranchCap, wordBranchesCap, localizeBranch } from './industryTerms';

describe('site word (branch vs location)', () => {
  it('spa keeps branch exactly', () => {
    setIndustryTerms({ spa: true });
    expect([wordBranch(), wordBranches(), wordBranchCap(), wordBranchesCap()]).toEqual(['branch', 'branches', 'Branch', 'Branches']);
    expect(localizeBranch('Who moved, which branch paid. Branches')).toBe('Who moved, which branch paid. Branches');
  });
  it('other trades say location', () => {
    setIndustryTerms({ spa: false });
    expect([wordBranch(), wordBranches(), wordBranchCap(), wordBranchesCap()]).toEqual(['location', 'locations', 'Location', 'Locations']);
    expect(localizeBranch('one branch or all. Branches')).toBe('one location or all. Locations');
    setIndustryTerms({ spa: true });
  });
});
