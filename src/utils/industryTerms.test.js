import { describe, it, expect, afterEach } from 'vitest';
import { setIndustryTerms, wordBranch, wordBranches, wordBranchCap, wordBranchesCap, localizeBranch, wordBranchCount } from './industryTerms';

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

describe('whole-word branch → location (never a suffix swap)', () => {
  afterEach(() => setIndustryTerms({}));
  it('maps every form for a non-spa org', () => {
    setIndustryTerms({ spa: false });
    expect(localizeBranch('branch')).toBe('location');
    expect(localizeBranch('branches')).toBe('locations');
    expect(localizeBranch('Branch')).toBe('Location');
    expect(localizeBranch('Branches')).toBe('Locations');
    expect(localizeBranch('All branches · read-only')).toBe('All locations · read-only');
    expect(localizeBranch('Branch, then name')).toBe('Location, then name');
    expect(localizeBranch('another branch')).toBe('another location');
    expect(localizeBranch('Branch ok')).toBe('Location ok');
    expect(wordBranchCount(1)).toBe('1 location');
    expect(wordBranchCount(2)).toBe('2 locations');
    expect(wordBranchCount(2)).not.toMatch(/es\b/);
  });
  it('spa stays byte-identical', () => {
    setIndustryTerms({ spa: true });
    expect(localizeBranch('All branches · Branch, then name')).toBe('All branches · Branch, then name');
    expect(wordBranchCount(1)).toBe('1 branch');
    expect(wordBranchCount(2)).toBe('2 branches');
  });
});
