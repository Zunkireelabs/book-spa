import { useCallback, useSyncExternalStore } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { formatClockTime } from '../utils/clockTime';
import { readUse24h, writeUse24h, subscribe } from '../utils/clockPref';

// [use24h, setUse24h(boolean | (prev) => boolean)]. Every open component updates at once.
export function useUse24h() {
  let profile = null;
  try { profile = useAuth().profile; } catch { /* no AuthProvider (isolated render): 12h */ }
  const value = useSyncExternalStore(subscribe, () => readUse24h(profile), () => false);
  const set = useCallback((updater) => writeUse24h(profile, typeof updater === 'function' ? updater(readUse24h(profile)) : updater), [profile]);
  return [value, set];
}

// clock(t) for components that only need to show a time.
export function useClock() {
  const [use24h] = useUse24h();
  return useCallback((t) => formatClockTime(t, use24h), [use24h]);
}
