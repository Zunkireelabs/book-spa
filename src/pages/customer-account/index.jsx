import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Icon from 'components/AppIcon';
import { useTenant } from 'contexts/TenantContext';
import { useCustomerAuth } from 'contexts/CustomerAuthContext';
import { getCustomerBookingHistory } from 'services/api';
import { transformBooking } from 'services/bookingTransformers';

const STATUS_BADGE = {
  pending: 'bg-warning/10 text-warning',
  confirmed: 'bg-primary/10 text-primary',
  'in-progress': 'bg-accent/10 text-accent',
  completed: 'bg-success/10 text-success',
  cancelled: 'bg-error/10 text-error',
  'no show': 'bg-error/10 text-error',
};

const CustomerAccount = () => {
  const { orgSlug } = useParams();
  const { orgName } = useTenant();
  const navigate = useNavigate();
  const { customer, customerProfile, loading: authLoading, signOut } = useCustomerAuth();
  const [bookings, setBookings] = useState([]);
  const [loadingBookings, setLoadingBookings] = useState(true);

  useEffect(() => {
    if (!authLoading && !customer) {
      navigate(`/${orgSlug}/customer-login`, { replace: true });
    }
  }, [authLoading, customer, orgSlug, navigate]);

  useEffect(() => {
    if (!customerProfile?.id) return;

    let cancelled = false;
    setLoadingBookings(true);

    getCustomerBookingHistory(customerProfile.id).then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        console.error('[CustomerAccount] booking history error:', error.message);
        setBookings([]);
      } else {
        setBookings((data || []).map(transformBooking));
      }
      setLoadingBookings(false);
    });

    return () => { cancelled = true; };
  }, [customerProfile?.id]);

  const handleSignOut = async () => {
    await signOut();
    navigate(`/${orgSlug}/book`);
  };

  if (authLoading || !customerProfile) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-text-secondary">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="px-6 md:px-8 py-5 flex items-center justify-between border-b border-border">
        <span className="text-lg font-semibold text-text-primary tracking-tight">
          {orgName || 'Zenly'}
        </span>
        <button
          type="button"
          onClick={handleSignOut}
          className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
        >
          <Icon name="LogOut" size={16} />
          Sign out
        </button>
      </header>

      <main className="max-w-2xl mx-auto px-5 py-8">
        <div className="mb-8 p-5 bg-surface border border-border rounded-spa-lg">
          <h1 className="text-xl font-semibold text-text-primary mb-1">{customerProfile.full_name}</h1>
          <p className="text-sm text-text-secondary">{customerProfile.email}</p>
          {customerProfile.phone && (
            <p className="text-sm text-text-secondary">{customerProfile.phone}</p>
          )}
        </div>

        <h2 className="text-lg font-semibold text-text-primary mb-4">Your bookings</h2>

        {loadingBookings && (
          <p className="text-sm text-text-secondary">Loading bookings...</p>
        )}

        {!loadingBookings && bookings.length === 0 && (
          <p className="text-sm text-text-secondary">No bookings yet.</p>
        )}

        <div className="space-y-3">
          {bookings.map((booking) => (
            <div key={booking.bookingId} className="p-4 bg-surface border border-border rounded-spa flex items-center justify-between gap-4">
              <div>
                <p className="font-medium text-text-primary">{booking.service}</p>
                <p className="text-sm text-text-secondary">
                  {booking.date} at {booking.time} &middot; {booking.price}
                </p>
              </div>
              <span className={`px-2.5 py-1 rounded-full text-xs font-medium capitalize ${STATUS_BADGE[booking.status] || 'bg-background text-text-secondary'}`}>
                {booking.status}
              </span>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
};

export default CustomerAccount;
