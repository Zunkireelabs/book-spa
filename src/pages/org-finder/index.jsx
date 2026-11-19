import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import AuthSplitLayout from '../../components/auth/AuthSplitLayout';
import BrandMark from '../../components/ui/BrandMark';
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
          <div className="animate-pulse">
            <BrandMark className="h-12 w-auto" />
          </div>
          <p className="text-sm text-text-secondary">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <AuthSplitLayout
      title="Welcome"
      subtitle="Enter your business name to find your login."
      bottom={<>Powered by <b className="text-[#111]">zunkireelabs</b></>}
    >
      {error && (
        <div className="mb-3.5 rounded-[10px] bg-[#FDECEC] px-3.5 py-3 text-sm leading-snug text-[#B42318]">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={orgInput}
          onChange={(e) => {
            setOrgInput(e.target.value);
            if (error) setError('');
          }}
          placeholder="e.g., your-business"
          disabled={isLoading}
          className="mb-3 block h-12 w-full rounded-[10px] border border-[#dcdcdc] bg-white px-3.5 text-[15px] text-[#111] outline-none placeholder:text-[#888] focus:border-[#111] disabled:cursor-not-allowed disabled:bg-[#F1F1F1]"
        />
        <button
          type="submit"
          disabled={isLoading}
          className="h-12 w-full rounded-[10px] bg-[#111] text-[15px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? 'Finding...' : 'Continue'}
        </button>
      </form>
    </AuthSplitLayout>
  );
};

export default OrgFinder;
