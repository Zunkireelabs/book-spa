// The staff member's saved 12h/24h choice (localStorage only, same key the calendar toolbar always used, so nobody loses it).
let activeProfile = null; // set by AuthContext, so plain (non-React) text builders can read the same choice
export const setClockProfile = (p) => { activeProfile = p; };
const keyOf = (p) => (p?.org_id && p?.id ? `bookspa_calendar_use24h_${p.org_id}_${p.id}` : null);
export const readUse24h = (p = activeProfile) => { try { const k = keyOf(p); return k ? localStorage.getItem(k) === '1' : false; } catch { return false; } };
export const writeUse24h = (p, on) => { try { const k = keyOf(p); if (k) localStorage.setItem(k, on ? '1' : '0'); } catch { /* ignore */ } listeners.forEach((l) => l()); };
const listeners = new Set();
// Same tab via the listener set, other tabs via the 'storage' event.
export const subscribe = (cb) => { listeners.add(cb); window.addEventListener('storage', cb); return () => { listeners.delete(cb); window.removeEventListener('storage', cb); }; };
