import { describe, it, expect } from 'vitest';
import { categoryOptions, isCategoryMissing, categoryForSave } from './serviceCategory';

const cats = [{ name: 'Massage' }, { name: 'Facial' }];

describe('categoryOptions', () => {
  it('lists the business categories', () => {
    expect(categoryOptions(cats, 'Massage')).toEqual([{ value: 'Massage', label: 'Massage' }, { value: 'Facial', label: 'Facial' }]);
  });
  it('adds a missing current category: plain name as label, note as suffix', () => {
    const o = categoryOptions(cats, 'Eyebrows');
    expect(o[o.length - 1]).toEqual({ value: 'Eyebrows', label: 'Eyebrows', suffix: '(not in Categories)' });
  });
  it('matches case-insensitively and works with no categories at all', () => {
    expect(categoryOptions(cats, 'massage')).toHaveLength(2);
    expect(categoryOptions([], 'Eyebrows')).toHaveLength(1);
    expect(categoryOptions([], '')).toEqual([]);
  });
});

describe('isCategoryMissing', () => {
  it('flags only a non-empty category with no row', () => {
    expect(isCategoryMissing(cats, 'Eyebrows')).toBe(true);
    expect(isCategoryMissing(cats, 'FACIAL')).toBe(false);
    expect(isCategoryMissing(cats, '')).toBe(false);
    expect(isCategoryMissing([], null)).toBe(false);
  });
});

describe('categoryForSave (keep the current value when saving)', () => {
  it('editing without touching Category sends nothing, so the stored value is kept', () => {
    expect(categoryForSave({ isEdit: true, current: 'Eyebrows', original: 'Eyebrows' })).toBeUndefined();
    expect(categoryForSave({ isEdit: true, current: '', original: '' })).toBeUndefined();
    expect(categoryForSave({ isEdit: true, current: '', original: null })).toBeUndefined(); // NULL stays NULL, not ''
  });
  it('an explicit change writes the new value', () => {
    expect(categoryForSave({ isEdit: true, current: 'Facial', original: 'Eyebrows' })).toBe('Facial');
  });
  it('creating sends the chosen value', () => {
    expect(categoryForSave({ isEdit: false, current: 'Massage', original: '' })).toBe('Massage');
  });
});
