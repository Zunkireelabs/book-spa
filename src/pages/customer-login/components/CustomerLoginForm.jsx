import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import Icon from 'components/AppIcon';
import { useCustomerAuth } from 'contexts/CustomerAuthContext';

const CustomerLoginForm = () => {
  const navigate = useNavigate();
  const { orgSlug } = useParams();
  const { signIn, customer, customerProfile } = useCustomerAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});
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
      newErrors.password = 'Must be at least 6 characters';
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
      await signIn(email, password);
      // Redirect happens via the effect above once customer/customerProfile land.
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

  return (
    <div className="w-full">
      {errors.submit && (
        <div className="mb-4 p-3 bg-error/10 text-error rounded-[10px] text-sm font-medium">
          {errors.submit}
        </div>
      )}

      <form onSubmit={handleSubmit} autoComplete="off">
        <div className="mb-3">
          <input
            type="text"
            autoComplete="off"
            name="customer-login-email-field"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (errors.email) setErrors(prev => ({ ...prev, email: '' }));
            }}
            placeholder="Enter your email address"
            disabled={isLoading}
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
              disabled={isLoading}
              className={`w-full px-3.5 py-3 pr-11 text-sm bg-surface border rounded-[10px] text-text-primary placeholder:text-text-secondary outline-none transition-all duration-150 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-background disabled:cursor-not-allowed ${
                errors.password ? 'border-error' : 'border-border'
              }`}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              disabled={isLoading}
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

        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-3 px-5 bg-primary text-primary-foreground rounded-[10px] text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? 'Signing in...' : 'Sign In'}
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
