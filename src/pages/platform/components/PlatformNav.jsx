import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePlatformAuth } from 'contexts/PlatformAuthContext';

const PlatformNav = () => {
  const { user, signOut } = usePlatformAuth();
  const navigate = useNavigate();
  const handleLogout = async () => { await signOut(); navigate('/platform/login', { replace: true }); };

  return (
    <header className="z-header bg-surface border-b border-border px-6 py-3 flex items-center justify-between">
      <Link to="/platform/dashboard" className="font-heading font-heading-semibold text-primary">
        Zenly · Platform
      </Link>
      <div className="flex items-center gap-4">
        <span className="font-body text-sm text-text-secondary">{user?.email}</span>
        <button onClick={handleLogout}
          className="font-body text-sm text-error hover:underline">Log out</button>
      </div>
    </header>
  );
};

export default PlatformNav;
