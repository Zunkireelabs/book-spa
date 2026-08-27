import React from 'react';
import { Navigate } from 'react-router-dom';
import { usePlatformAuth } from 'contexts/PlatformAuthContext';

const ProtectedPlatformRoute = ({ children }) => {
  const { user, isPlatformAdmin, loading } = usePlatformAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="font-body text-sm text-text-secondary">Loading…</p>
      </div>
    );
  }
  if (!user || !isPlatformAdmin) {
    return <Navigate to="/platform/login" replace />;
  }
  return children;
};

export default ProtectedPlatformRoute;
