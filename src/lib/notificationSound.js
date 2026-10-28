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

// One short two-note chime per category: a slightly different pitch so people learn what they heard.
const NOTES = {
  bookings: [659.25, 880],
  approvals: [587.33, 783.99],
  team: [523.25, 659.25],
  stock: [440, 554.37],
  guests: [493.88, 622.25],
};

export function playChime(category = 'bookings') {
  const c = getCtx();
  if (!c || !unlocked || c.state !== 'running') return false;
  const [a, b] = NOTES[category] || NOTES.bookings;
  const t0 = c.currentTime + 0.01;
  [[a, 0], [b, 0.14]].forEach(([freq, offset]) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0 + offset);
    gain.gain.exponentialRampToValueAtTime(0.12, t0 + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.45);
    osc.connect(gain).connect(c.destination);
    osc.start(t0 + offset);
    osc.stop(t0 + offset + 0.5);
  });
  return true;
}
