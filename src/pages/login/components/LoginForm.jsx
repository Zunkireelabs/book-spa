import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import { useAuth, getDashboardPath } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/supabase';

const LoginForm = () => {
  const navigate = useNavigate();
  const { orgSlug: urlOrgSlug } = useParams();
  const { signIn, user, profile } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(null);

  // Redirect if already authenticated
  useEffect(() => {
    if (user && profile) {
      const userOrgSlug = profile?.organizations?.slug;
      navigate(getDashboardPath(profile.role, userOrgSlug), { replace: true });
    }
  }, [user, profile, navigate]);

  const handleOAuth = async (provider) => {
    setOauthLoading(provider);
    setErrors({});

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;
    } catch (err) {
      setErrors({ submit: err.message || 'OAuth failed' });
      setOauthLoading(null);
    }
  };

  const validateForm = () => {
    const newErrors = {};

    if (!email) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      newErrors.email = 'Please enter a valid email';
    }

    if (!password) {
      newErrors.password = 'Password is required';
    } else if (password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters';
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
      const result = await signIn(email, password);
      if (result.profile) {
        const userOrgSlug = result.profile?.organizations?.slug;

        // If URL has an org slug and it doesn't match user's org, redirect to correct org
        if (urlOrgSlug && userOrgSlug && urlOrgSlug !== userOrgSlug) {
          navigate(getDashboardPath(result.profile.role, userOrgSlug), { replace: true });
          return;
        }

        navigate(getDashboardPath(result.profile.role, userOrgSlug), { replace: true });
        return;
      }
      setErrors({
        submit: 'Login succeeded but your staff profile was not found. Please contact an administrator.'
      });
    } catch (error) {
      setErrors({
        submit: error.message === 'Invalid login credentials'
          ? 'Invalid email or password. Please try again.'
          : error.message || 'An unexpected error occurred. Please try again.'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const isDisabled = isLoading || oauthLoading;

  return (
    <div className="w-full">
      {/* Org Confirmation Badge - shows when orgSlug is in URL */}
      {urlOrgSlug && (
        <div className="mb-5 flex items-center justify-between p-3 bg-success/10 border border-success/20 rounded-[10px]">
          <div className="flex items-center gap-2">
            <Icon name="CheckCircle" size={18} className="text-success" />
            <span className="text-sm font-medium text-text-primary">{urlOrgSlug}</span>
          </div>
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="text-sm text-text-secondary hover:text-primary transition-colors underline underline-offset-2"
          >
            Change
          </button>
        </div>
      )}

      {/* Error Message */}
      {errors.submit && (
        <div className="mb-4 p-3 bg-error/10 text-error rounded-[10px] text-sm font-medium">
          {errors.submit}
        </div>
      )}

      {/* OAuth Buttons */}
      <button
        type="button"
        onClick={() => handleOAuth('google')}
        disabled={isDisabled}
        className="w-full flex items-center justify-center gap-3 px-5 py-3 bg-surface border border-border rounded-[10px] text-sm font-medium text-text-primary hover:bg-background transition-all duration-150 mb-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <svg viewBox="0 0 24 24" width="18" height="18">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        {oauthLoading === 'google' ? 'Connecting...' : 'Continue with Google'}
      </button>

      <button
        type="button"
        onClick={() => handleOAuth('azure')}
        disabled={isDisabled}
        className="w-full flex items-center justify-center gap-3 px-5 py-3 bg-surface border border-border rounded-[10px] text-sm font-medium text-text-primary hover:bg-background transition-all duration-150 mb-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <svg viewBox="0 0 23 23" width="18" height="18">
          <path fill="#f35325" d="M1 1h10v10H1z"/>
          <path fill="#81bc06" d="M12 1h10v10H12z"/>
          <path fill="#05a6f0" d="M1 12h10v10H1z"/>
          <path fill="#ffba08" d="M12 12h10v10H12z"/>
        </svg>
        {oauthLoading === 'azure' ? 'Connecting...' : 'Continue with Microsoft'}
      </button>

      <button
        type="button"
        onClick={() => handleOAuth('apple')}
        disabled={isDisabled}
        className="w-full flex items-center justify-center gap-3 px-5 py-3 bg-surface border border-border rounded-[10px] text-sm font-medium text-text-primary hover:bg-background transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" className="fill-text-primary">
          <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
        </svg>
        {oauthLoading === 'apple' ? 'Connecting...' : 'Continue with Apple'}
      </button>

      {/* Divider */}
      <div className="flex items-center my-5">
        <div className="flex-1 h-px bg-border" />
        <span className="px-4 text-[13px] text-text-secondary font-medium">Or</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      {/* Email/Password Form */}
      <form onSubmit={handleSubmit}>
        <div className="mb-3">
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (errors.email) setErrors(prev => ({ ...prev, email: '' }));
            }}
            placeholder="Enter your email address"
            disabled={isDisabled}
            className={`w-full px-3.5 py-3 text-sm bg-surface border rounded-[10px] text-text-primary placeholder:text-text-secondary outline-none transition-all duration-150 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-background disabled:cursor-not-allowed ${
              errors.email ? 'border-error' : 'border-border'
            }`}
          />
          {errors.email && (
            <p className="mt-1.5 text-xs text-error">{errors.email}</p>
          )}
        </div>

        <div className="mb-4">
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errors.password) setErrors(prev => ({ ...prev, password: '' }));
              }}
              placeholder="Enter your password"
              disabled={isDisabled}
              className={`w-full px-3.5 py-3 pr-11 text-sm bg-surface border rounded-[10px] text-text-primary placeholder:text-text-secondary outline-none transition-all duration-150 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-background disabled:cursor-not-allowed ${
                errors.password ? 'border-error' : 'border-border'
              }`}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              disabled={isDisabled}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              <Icon name={showPassword ? 'EyeOff' : 'Eye'} size={18} />
            </button>
          </div>
          {errors.password && (
            <p className="mt-1.5 text-xs text-error">{errors.password}</p>
          )}
        </div>

        {/* Remember Me & Forgot Password */}
        <div className="flex items-center justify-between mb-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="w-4 h-4 rounded border-border text-primary focus:ring-primary/20"
            />
            <span className="text-sm text-text-secondary">Remember me</span>
          </label>
          <button
            type="button"
            className="text-sm text-text-primary font-medium hover:opacity-80 transition-opacity underline underline-offset-2"
          >
            Forgot password?
          </button>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isDisabled}
          className="w-full py-3 px-5 bg-primary text-primary-foreground rounded-[10px] text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>

      {/* Auth Toggle */}
      <p className="mt-5 text-center text-sm text-text-secondary">
        Don't have an account?{' '}
        <button
          type="button"
          className="text-text-primary font-medium underline underline-offset-2 hover:opacity-80 transition-opacity"
        >
          Contact admin
        </button>
      </p>

      {/* Demo Credentials - Dev Only */}
      {import.meta.env.DEV && (
        <div className="mt-6 p-4 bg-accent/5 border border-accent/20 rounded-[10px]">
          <div className="flex items-center gap-2 mb-3">
            <Icon name="Info" size={16} className="text-accent" />
            <span className="text-sm font-medium text-text-primary">Demo Credentials</span>
          </div>
          <div className="space-y-1.5 text-xs text-text-secondary font-mono">
            <div><strong>Staff:</strong> staff@zenly.app / Zenly@Staff123</div>
            <div><strong>Manager:</strong> manager@zenly.app / Zenly@Manager123</div>
            <div><strong>Admin:</strong> admin@zenly.app / Zenly@Admin123</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LoginForm;
