import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTenant } from 'contexts/TenantContext';
import { useCustomerAuth } from 'contexts/CustomerAuthContext';

const CustomerForgotPassword = () => {
  const { orgSlug } = useParams();
  const { orgName } = useTenant();
  const { resetPassword } = useCustomerAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      setError('Please enter a valid email');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      await resetPassword(email, `${window.location.origin}/${orgSlug}/reset-password`);
      setSubmitted(true);
    } catch (err) {
      setError(err.message || 'An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-page min-h-screen bg-background flex flex-col">
      <header className="flex-shrink-0 px-6 md:px-8 py-5 flex items-center">
        <span className="text-lg font-semibold text-text-primary tracking-tight">
          {orgName || 'Zennly'}
        </span>
      </header>

      <main className="flex-1 flex flex-col items-center px-5 py-10 overflow-y-auto">
        <div className="w-full max-w-[380px] mx-auto flex flex-col items-center">
          <h1 className="text-[28px] font-semibold text-text-primary mb-2 text-center tracking-tight">
            Reset your password
          </h1>
          <p className="text-[15px] text-text-secondary mb-8 text-center">
            {submitted
              ? 'Check your email for a reset link'
              : "Enter your email and we'll send you a reset link"}
          </p>

          <div className="w-full">
            {submitted ? (
              <p className="text-center text-sm text-text-secondary">
                <Link
                  to={`/${orgSlug}/customer-login`}
                  className="text-text-primary font-medium underline underline-offset-2 hover:opacity-80 transition-opacity"
                >
                  Back to sign in
                </Link>
              </p>
            ) : (
              <form onSubmit={handleSubmit} autoComplete="off">
                {error && (
                  <div className="mb-4 p-3 bg-error/10 text-error rounded-[10px] text-sm font-medium">
                    {error}
                  </div>
                )}

                <div className="mb-4">
                  <input
                    type="text"
                    autoComplete="off"
                    name="customer-forgot-password-email-field"
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
                  {isLoading ? 'Sending...' : 'Send reset link'}
                </button>

                <p className="mt-5 text-center text-sm text-text-secondary">
                  <Link
                    to={`/${orgSlug}/customer-login`}
                    className="text-text-primary font-medium underline underline-offset-2 hover:opacity-80 transition-opacity"
                  >
                    Back to sign in
                  </Link>
                </p>
              </form>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default CustomerForgotPassword;
