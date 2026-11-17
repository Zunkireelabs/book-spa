import React, { useCallback } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import AppShell from '../../components/ui/AppShell';
import InboxBookingPanel from '../inbox/InboxBookingPanel';
import { useAuth } from '../../contexts/AuthContext';

// URL-addressable booking (/:orgSlug/bookings/:bookingId). Renders the same right-side
// InboxBookingPanel the dashboard, calendar and inbox use (ZNLY-225) — no separate centred modal.
// Close returns to the page the link was opened from, or the dashboard for a direct visit.
const BookingDetailsAssignmentModal = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { bookingId: paramBookingId, orgSlug } = useParams();
  const { profile } = useAuth();
  const userRole = profile?.role || 'staff';
  const bookingId = paramBookingId || new URLSearchParams(location.search).get('id');

  const close = useCallback(() => {
    // location.key === 'default' means this was the first entry in history (deep link / new tab)
    if (location.key !== 'default') navigate(-1);
    else navigate(orgSlug ? `/${orgSlug}/dashboard` : '/login', { replace: true });
  }, [navigate, location.key, orgSlug]);

  return (
    <AppShell variant="flush" sidebar={{ userRole }} header={{ realtimeStatus: 'connected' }}>
      <div className="bg-background min-h-full">
        <InboxBookingPanel bookingId={bookingId} onClose={close} />
      </div>
    </AppShell>
  );
};

export default BookingDetailsAssignmentModal;
