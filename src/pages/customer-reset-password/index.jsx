import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTenant } from 'contexts/TenantContext';
import { useCustomerAuth } from 'contexts/CustomerAuthContext';
import { supabaseCustomer } from 'lib/supabase';

const CustomerResetPassword = () => {
  const { orgSlug } = useParams();
  const { orgName } = useTenant();
  const { updatePassword } = useCustomerAuth();
  const navigate = useNavigate();
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabaseCustomer.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setRecoveryReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!password || password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      await updatePassword(password);
      setSuccess(true);
      setTimeout(() => navigate(`/${orgSlug}/customer-login`, { replace: true }), 1500);
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
            Set a new password
          </h1>

          <div className="w-full">
            {success ? (
              <p className="text-center text-sm text-text-secondary">
                Password updated. Redirecting to sign in...
              </p>
            ) : !recoveryReady ? (
              <p className="text-center text-sm text-text-secondary">
                Waiting for reset link verification...
              </p>
            ) : (
              <form onSubmit={handleSubmit} autoComplete="off">
                {error && (
                  <div className="mb-4 p-3 bg-error/10 text-error rounded-[10px] text-sm font-medium">
                    {error}
                  </div>
                )}

                <div className="mb-3">
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (error) setError('');
                    }}
                    placeholder="New password"
                    disabled={isLoading}
                    className="w-full px-3.5 py-3 text-sm bg-surface border border-border rounded-[10px] text-text-primary placeholder:text-text-secondary outline-none transition-all duration-150 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-background disabled:cursor-not-allowed"
                  />
                </div>

                <div className="mb-4">
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      if (error) setError('');
                    }}
                    placeholder="Confirm new password"
                    disabled={isLoading}
                    className="w-full px-3.5 py-3 text-sm bg-surface border border-border rounded-[10px] text-text-primary placeholder:text-text-secondary outline-none transition-all duration-150 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-background disabled:cursor-not-allowed"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3 px-5 bg-primary text-primary-foreground rounded-[10px] text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoading ? 'Updating...' : 'Update password'}
                </button>
              </form>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default CustomerResetPassword;
