import React, { useState, useEffect, useRef } from 'react';
import { useCustomerAuth } from 'contexts/CustomerAuthContext';

const RESEND_COOLDOWN_SECONDS = 30;

// Shared step-2 UI for both signup and login: enter the 6-digit code emailed
// via requestOtp(), verify it, offer a resend (cooldown-gated) and a way
// back to fix the email address. `resendPayload` is re-passed to
// requestOtp() on resend — signup needs shouldCreateUser/fullName/phone,
// login just needs shouldCreateUser: false.
const OtpCodeStep = ({ email, orgId, resendPayload, onVerified, onBack }) => {
  const { requestOtp, verifyOtp } = useCustomerAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (code.length !== 6) return;

    setIsVerifying(true);
    setError('');

    try {
      const result = await verifyOtp(email, code, orgId);
      onVerified(result);
    } catch (err) {
      setCode('');
      setError(
        err.message?.toLowerCase().includes('expired') || err.message?.toLowerCase().includes('invalid')
          ? 'Invalid or expired code. Please try again or resend.'
          : err.message || 'Could not verify the code. Please try again.'
      );
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResend = async () => {
    setIsResending(true);
    setError('');

    try {
      await requestOtp(email, resendPayload);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(err.message || 'Could not resend the code. Please try again.');
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div className="w-full">
      {error && (
        <div className="mb-4 p-3 bg-error/10 text-error rounded-[10px] text-sm font-medium">
          {error}
        </div>
      )}

      <p className="mb-5 text-center text-sm text-text-secondary">
        Enter the 6-digit code we sent to{' '}
        <span className="text-text-primary font-medium">{email}</span>
      </p>

      <form onSubmit={handleSubmit} autoComplete="off">
        <div className="mb-4">
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
              if (error) setError('');
            }}
            placeholder="000000"
            disabled={isVerifying}
            className="w-full px-3.5 py-3 text-center text-lg tracking-[0.5em] bg-surface border border-border rounded-[10px] text-text-primary placeholder:text-text-secondary placeholder:tracking-[0.5em] outline-none transition-all duration-150 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-background disabled:cursor-not-allowed"
          />
        </div>

        <button
          type="submit"
          disabled={isVerifying || code.length !== 6}
          className="w-full py-3 px-5 bg-primary text-primary-foreground rounded-[10px] text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isVerifying ? 'Verifying...' : 'Verify'}
        </button>
      </form>

      <div className="mt-5 flex items-center justify-center gap-1 text-sm text-text-secondary">
        <button
          type="button"
          onClick={handleResend}
          disabled={isResending || cooldown > 0}
          className="text-text-primary font-medium underline underline-offset-2 hover:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed disabled:no-underline"
        >
          {isResending ? 'Resending...' : cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
        </button>
      </div>

      <p className="mt-3 text-center text-sm text-text-secondary">
        <button
          type="button"
          onClick={onBack}
          className="text-text-primary font-medium underline underline-offset-2 hover:opacity-80 transition-opacity"
        >
          Change email
        </button>
      </p>
    </div>
  );
};

export default OtpCodeStep;
