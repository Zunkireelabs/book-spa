// Soft notification chime via Web Audio (no audio files). Browsers block audio until the first user gesture, so
// callers check isSoundUnlocked() and show the "Sound is off until you click" pill instead.
let ctx = null;
let unlocked = false;
const listeners = new Set();

function getCtx() {
  if (!ctx) {
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

export const isSoundUnlocked = () => unlocked;
export const onSoundUnlock = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

/** Call once: the first click / key press resumes audio and notifies listeners. */
export function installSoundUnlock() {
  if (typeof window === 'undefined') return () => {};
  const unlock = () => {
    const c = getCtx();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
    unlocked = true;
    listeners.forEach((fn) => fn());
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  return () => {
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
  };
}

export const SOUND_CHOICES = [
  { value: 'chime', label: 'Soft chime' },
  { value: 'ding', label: 'Bright ding' },
  { value: 'twotone', label: 'Two-tone' },
  { value: 'marimba', label: 'Marimba' },
  { value: 'woof', label: 'Woof! 🐶' },
];
export const DEFAULT_SOUND = 'chime';
/** Anything unknown (old row, bad value) falls back to the default chime. */
export const normalizeSound = (v) => (SOUND_CHOICES.some((s) => s.value === v) ? v : DEFAULT_SOUND);

// All sounds are synthesised (no audio files), peak gain ~0.12 and under 1.2 s so loudness stays similar.
const PEAK = 0.12;

function tone(c, t, { freq, type = 'sine', dur = 0.45, peak = PEAK, attack = 0.02, harmonic = 0 }) {
  const parts = [[freq, peak]];
  if (harmonic) parts.push([freq * harmonic, peak * 0.35]);
  parts.forEach(([f, pk]) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(pk, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  });
}

// A short dog bark: a sawtooth whose pitch drops fast plus a noise burst, both band-passed.
function bark(c, t) {
  const dur = 0.16;
  const osc = c.createOscillator();
  const filt = c.createBiquadFilter();
  const gain = c.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(520, t);
  osc.frequency.exponentialRampToValueAtTime(190, t + dur);
  filt.type = 'bandpass';
  filt.frequency.value = 900;
  filt.Q.value = 1.2;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(PEAK * 1.3, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(filt).connect(gain).connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);

  const len = Math.floor(c.sampleRate * 0.05);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  const ng = c.createGain();
  src.buffer = buf;
  ng.gain.value = PEAK * 0.8;
  src.connect(filt);
  filt.connect(ng).connect(c.destination);
  src.start(t);
}

// Per-category pitch for the default chime: slightly different so people learn what they heard.
const NOTES = {
  bookings: [659.25, 880],
  approvals: [587.33, 783.99],
  team: [523.25, 659.25],
  stock: [440, 554.37],
  guests: [493.88, 622.25],
};

const PLAYERS = {
  chime: (c, t, category) => {
    const [a, b] = NOTES[category] || NOTES.bookings;
    tone(c, t, { freq: a });
    tone(c, t + 0.14, { freq: b });
  },
  ding: (c, t) => tone(c, t, { freq: 1318.5, dur: 0.7, harmonic: 2 }),
  twotone: (c, t) => {
    tone(c, t, { freq: 698.5, dur: 0.5, harmonic: 2 });
    tone(c, t + 0.4, { freq: 523.25, dur: 0.6, harmonic: 2 });
  },
  marimba: (c, t) => [523.25, 659.25, 783.99].forEach((f, i) => tone(c, t + i * 0.13, { freq: f, dur: 0.3, attack: 0.005, harmonic: 4 })),
  woof: (c, t) => { bark(c, t); bark(c, t + 0.24); },
};

/** The player for a stored choice (unknown -> chime). Exposed so the mapping can be unit-tested. */
export const playerFor = (choice) => PLAYERS[normalizeSound(choice)];

export function playSound(choice = DEFAULT_SOUND, category = 'bookings') {
  const c = getCtx();
  if (!c || !unlocked || c.state !== 'running') return false;
  playerFor(choice)(c, c.currentTime + 0.01, category);
  return true;
}

/** Back-compat: the original per-category chime. */
export const playChime = (category = 'bookings') => playSound('chime', category);
