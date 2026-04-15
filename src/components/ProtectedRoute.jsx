import React from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const LoadingScreen = () => (
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

const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user, profile, loading } = useAuth();
  const { orgSlug: urlOrgSlug } = useParams();

  if (loading) {
    return <LoadingScreen />;
  }

  // Not authenticated - redirect to login
  if (!user) {
    // If we have an org slug in the URL, redirect to that org's login
    if (urlOrgSlug) {
      return <Navigate to={`/${urlOrgSlug}/login`} replace />;
    }
    return <Navigate to="/login" replace />;
  }

  // No profile loaded - something went wrong
  if (!profile) {
    if (urlOrgSlug) {
      return <Navigate to={`/${urlOrgSlug}/login`} replace />;
    }
    return <Navigate to="/login" replace />;
  }

  // Check role authorization
  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    // User doesn't have the required role
    // Redirect to their appropriate dashboard based on their actual role
    const userOrgSlug = profile?.organizations?.slug;
    if (userOrgSlug) {
      return <Navigate to={`/${userOrgSlug}/dashboard`} replace />;
    }
    return <Navigate to="/login" replace />;
  }

  // If URL has an org slug, validate it matches the user's org
  if (urlOrgSlug) {
    const userOrgSlug = profile?.organizations?.slug;

    if (userOrgSlug && urlOrgSlug !== userOrgSlug) {
      // URL org doesn't match user's org - redirect to user's actual org
      return <Navigate to={`/${userOrgSlug}/dashboard`} replace />;
    }
  }

  return children;
};

export default ProtectedRoute;
