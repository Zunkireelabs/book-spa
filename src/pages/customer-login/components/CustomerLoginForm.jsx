import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useCustomerAuth } from 'contexts/CustomerAuthContext';
import { useTenant } from 'contexts/TenantContext';
import OtpCodeStep from './OtpCodeStep';

const CustomerLoginForm = () => {
  const navigate = useNavigate();
  const { orgSlug } = useParams();
  const { orgId } = useTenant();
  const { requestOtp, customer, customerProfile } = useCustomerAuth();
  const [step, setStep] = useState('email'); // 'email' | 'code'
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const hasRedirected = useRef(false);

  // Single source of truth for the post-login redirect (also covers the
  // case where this page loads while already signed in). handleSubmit does
  // NOT navigate itself, to avoid a second, racing navigation.
  useEffect(() => {
    if (customer && customerProfile && !hasRedirected.current) {
      hasRedirected.current = true;
      navigate(`/${orgSlug}/account`, { replace: true });
    }
  }, [customer, customerProfile, orgSlug, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      setError('Please enter a valid email');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      await requestOtp(email, { shouldCreateUser: false });
      setStep('code');
    } catch (err) {
      setError(
        err.message?.toLowerCase().includes('signup')
          ? 'No account found for this email. Please sign up.'
          : err.message || 'An unexpected error occurred. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  if (step === 'code') {
    return (
      <OtpCodeStep
        email={email}
        orgId={orgId}
        resendPayload={{ shouldCreateUser: false }}
        onVerified={() => {
          // Redirect happens via the effect above once customer/customerProfile land.
        }}
        onBack={() => setStep('email')}
      />
    );
  }

  return (
    <div className="w-full">
      {error && (
        <div className="mb-4 p-3 bg-error/10 text-error rounded-[10px] text-sm font-medium">
          {error}
          {error.includes('sign up') && (
            <>
              {' '}
              <Link to={`/${orgSlug}/signup`} className="underline underline-offset-2">
                Sign up
              </Link>
            </>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} autoComplete="off">
        <div className="mb-4">
          <input
            type="text"
            autoComplete="off"
            name="customer-login-email-field"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (error) setError('');
            }}
            placeholder="Enter your email address"
            disabled={isLoading}
            className={`w-full px-3.5 py-3 text-sm bg-surface border rounded-[10px] text-text-primary placeholder:text-text-secondary outline-none transition-all duration-150 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-background disabled:cursor-not-allowed ${
              error ? 'border-error' : 'border-border'
            }`}
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-3 px-5 bg-primary text-primary-foreground rounded-[10px] text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? 'Sending code...' : 'Send code'}
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-text-secondary">
        Don't have an account?{' '}
        <Link
          to={`/${orgSlug}/signup`}
          className="text-text-primary font-medium underline underline-offset-2 hover:opacity-80 transition-opacity"
        >
          Sign up
        </Link>
      </p>
    </div>
  );
};

export default CustomerLoginForm;
