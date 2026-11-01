import { describe, it, expect } from 'vitest';
import { durationText } from './durationText';

describe('durationText', () => {
  it('one format for every length', () => {
    expect([0, 45, 60, 75, 465, 1248, 1440, 15060].map(durationText)).toEqual(['0 min', '45 min', '1 h', '1 h 15 min', '7 h 45 min', '20 h 48 min', '24 h', '251 h']);
  });
  it('rounds to whole minutes first, copes with junk', () => {
    expect(durationText(74.6)).toBe('1 h 15 min');
    expect(durationText(null)).toBe('0 min');
    expect(durationText('x')).toBe('0 min');
  });
});
