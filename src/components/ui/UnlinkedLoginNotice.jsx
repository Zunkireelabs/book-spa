import React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useUnlinkedLogin } from '../../hooks/useUnlinkedLogin';
import { UNLINKED_LOGIN_MESSAGE } from '../../services/dataMasking';

// ZNLY-235: shown on every screen that lists bookings, for an own-only login with no linked team member.
const UnlinkedLoginNotice = () => {
  const { profile } = useAuth();
  if (!useUnlinkedLogin(profile)) return null;
  return (
    <div role="status" className="mb-3 rounded-spa border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-text-primary">
      {UNLINKED_LOGIN_MESSAGE}
    </div>
  );
};
export default UnlinkedLoginNotice;
