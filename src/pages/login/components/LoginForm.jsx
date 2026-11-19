import { friendlyError } from '../../../utils/friendlyError';
import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import { useAuth, getDashboardPath, getSafeRedirect } from '../../../contexts/AuthContext';
import { loginWithPin } from '../../../services/pinAuth';

// Helper: get saved emails for an org from localStorage
function getSavedEmails(orgSlug) {
  try {
    const key = `zenly_saved_emails_${orgSlug || 'default'}`;
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch { return []; }
}

// Helper: save email for an org to localStorage
function saveEmail(orgSlug, email) {
  const key = `zenly_saved_emails_${orgSlug || 'default'}`;
  const emails = getSavedEmails(orgSlug);
  if (!emails.includes(email)) {
    emails.unshift(email);
    // Keep max 5 saved emails
    localStorage.setItem(key, JSON.stringify(emails.slice(0, 5)));
  }
}

const LoginForm = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { orgSlug: urlOrgSlug } = useParams();
  const { signIn, user, profile } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState('password'); // presentational only: submit still auto-detects a 4-digit PIN
  const [savedEmails, setSavedEmails] = useState([]);
  const [showSavedEmails, setShowSavedEmails] = useState(false);

  // Load saved emails on mount
  useEffect(() => {
    setSavedEmails(getSavedEmails(urlOrgSlug));
  }, [urlOrgSlug]);

  // Redirect if already authenticated
  useEffect(() => {
    if (user && profile) {
      const userOrgSlug = profile?.organizations?.slug;
      navigate(getSafeRedirect(location.state?.from, userOrgSlug) || getDashboardPath(profile.role, userOrgSlug), { replace: true });
    }
  }, [user, profile, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  const validateForm = () => {
    const newErrors = {};

    if (!email) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      newErrors.email = 'Please enter a valid email';
    }

    if (!password) {
      newErrors.password = 'Password or PIN is required';
    } else if (password.length < 4) {
      newErrors.password = 'Must be at least 4 characters';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) return;

    setIsLoading(true);
    setErrors({});

    try {
      const inputValue = password.trim();
      const isPin = /^\d{4}$/.test(inputValue);

      if (isPin) {
        // PIN login flow
        const pinResult = await loginWithPin(email, inputValue, urlOrgSlug);
        if (!pinResult.success) {
          setErrors({ submit: pinResult.error });
          setIsLoading(false);
          return;
        }

        // PIN login successful — session is set, fetch profile
        saveEmail(urlOrgSlug, email);
        // Reload to let AuthContext pick up the session. urlOrgSlug should always be
        // present here (this form only renders on the org-scoped /:orgSlug/login route)
        // — if it's ever missing, don't guess an org; send back to the org finder.
        window.location.href = urlOrgSlug ? (getSafeRedirect(location.state?.from, urlOrgSlug) || getDashboardPath(null, urlOrgSlug)) : '/login';
        return;
      }

      // Standard password login
      const result = await signIn(email, inputValue);
      if (result.profile) {
        // Save email on successful login
        saveEmail(urlOrgSlug, email);

        const userOrgSlug = result.profile?.organizations?.slug;

        if (urlOrgSlug && userOrgSlug && urlOrgSlug !== userOrgSlug) {
          navigate(getDashboardPath(result.profile.role, userOrgSlug), { replace: true });
          return;
        }

        navigate(getSafeRedirect(location.state?.from, userOrgSlug) || getDashboardPath(result.profile.role, userOrgSlug), { replace: true });
        return;
      }
      setErrors({
        submit: 'Login succeeded but your staff profile was not found. Please contact an administrator.'
      });
    } catch (error) {
      // Infrastructure failure (DB unreachable — 503/timeout, or an auth service
      // 5xx) must not read as "wrong password" or "contact an administrator".
      // Tell the user it's the server, and to retry.
      const authStatus = Number(error?.status);
      const isServiceDown =
        error?.name === 'ServiceUnavailableError' ||
        error?.isServiceUnavailable === true ||
        authStatus >= 500 ||
        error?.message === 'Failed to fetch';

      setErrors({
        submit: isServiceDown
          ? "We're having trouble reaching the server right now. Please wait a moment and try again."
          : error.message === 'Invalid login credentials'
          ? 'Invalid email or password/PIN. Please try again.'
          : friendlyError(error, 'An unexpected error occurred. Please try again.')
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectSavedEmail = (savedEmail) => {
    setEmail(savedEmail);
    setShowSavedEmails(false);
    // Focus password field
    setTimeout(() => document.getElementById('password-field')?.focus(), 100);
  };

  const handleRemoveSavedEmail = (e, emailToRemove) => {
    e.stopPropagation();
    const key = `zenly_saved_emails_${urlOrgSlug || 'default'}`;
    const updated = savedEmails.filter(e => e !== emailToRemove);
    localStorage.setItem(key, JSON.stringify(updated));
    setSavedEmails(updated);
  };

  const isDisabled = isLoading;
  const inputBase = 'block h-12 w-full rounded-[10px] border bg-white px-3.5 text-[15px] text-[#111] outline-none placeholder:text-[#888] focus:border-[#111] disabled:cursor-not-allowed disabled:bg-[#F1F1F1]';
  const isPinMode = mode === 'pin';

  return (
    <div className="w-full">
      {/* Org Confirmation Chip */}
      {urlOrgSlug && (
        <div className="mb-3 flex items-center justify-between rounded-[10px] border border-[#dcdcdc] bg-[#F7F7F7] px-3.5 py-3 text-sm">
          <div className="flex items-center gap-2">
            <Icon name="CheckCircle" size={16} className="text-[#111]" />
            <span className="font-medium">{urlOrgSlug}</span>
          </div>
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="text-[13px] text-[#555] underline underline-offset-2 hover:text-[#111]"
          >
            Change
          </button>
        </div>
      )}

      {/* Error Message */}
      {errors.submit && (
        <div role="alert" className="mb-3.5 rounded-[10px] bg-[#FDECEC] px-3.5 py-3 text-sm leading-snug text-[#B42318]">
          {errors.submit}
        </div>
      )}

      {/* Password / PIN toggle (label + keypad only; login logic unchanged) */}
      <div className="mb-3 inline-flex rounded-[10px] bg-[#F1F1F1] p-[3px]" role="tablist">
        {[['password', 'Password'], ['pin', 'PIN']].map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={mode === key}
            onClick={() => setMode(key)}
            disabled={isDisabled}
            className={`rounded-lg px-4 py-1.5 text-[13px] transition-colors ${
              mode === key ? 'bg-white font-medium text-[#111] shadow-[0_1px_2px_rgba(0,0,0,0.13)]' : 'text-[#555]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} autoComplete="off">
        <div className="mb-3">
          <div className="relative">
            <input
              type="text"
              autoComplete="off"
              name="login-email-field"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setShowSavedEmails(true);
                if (errors.email) setErrors(prev => ({ ...prev, email: '' }));
              }}
              onFocus={() => setShowSavedEmails(true)}
              onBlur={() => setTimeout(() => setShowSavedEmails(false), 200)}
              onKeyDown={(e) => {
                // Tab to autocomplete first matching saved email
                if (e.key === 'Tab' && showSavedEmails) {
                  const matches = savedEmails.filter(se => se.toLowerCase().includes(email.toLowerCase()) && se !== email);
                  if (matches.length > 0) {
                    e.preventDefault();
                    handleSelectSavedEmail(matches[0]);
                  }
                }
              }}
              placeholder="Enter your email address"
              disabled={isDisabled}
              className={`${inputBase} ${errors.email ? 'border-error' : 'border-[#dcdcdc]'}`}
            />
            {/* Autocomplete dropdown for saved emails */}
            {showSavedEmails && savedEmails.filter(se => (!email || se.toLowerCase().includes(email.toLowerCase())) && se !== email).length > 0 && (
              <div className="absolute z-dropdown mt-1 w-full overflow-hidden rounded-[10px] border border-[#dcdcdc] bg-white shadow-spa-elevated">
                {savedEmails.filter(se => (!email || se.toLowerCase().includes(email.toLowerCase())) && se !== email).map((savedEmail) => (
                  <button
                    key={savedEmail}
                    type="button"
                    onMouseDown={() => handleSelectSavedEmail(savedEmail)}
                    className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm hover:bg-[#F1F1F1]"
                  >
                    <Icon name="User" size={14} className="text-[#777]" />
                    {savedEmail}
                  </button>
                ))}
              </div>
            )}
          </div>
          {errors.email && <p className="mt-1.5 text-xs text-error">{errors.email}</p>}
        </div>

        <div className="mb-3">
          <div className="relative">
            <input
              id="password-field"
              type={showPassword ? 'text' : 'password'}
              inputMode={isPinMode ? 'numeric' : undefined}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errors.password) setErrors(prev => ({ ...prev, password: '' }));
              }}
              placeholder={isPinMode ? 'Enter your PIN' : 'Enter your password'}
              disabled={isDisabled}
              className={`${inputBase} pr-16 ${errors.password ? 'border-error' : 'border-[#dcdcdc]'}`}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              disabled={isDisabled}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[13px] text-[#777] hover:text-[#111] disabled:opacity-50"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          {errors.password && <p className="mt-1.5 text-xs text-error">{errors.password}</p>}
        </div>

        {/* Remember Me & Forgot Password */}
        <div className="mb-4 mt-0.5 flex items-center justify-between text-[13px] text-[#555]">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="h-4 w-4 rounded border-[#dcdcdc] text-[#111] focus:ring-[#111]/20"
            />
            Remember me
          </label>
          <button type="button" className="font-medium text-[#111] underline underline-offset-2">
            Forgot password?
          </button>
        </div>

        <button
          type="submit"
          disabled={isDisabled}
          className="h-12 w-full rounded-[10px] bg-[#111] text-[15px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? 'Signing in...' : 'Login'}
        </button>
      </form>

      {/* Social sign-in: disabled for now (no handlers) */}
      <div className="my-5 flex items-center gap-3.5 text-[13px] text-[#666]">
        <span className="h-px flex-1 bg-[#e3e3e3]" />
        Or continue with
        <span className="h-px flex-1 bg-[#e3e3e3]" />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {[
          ['Apple', <svg key="a" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>],
          ['Google', <b key="g" className="text-[#4285F4]">G</b>],
          ['Microsoft', <svg key="m" width="16" height="16" viewBox="0 0 16 16"><path fill="#F25022" d="M0 0h7.5v7.5H0z"/><path fill="#7FBA00" d="M8.5 0H16v7.5H8.5z"/><path fill="#00A4EF" d="M0 8.5h7.5V16H0z"/><path fill="#FFB900" d="M8.5 8.5H16V16H8.5z"/></svg>],
        ].map(([name, icon]) => (
          <div
            key={name}
            tabIndex={0}
            role="button"
            aria-disabled="true"
            aria-label={`${name} sign-in — coming soon`}
            className="group relative flex h-12 cursor-not-allowed select-none items-center justify-center gap-2 rounded-[10px] bg-[#F1F1F1] text-sm font-medium opacity-55 outline-none"
          >
            {icon} {name}
            <span className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-dropdown hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-[#111] px-2 py-1 text-xs text-white group-hover:block group-focus:block">
              Coming soon
            </span>
          </div>
        ))}
      </div>

      {/* Demo Credentials - Dev Only */}
      {import.meta.env.DEV && (
        <div className="mt-6 rounded-[10px] border border-[#dcdcdc] bg-[#F7F7F7] p-4">
          <div className="mb-2 flex items-center gap-2">
            <Icon name="Info" size={16} className="text-[#777]" />
            <span className="text-sm font-medium">Demo Credentials</span>
          </div>
          <div className="space-y-1 font-mono text-xs text-[#555]">
            <div><strong>Staff:</strong> staff@zenly.app / Zennly@Staff123</div>
            <div><strong>Manager:</strong> manager@zenly.app / Zennly@Manager123</div>
            <div><strong>Admin:</strong> admin@zenly.app / Zennly@Admin123</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LoginForm;
