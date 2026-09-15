import React, { useState, useEffect, useRef } from 'react';
import { useCustomerAuth } from 'contexts/CustomerAuthContext';

const RESEND_COOLDOWN_SECONDS = 30;

// Sibling of customer-login/components/OtpCodeStep.jsx for the profile
// email-change flow — same 6-digit-code UX, but calls requestEmailChange/
// confirmEmailChange (type: 'email_change') instead of the login flow's
// requestOtp/verifyOtp (type: 'email'). Not a drop-in reuse of OtpCodeStep:
// that component is hardwired to login semantics (shouldCreateUser, orgId).
const EmailChangeOtpStep = ({ newEmail, onVerified, onBack }) => {
  const { requestEmailChange, confirmEmailChange } = useCustomerAuth();
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
      const account = await confirmEmailChange(newEmail, code);
      onVerified(account);
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
      await requestEmailChange(newEmail);
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
        <div className="mb-3 p-2.5 bg-error/10 text-error rounded-spa text-sm font-medium">
          {error}
        </div>
      )}

      <p className="mb-4 text-sm text-text-secondary">
        Enter the 6-digit code we sent to{' '}
        <span className="text-text-primary font-medium">{newEmail}</span>
      </p>

      <form onSubmit={handleSubmit} autoComplete="off">
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
          className="w-full h-10 px-3 mb-3 text-center text-base tracking-[0.4em] bg-surface border border-border rounded-spa text-text-primary placeholder:text-text-secondary placeholder:tracking-[0.4em] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-background"
        />

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={isVerifying || code.length !== 6}
            className="px-3 py-1.5 rounded-spa bg-primary text-white text-xs font-body font-body-medium hover:bg-primary/90 disabled:opacity-50 spa-transition-fast"
          >
            {isVerifying ? 'Verifying...' : 'Verify'}
          </button>
          <button
            type="button"
            onClick={onBack}
            disabled={isVerifying}
            className="px-3 py-1.5 rounded-spa text-xs font-body font-body-medium text-text-secondary hover:bg-background spa-transition-fast"
          >
            Back
          </button>
        </div>
      </form>

      <button
        type="button"
        onClick={handleResend}
        disabled={isResending || cooldown > 0}
        className="mt-3 text-xs text-text-secondary underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
      >
        {isResending ? 'Resending...' : cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
      </button>
    </div>
  );
};

export default EmailChangeOtpStep;
