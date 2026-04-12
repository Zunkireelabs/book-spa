import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import { Checkbox } from '../../../components/ui/Checkbox';
import Icon from '../../../components/AppIcon';
import { useAuth, getDashboardPath } from '../../../contexts/AuthContext';

const LoginForm = () => {
  const navigate = useNavigate();
  const { signIn, user, profile } = useAuth();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    rememberMe: false
  });
  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Redirect if already authenticated
  useEffect(() => {
    if (user && profile) {
      navigate(getDashboardPath(profile.role), { replace: true });
    }
  }, [user, profile, navigate]);

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));

    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: ''
      }));
    }
  };

  const validateForm = () => {
    const newErrors = {};

    if (!formData.email) {
      newErrors.email = 'Email address is required';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }

    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (formData.password.length < 6) {
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
      const result = await signIn(formData.email, formData.password);
      // signIn returns profile — navigate directly
      if (result.profile) {
        navigate(getDashboardPath(result.profile.role), { replace: true });
        return;
      }
      // Auth succeeded but no staff profile found
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

  const getPasswordStrength = (password) => {
    if (!password) return { strength: 0, label: '' };

    let strength = 0;
    if (password.length >= 8) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[^A-Za-z0-9]/.test(password)) strength++;

    const labels = ['Weak', 'Fair', 'Good', 'Strong'];
    const colors = ['error', 'warning', 'accent', 'success'];

    return {
      strength: (strength / 4) * 100,
      label: labels[strength - 1] || '',
      color: colors[strength - 1] || 'error'
    };
  };

  const passwordStrength = getPasswordStrength(formData.password);

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-primary rounded-spa-lg flex items-center justify-center mx-auto mb-4">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            className="text-primary-foreground"
          >
            <path
              d="M12 2L13.09 8.26L20 9L13.09 9.74L12 16L10.91 9.74L4 9L10.91 8.26L12 2Z"
              fill="currentColor"
            />
            <circle cx="12" cy="19" r="2" fill="currentColor" opacity="0.7"/>
          </svg>
        </div>
        <h1 className="font-heading font-heading-semibold text-2xl text-text-primary mb-2">
          Staff Portal Access
        </h1>
        <p className="font-body font-body-normal text-text-secondary">
          Secure login for BooX team members
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6" aria-label="Staff login form">
        {/* Email Input */}
        <Input
          label="Work Email Address"
          type="email"
          name="email"
          value={formData.email}
          onChange={handleInputChange}
          placeholder="Enter your work email"
          error={errors.email}
          required
        />

        {/* Password Input */}
        <div className="space-y-2">
          <div className="relative">
            <Input
              label="Password"
              type={showPassword ? 'text' : 'password'}
              name="password"
              value={formData.password}
              onChange={handleInputChange}
              placeholder="Enter your password"
              error={errors.password}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 bottom-2.5 p-1 text-text-secondary hover:text-text-primary spa-transition-fast"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              <Icon name={showPassword ? 'EyeOff' : 'Eye'} size={16} />
            </button>
          </div>

          {/* Password Strength Indicator */}
          {formData.password && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-caption font-caption-normal text-xs text-text-secondary">
                  Password Strength
                </span>
                <span className={`font-caption font-caption-normal text-xs text-${passwordStrength.color}`}>
                  {passwordStrength.label}
                </span>
              </div>
              <div className="w-full bg-border rounded-full h-1">
                <div
                  className={`h-1 rounded-full bg-${passwordStrength.color} spa-transition-slow`}
                  style={{ width: `${passwordStrength.strength}%` }}
                ></div>
              </div>
            </div>
          )}
        </div>

        {/* Remember Me */}
        <div className="flex items-center justify-between">
          <Checkbox
            label="Remember me for 30 days"
            checked={formData.rememberMe}
            onChange={handleInputChange}
            name="rememberMe"
          />
          <button
            type="button"
            className="font-body font-body-normal text-sm text-primary hover:text-primary/80 spa-transition-fast"
          >
            Forgot password?
          </button>
        </div>

        {/* Submit Error */}
        {errors.submit && (
          <div className="p-3 bg-error/10 border border-error/20 rounded-spa">
            <div className="flex items-center space-x-2">
              <Icon name="AlertTriangle" size={16} className="text-error" />
              <p className="font-body font-body-normal text-sm text-error">
                {errors.submit}
              </p>
            </div>
          </div>
        )}

        {/* Submit Button */}
        <Button
          variant="default"
          type="submit"
          loading={isLoading}
          fullWidth
          className="spa-touch-target"
        >
          {isLoading ? 'Authenticating...' : 'Sign In to Dashboard'}
        </Button>

        {/* Security Notice */}
        <div className="p-3 bg-background rounded-spa border border-border">
          <div className="flex items-start space-x-2">
            <Icon name="Shield" size={16} className="text-accent mt-0.5" />
            <div className="flex-1">
              <p className="font-caption font-caption-normal text-xs text-text-secondary">
                Your session will timeout after 30 minutes of inactivity for security purposes.
              </p>
            </div>
          </div>
        </div>
      </form>

      {/* Demo Credentials Info — only in development */}
      {import.meta.env.DEV && (
        <div className="mt-8 p-4 bg-accent/5 border border-accent/20 rounded-spa">
          <h4 className="font-heading font-heading-medium text-sm text-text-primary mb-3 flex items-center space-x-2">
            <Icon name="Info" size={16} className="text-accent" />
            <span>Demo Credentials (Dev Only)</span>
          </h4>
          <div className="space-y-2 text-xs">
            <div className="font-data font-data-normal text-text-secondary">
              <strong>Staff:</strong> staff@bookspa.com.np / BooX@Staff123
            </div>
            <div className="font-data font-data-normal text-text-secondary">
              <strong>Manager:</strong> manager@bookspa.com.np / BooX@Manager123
            </div>
            <div className="font-data font-data-normal text-text-secondary">
              <strong>Admin:</strong> admin@bookspa.com.np / BooX@Admin123
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LoginForm;
