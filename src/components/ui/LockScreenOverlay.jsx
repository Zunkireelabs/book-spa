import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Icon from '../AppIcon';
import BrandMark from './BrandMark';
import { useAuth } from '../../contexts/AuthContext';
import { useLock } from '../../contexts/LockContext';

// Full-viewport lock screen. Mounted by ProtectedRoute whenever isLocked is
// true — see LockContext.jsx for the (deliberately limited) security model.
const LockScreenOverlay = () => {
  const { profile, signOut } = useAuth();
  const { unlock, clearLock, maxFailedAttempts } = useLock();
  const { orgSlug: urlOrgSlug } = useParams();
  const navigate = useNavigate();

  const [pin, setPin] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState('');

  const overlayRef = useRef(null);
  const inputRef = useRef(null);

  // Autofocus the PIN field on mount.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Lock background scroll while the overlay is mounted.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  // Trap focus inside the overlay (Tab / Shift+Tab cycle) and swallow
  // Escape — there is no close button and no click-outside dismiss.
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (e.key !== 'Tab') return;

    const focusable = Array.from(
      overlayRef.current?.querySelectorAll(
        'button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])'
      ) || []
    ).filter((el) => !el.disabled);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  const orgSlug = urlOrgSlug || profile?.organizations?.slug;
  const userName = profile?.full_name || 'Staff Member';
  const userRole = profile?.role || 'staff';
  const isPinValid = /^\d{4}$/.test(pin);

  const handlePinChange = (e) => {
    const digitsOnly = e.target.value.replace(/\D/g, '').slice(0, 4);
    setPin(digitsOnly);
    if (error) setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isPinValid || isVerifying) return;

    setIsVerifying(true);
    setError('');

    const result = await unlock(pin);

    if (!result.success) {
      setPin('');
      if (result.signedOut) {
        // Too many failed attempts — unlock() already signed out; the app
        // will fall through to the login redirect on its own.
        setError('Too many failed attempts. Signed out for security.');
      } else {
        // Use the post-increment count unlock() just returned — the
        // failedAttempts value from context is still the pre-increment
        // render-scoped snapshot at this point.
        const remaining = Math.max(maxFailedAttempts - result.failedAttempts, 0);
        setError(`Incorrect PIN — ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`);
      }
    }

    setIsVerifying(false);
  };

  const handleLoginAsSomeoneElse = async () => {
    // clearLock() reads `profile` — must run before signOut() wipes it,
    // otherwise the next person to log in on this browser (even via
    // password) re-syncs the stale '1' lock flag and is locked on sight.
    clearLock();
    await signOut();
    navigate(orgSlug ? `/${orgSlug}/login` : '/login', { replace: true });
  };

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="lock-screen-title"
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-lock bg-background flex items-center justify-center px-6"
    >
      <div className="w-full max-w-sm bg-surface rounded-spa-lg shadow-spa-modal border border-border p-8 flex flex-col items-center text-center">
        <BrandMark className="h-8 w-auto mb-6" />

        <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <Icon name="Lock" size={24} className="text-primary" />
        </div>

        <h1 id="lock-screen-title" className="font-heading font-heading-semibold text-lg text-text-primary">
          Screen Locked
        </h1>
        <p className="font-body font-body-normal text-sm text-text-secondary mt-1 mb-6">
          {userName} <span className="capitalize">({userRole})</span>
        </p>

        <form onSubmit={handleSubmit} className="w-full">
          <label htmlFor="lock-pin-field" className="sr-only">Enter your 4-digit PIN</label>
          <input
            ref={inputRef}
            id="lock-pin-field"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            value={pin}
            onChange={handlePinChange}
            disabled={isVerifying}
            placeholder="Enter PIN"
            aria-describedby={error ? 'lock-pin-error' : undefined}
            className={`w-full px-3.5 py-3 text-center text-lg tracking-[0.5em] font-data bg-surface border rounded-[10px] text-text-primary placeholder:text-text-secondary placeholder:tracking-normal placeholder:text-sm outline-none transition-all duration-150 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-background disabled:cursor-not-allowed ${
              error ? 'border-error' : 'border-border'
            }`}
          />

          {error && (
            <p id="lock-pin-error" className="mt-2 text-sm font-body font-body-normal text-error">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={!isPinValid || isVerifying}
            className="mt-4 w-full px-4 py-3 rounded-spa bg-primary text-white font-body font-body-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isVerifying ? (
              <>
                <Icon name="Loader2" size={16} className="animate-spin" />
                Verifying…
              </>
            ) : (
              'Unlock'
            )}
          </button>
        </form>

        <div className="w-full border-t border-border my-6" />

        <button
          type="button"
          onClick={handleLoginAsSomeoneElse}
          className="font-body font-body-medium text-sm text-text-secondary hover:text-primary transition-colors underline underline-offset-2"
        >
          Log in as someone else
        </button>
      </div>
    </div>
  );
};

export default LockScreenOverlay;
