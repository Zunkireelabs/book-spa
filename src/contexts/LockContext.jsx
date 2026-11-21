// This is a walk-away / shoulder-surf deterrent, not a security boundary.
// The locked flag is plain client-side state — anyone with devtools can
// clear localStorage and dismiss it, and the underlying Supabase session
// token sits in localStorage the whole time regardless of whether the
// screen is "locked". It stops a passerby from poking at an unattended
// screen; it does not stop anyone with access to the browser's storage.
// Real enforcement of this would need server-side session state, which
// is out of scope here.
import React, { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { loginWithPin } from '../services/pinAuth';
import { fetchOwnHasPin } from '../services/api';

const LockContext = createContext(null);

export const useLock = () => {
  const context = useContext(LockContext);
  if (!context) {
    throw new Error('useLock must be used within a LockProvider');
  }
  return context;
};

const MAX_FAILED_ATTEMPTS = 5;

function lockedKey(profile) {
  return profile ? `bookspa_screen_locked_${profile.org_id}_${profile.id}` : null;
}

function attemptsKey(profile) {
  return profile ? `bookspa_screen_locked_attempts_${profile.org_id}_${profile.id}` : null;
}

export const LockProvider = ({ children }) => {
  const { profile, signOut } = useAuth();

  const [isLocked, setIsLocked] = useState(() => {
    if (!profile) return false;
    try {
      return localStorage.getItem(lockedKey(profile)) === '1';
    } catch {
      return false;
    }
  });

  const [failedAttempts, setFailedAttempts] = useState(() => {
    if (!profile) return 0;
    try {
      const raw = localStorage.getItem(attemptsKey(profile));
      const n = parseInt(raw, 10);
      return Number.isFinite(n) && n > 0 ? n : 0;
    } catch {
      return 0;
    }
  });

  // `profile` is populated asynchronously (AuthContext fetches it after the
  // session is restored), so the lazy useState initializers above almost
  // always run before it exists and see `profile: null`. Re-sync from
  // storage the moment a profile shows up (first load, or switching to a
  // different signed-in user) so a lock set in an earlier browser session
  // is actually restored, instead of silently defaulting to unlocked.
  const syncedProfileIdRef = useRef(null);
  useEffect(() => {
    const profileId = profile?.id || null;
    if (profileId === syncedProfileIdRef.current) return;
    syncedProfileIdRef.current = profileId;

    if (!profile) {
      setIsLocked(false);
      setFailedAttempts(0);
      return;
    }

    try {
      setIsLocked(localStorage.getItem(lockedKey(profile)) === '1');
    } catch {
      setIsLocked(false);
    }
    try {
      const raw = localStorage.getItem(attemptsKey(profile));
      const n = parseInt(raw, 10);
      setFailedAttempts(Number.isFinite(n) && n > 0 ? n : 0);
    } catch {
      setFailedAttempts(0);
    }
  }, [profile]);

  // ZNLY-210: does this person have a PIN? The lock screen needs one to come back from. null = not known yet / could not be checked.
  // Not known counts as "no": we would rather leave Lock off for a moment than lock someone out of the app.
  const [hasPin, setHasPin] = useState(null);
  const refreshHasPin = useCallback(async () => {
    if (!profile) { setHasPin(null); return null; }
    const { data } = await fetchOwnHasPin();
    setHasPin(data);
    return data;
  }, [profile]);
  useEffect(() => {
    refreshHasPin();
    const onFocus = () => { refreshHasPin(); };   // a manager may have just set their PIN
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshHasPin]);

  // A lock left in storage (set before this check existed, or before their PIN was removed) must not keep out someone with no PIN.
  useEffect(() => {
    if (profile && hasPin === false && isLocked) {
      try { localStorage.removeItem(lockedKey(profile)); localStorage.removeItem(attemptsKey(profile)); } catch { /* ignore */ }
      setIsLocked(false);
      setFailedAttempts(0);
    }
  }, [profile, hasPin, isLocked]);

  const lock = useCallback(() => {
    if (!profile || hasPin !== true) return;   // never lock someone who has no PIN to come back with
    setIsLocked(true);
    setFailedAttempts(0);
    try { localStorage.setItem(lockedKey(profile), '1'); } catch { /* ignore */ }
    try { localStorage.removeItem(attemptsKey(profile)); } catch { /* ignore */ }
  }, [profile, hasPin]);

  const clearLockStorage = useCallback(() => {
    if (!profile) return;
    try { localStorage.removeItem(lockedKey(profile)); } catch { /* ignore */ }
    try { localStorage.removeItem(attemptsKey(profile)); } catch { /* ignore */ }
  }, [profile]);

  const unlock = useCallback(async (pin) => {
    if (!profile) return { success: false, error: 'No active profile.' };

    const orgSlug = profile?.organizations?.slug;
    const result = await loginWithPin(profile.email, pin, orgSlug);

    // ZNLY-210: only a real "wrong PIN" counts toward the attempts. A dropped connection, a server error or a failed session
    // is "can't check right now": say so, keep the count where it was.
    if (!result.success && result.kind !== 'wrong_pin') {
      return { success: false, error: result.error, unavailable: true, failedAttempts };
    }

    if (result.success) {
      setIsLocked(false);
      setFailedAttempts(0);
      clearLockStorage();
      return { success: true };
    }

    const nextAttempts = failedAttempts + 1;
    setFailedAttempts(nextAttempts);
    try { localStorage.setItem(attemptsKey(profile), String(nextAttempts)); } catch { /* ignore */ }

    if (nextAttempts >= MAX_FAILED_ATTEMPTS) {
      // Too many wrong PINs in a row — stop guessing and force a full
      // re-login instead of leaving the locked screen up indefinitely.
      clearLockStorage();
      setIsLocked(false);
      setFailedAttempts(0);
      await signOut();
      return { success: false, error: result.error, signedOut: true, failedAttempts: nextAttempts };
    }

    return { success: false, error: result.error, failedAttempts: nextAttempts };
  }, [profile, failedAttempts, clearLockStorage, signOut]);

  // Exposed so "Log in as someone else" can drop the lock BEFORE signing out —
  // clearLockStorage reads `profile`, which signOut() wipes, so ordering matters
  // at the call site (see LockScreenOverlay.handleLoginAsSomeoneElse).
  const clearLock = useCallback(() => {
    clearLockStorage();
    setIsLocked(false);
    setFailedAttempts(0);
  }, [clearLockStorage]);

  const value = useMemo(() => ({
    isLocked: !!profile && isLocked,
    hasPin,
    refreshHasPin,
    lock,
    unlock,
    clearLock,
    failedAttempts,
    maxFailedAttempts: MAX_FAILED_ATTEMPTS,
  }), [profile, isLocked, hasPin, refreshHasPin, lock, unlock, clearLock, failedAttempts]);

  return (
    <LockContext.Provider value={value}>
      {children}
    </LockContext.Provider>
  );
};
