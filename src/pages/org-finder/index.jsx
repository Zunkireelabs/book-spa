import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Icon from '../../components/AppIcon';
import { useAuth } from '../../contexts/AuthContext';
import { fetchOrganizationBySlug } from '../../services/api';

const OrgFinder = () => {
  const navigate = useNavigate();
  const { user, profile, loading: authLoading } = useAuth();
  const [orgInput, setOrgInput] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // If already logged in with a profile, redirect to their org dashboard
  useEffect(() => {
    if (!authLoading && user && profile?.organizations?.slug) {
      navigate(`/${profile.organizations.slug}/dashboard`, { replace: true });
    }
  }, [authLoading, user, profile, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const slug = orgInput.trim().toLowerCase().replace(/\s+/g, '-');
    if (!slug) {
      setError('Please enter an organization name or ID');
      return;
    }

    setIsLoading(true);

    const { data: org, error: fetchError } = await fetchOrganizationBySlug(slug);

    if (fetchError || !org) {
      setError('Organization not found. Please check the name and try again.');
      setIsLoading(false);
      return;
    }

    // Organization found - redirect to its login page
    navigate(`/${org.slug}/login`);
  };

  // Show loading while auth is checking
  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-12 h-12 bg-primary rounded-spa-lg flex items-center justify-center animate-pulse">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              className="text-primary-foreground"
            >
              <path
                d="M12 2L13.09 8.26L20 9L13.09 9.74L12 16L10.91 9.74L4 9L10.91 8.26L12 2Z"
                fill="currentColor"
              />
              <circle cx="12" cy="19" r="2" fill="currentColor" opacity="0.7" />
            </svg>
          </div>
          <p className="font-body font-body-normal text-sm text-text-secondary">
            Loading...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
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
              <circle cx="12" cy="19" r="2" fill="currentColor" opacity="0.7" />
            </svg>
          </div>
          <h1 className="font-heading font-heading-semibold text-2xl text-text-primary mb-2">
            Welcome to Zenly
          </h1>
          <p className="font-body font-body-normal text-text-secondary">
            Enter your organization name to continue
          </p>
        </div>

        {/* Form Card */}
        <div className="bg-surface rounded-spa-lg spa-shadow-elevated p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            <Input
              label="Organization Name or ID"
              type="text"
              value={orgInput}
              onChange={(e) => {
                setOrgInput(e.target.value);
                if (error) setError('');
              }}
              placeholder="e.g., nuad-thai-spa"
              error={error}
              required
            />

            <Button
              variant="default"
              type="submit"
              loading={isLoading}
              fullWidth
              className="spa-touch-target"
            >
              {isLoading ? 'Finding...' : 'Continue'}
            </Button>
          </form>

          {/* Help Text */}
          <div className="mt-6 p-3 bg-background rounded-spa border border-border">
            <div className="flex items-start space-x-2">
              <Icon name="HelpCircle" size={16} className="text-accent mt-0.5" />
              <div className="flex-1">
                <p className="font-caption font-caption-normal text-xs text-text-secondary">
                  Don't know your organization ID? Contact your administrator or check your welcome email.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center mt-6 font-caption font-caption-normal text-sm text-text-secondary">
          Powered by Zenly
        </p>
      </div>
    </div>
  );
};

export default OrgFinder;
