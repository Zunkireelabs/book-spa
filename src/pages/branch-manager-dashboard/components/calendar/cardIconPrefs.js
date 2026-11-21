import { useSyncExternalStore } from 'react';

// ZNLY-271: which card icons are on, saved per device. Module-level store so every card and the legend stay in sync.
const KEY = 'zenly.calendar.cardIcons';
const EMPTY = Object.freeze({});
let state = EMPTY;
const listeners = new Set();

try {
  const raw = window.localStorage.getItem(KEY);
  const parsed = raw ? JSON.parse(raw) : null;
  if (parsed && typeof parsed === 'object') state = Object.freeze({ ...parsed });
} catch { /* storage blocked: all icons on */ }

export function setCardIconEnabled(key, enabled) {
  state = Object.freeze({ ...state, [key]: !!enabled });
  try { window.localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
  listeners.forEach(l => l());
}

const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const getSnapshot = () => state;

// { pay: false, ... } — a missing key means ON.
export function useCardIconPrefs() {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}
