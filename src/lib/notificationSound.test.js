import { describe, it, expect } from 'vitest';
import { SOUND_CHOICES, DEFAULT_SOUND, normalizeSound, playerFor } from './notificationSound';
import { DEFAULT_SETTINGS } from './notificationRules';

describe('sound choice', () => {
  it('defaults to the chime', () => {
    expect(DEFAULT_SOUND).toBe('chime');
    expect(DEFAULT_SETTINGS.sound_choice).toBe('chime');
  });
  it('offers the five sounds', () => {
    expect(SOUND_CHOICES.map((s) => s.value)).toEqual(['chime', 'ding', 'twotone', 'marimba', 'woof']);
  });
  it('maps each choice to its own player and falls back to the chime', () => {
    const fns = SOUND_CHOICES.map((s) => playerFor(s.value));
    expect(new Set(fns).size).toBe(5);
    expect(playerFor('nope')).toBe(playerFor('chime'));
    expect(playerFor(null)).toBe(playerFor('chime'));
    expect(normalizeSound('woof')).toBe('woof');
  });
});
