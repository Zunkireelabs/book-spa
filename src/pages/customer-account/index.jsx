import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import Icon from 'components/AppIcon';
import { useTenant } from 'contexts/TenantContext';
import { useCustomerAuth } from 'contexts/CustomerAuthContext';
import {
  getCustomerBookingHistory, getCustomerMembership, getCustomerMembershipTransactions,
  getCustomerVouchers, getCustomerReferralStats,
} from 'services/api';
import { transformBooking } from 'services/bookingTransformers';
import { formatPhoneDisplay } from 'utils/phone';
import { MEMBERSHIP_ENABLED, VOUCHER_ENABLED, CUSTOMER_REFERRALS_ENABLED } from 'lib/featureFlags';
import CustomerMembershipSection from 'components/ui/CustomerMembershipSection';
import CustomerVouchersSection from 'components/ui/CustomerVouchersSection';
import CustomerReferralStats from 'components/ui/CustomerReferralStats';

const STATUS_BADGE = {
  pending: 'bg-warning/10 text-warning',
  confirmed: 'bg-primary/10 text-primary',
  'in-progress': 'bg-accent/10 text-accent',
  completed: 'bg-success/10 text-success',
  cancelled: 'bg-error/10 text-error',
  'no show': 'bg-error/10 text-error',
};

const UPCOMING_STATUSES = new Set(['pending', 'confirmed', 'in-progress']);

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

function formatRelativeDate(dateStr) {
  if (!dateStr) return '';
  const target = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target - today) / 86400000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays === -1) return 'Yesterday';
  return target.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function formatTime12h(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}

const TONE_STYLES = {
  primary:   { chip: 'bg-primary/10', icon: 'text-primary' },
  secondary: { chip: 'bg-secondary/10', icon: 'text-secondary' },
  accent:    { chip: 'bg-accent/10', icon: 'text-accent' },
  success:   { chip: 'bg-success/10', icon: 'text-success' },
};

const StatTile = ({ icon, label, value, tone = 'primary', empty, emptyLabel, to }) => {
  const toneStyle = TONE_STYLES[tone] || TONE_STYLES.primary;
  const content = (
    <div className={`h-full min-w-0 p-4 bg-surface border border-border rounded-spa-lg shadow-spa-resting hover:shadow-spa-elevated spa-transition-fast flex flex-col ${to ? 'cursor-pointer' : ''}`}>
      <div className="flex items-center justify-between mb-2">
        <div className={`w-8 h-8 rounded-spa flex items-center justify-center ${toneStyle.chip}`}>
          <Icon name={icon} size={15} className={toneStyle.icon} />
        </div>
      </div>
      {empty ? (
        <p className="font-caption text-xs text-text-tertiary leading-6 truncate">{emptyLabel}</p>
      ) : (
        <p className="font-data font-data-semibold text-lg text-text-primary leading-6 truncate">{value}</p>
      )}
      <p className="font-caption text-[11px] text-text-secondary mt-0.5 uppercase tracking-wide">{label}</p>
    </div>
  );
  return to ? <Link to={to}>{content}</Link> : content;
};

const CustomerAccount = () => {
  const { orgSlug } = useParams();
  const { orgName } = useTenant();
  const navigate = useNavigate();
  const { customer, customerProfile, loading: authLoading, signOut } = useCustomerAuth();
  const [bookings, setBookings] = useState([]);
  const [loadingBookings, setLoadingBookings] = useState(true);
  const [membership, setMembership] = useState(null);
  const [membershipTransactions, setMembershipTransactions] = useState([]);
  const [vouchers, setVouchers] = useState([]);
  const [referralStats, setReferralStats] = useState(null);
  const hasRedirected = useRef(false);

  useEffect(() => {
    if (!authLoading && !customer && !hasRedirected.current) {
      hasRedirected.current = true;
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

  useEffect(() => {
    if (!MEMBERSHIP_ENABLED || !customerProfile?.customer_id) return;

    let cancelled = false;

    getCustomerMembership(customerProfile.customer_id).then(({ data: m, error }) => {
      if (cancelled) return;
      if (error || !m) {
        setMembership(null);
        return;
      }
      setMembership(m);
      getCustomerMembershipTransactions(m.id).then(({ data: t }) => {
        if (!cancelled) setMembershipTransactions(t || []);
      });
    });

    return () => { cancelled = true; };
  }, [customerProfile?.customer_id]);

  useEffect(() => {
    if (!VOUCHER_ENABLED || !customerProfile?.customer_id) return;

    let cancelled = false;
    getCustomerVouchers(customerProfile.customer_id).then(({ data }) => {
      if (!cancelled) setVouchers(data || []);
    });

    return () => { cancelled = true; };
  }, [customerProfile?.customer_id]);

  useEffect(() => {
    if (!CUSTOMER_REFERRALS_ENABLED || !customerProfile?.customer_id) return;

    let cancelled = false;
    getCustomerReferralStats(customerProfile.customer_id).then(({ data }) => {
      if (!cancelled) setReferralStats(data);
    });

    return () => { cancelled = true; };
  }, [customerProfile?.customer_id]);

  const { nextBooking, upcomingBookings, pastBookings } = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const upcoming = bookings
      .filter((b) => UPCOMING_STATUSES.has(b.status) && b.date >= todayStr)
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    const past = bookings
      .filter((b) => !(UPCOMING_STATUSES.has(b.status) && b.date >= todayStr))
      .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
    return { nextBooking: upcoming[0] || null, upcomingBookings: upcoming.slice(1), pastBookings: past };
  }, [bookings]);

  const voucherValue = useMemo(
    () => vouchers.reduce((sum, v) => sum + Number(v.remaining_balance ?? v.total_amount_issued ?? 0), 0),
    [vouchers]
  );

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

  const firstName = (customerProfile.full_name || '').split(' ')[0];

  return (
    <div className="min-h-screen bg-background">
      <header className="px-6 md:px-8 py-5 flex items-center justify-between border-b border-border bg-surface">
        <span className="font-heading font-heading-semibold text-lg text-text-primary tracking-tight">
          {orgName || 'Zennly'}
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

      <main className="max-w-4xl mx-auto px-5 py-10">
        {/* Hero greeting */}
        <div className="mb-8 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <p className="font-accent italic text-3xl text-text-primary mb-1">Welcome back, {firstName}</p>
            <p className="font-body text-sm text-text-secondary">
              {customerProfile.email}{customerProfile.phone ? ` · ${formatPhoneDisplay(customerProfile.phone)}` : ''}
            </p>
          </div>
          <Link
            to={`/${orgSlug}/book`}
            className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-spa text-sm font-medium shadow-spa-resting spa-transition-fast"
          >
            <Icon name="Calendar" size={16} />
            Book a service
          </Link>
        </div>

        {/* Next appointment spotlight */}
        {nextBooking && (
          <details className="group mb-8 relative overflow-hidden bg-surface border border-border rounded-spa-lg shadow-spa-elevated [&_summary::-webkit-details-marker]:hidden">
            <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-accent" />
            <summary className="p-6 pl-7 flex items-center justify-between gap-4 flex-wrap cursor-pointer list-none">
              <div>
                <p className="font-caption text-xs text-accent uppercase tracking-widest mb-1.5">Your next appointment</p>
                <p className="font-heading font-heading-semibold text-xl text-text-primary mb-1">{nextBooking.service}</p>
                <p className="font-body text-sm text-text-secondary">
                  {formatRelativeDate(nextBooking.date)} · {formatTime12h(nextBooking.time)}
                  {nextBooking.duration ? ` · ${nextBooking.duration}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`px-3 py-1.5 rounded-full text-xs font-medium capitalize flex-shrink-0 ${STATUS_BADGE[nextBooking.status] || 'bg-background text-text-secondary'}`}>
                  {nextBooking.status}
                </span>
                <Icon name="ChevronDown" size={15} className="text-text-secondary spa-transition-fast group-open:rotate-180" />
              </div>
            </summary>
            <div className="px-6 pl-7 pb-6 pt-1 border-t border-border space-y-2.5">
              <BookingDetailFields booking={nextBooking} />
            </div>
          </details>
        )}

        {/* Status strip — always visible, graceful empty states */}
        <div className="mb-10 grid grid-cols-1 min-[380px]:grid-cols-2 lg:grid-cols-4 auto-rows-fr gap-3">
          {MEMBERSHIP_ENABLED && (
            <StatTile
              icon="Wallet"
              tone="primary"
              label="Membership"
              value={membership ? membership.tierName : null}
              empty={!membership}
              emptyLabel="Not a member yet"
            />
          )}
          {VOUCHER_ENABLED && (
            <StatTile
              icon="Ticket"
              tone="secondary"
              label="Vouchers"
              value={formatNPR(voucherValue)}
              empty={vouchers.length === 0}
              emptyLabel="No active vouchers"
            />
          )}
          {CUSTOMER_REFERRALS_ENABLED && (
            <StatTile
              icon="Users"
              tone="accent"
              label="Referral earnings"
              value={referralStats ? formatNPR(referralStats.totalCredited) : null}
              empty={!referralStats || referralStats.totalReferred === 0}
              emptyLabel="Refer a friend to earn"
            />
          )}
          <StatTile
            icon="Sparkles"
            tone="success"
            label="Total visits"
            value={bookings.filter((b) => b.status === 'completed').length || null}
            empty={bookings.filter((b) => b.status === 'completed').length === 0}
            emptyLabel="Your first visit awaits"
          />
        </div>

        <CustomerMembershipSection membership={membership} transactions={membershipTransactions} />
        <CustomerVouchersSection vouchers={vouchers} />
        <CustomerReferralStats stats={referralStats} />

        {/* Bookings */}
        {loadingBookings && (
          <p className="text-sm text-text-secondary">Loading bookings...</p>
        )}

        {!loadingBookings && bookings.length === 0 && (
          <div className="text-center py-12 bg-surface border border-border rounded-spa-lg">
            <Icon name="CalendarPlus" size={28} className="text-text-tertiary mx-auto mb-3" />
            <p className="font-body text-sm text-text-secondary mb-4">No bookings yet — your wellness journey starts here.</p>
            <Link
              to={`/${orgSlug}/book`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-spa text-sm font-medium spa-transition-fast"
            >
              Book your first service
            </Link>
          </div>
        )}

        {upcomingBookings.length > 0 && (
          <div className="mb-8">
            <h2 className="font-heading font-heading-medium text-base text-text-primary mb-3">Upcoming</h2>
            <div className="space-y-2.5">
              {upcomingBookings.map((booking) => (
                <BookingRow key={booking.bookingId} booking={booking} accent />
              ))}
            </div>
          </div>
        )}

        {pastBookings.length > 0 && (
          <div>
            <h2 className="font-heading font-heading-medium text-base text-text-primary mb-3">Past bookings</h2>
            <div className="space-y-2.5">
              {pastBookings.map((booking) => (
                <BookingRow key={booking.bookingId} booking={booking} />
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

const REFERRAL_SOURCE_LABEL = {
  client: 'Referred by a client',
  social_media: 'Found via social media',
  staff: 'Referred by staff',
};

const BookingDetailFields = ({ booking }) => (
  <>
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="font-caption text-xs text-text-secondary uppercase tracking-wide">Date &amp; time</span>
      <span className="font-body text-text-primary text-right">
        {formatRelativeDate(booking.date)} at {formatTime12h(booking.time)}
      </span>
    </div>
    {booking.duration && (
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="font-caption text-xs text-text-secondary uppercase tracking-wide">Duration</span>
        <span className="font-body text-text-primary text-right">{booking.duration}</span>
      </div>
    )}
    {booking.branchName && (
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="font-caption text-xs text-text-secondary uppercase tracking-wide">Branch</span>
        <span className="font-body text-text-primary text-right">{booking.branchName}</span>
      </div>
    )}
    {booking.therapist?.name && (
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="font-caption text-xs text-text-secondary uppercase tracking-wide">Staff</span>
        <span className="font-body text-text-primary text-right">{booking.therapist.name}</span>
      </div>
    )}
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="font-caption text-xs text-text-secondary uppercase tracking-wide">Status</span>
      <span className="font-body text-text-primary text-right capitalize">{booking.status}</span>
    </div>
    {booking.referralSource && (
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="font-caption text-xs text-text-secondary uppercase tracking-wide">Referred via</span>
        <span className="font-body text-text-primary text-right">
          {REFERRAL_SOURCE_LABEL[booking.referralSource] || booking.referralSource}
          {booking.referralSourceDetail ? ` — ${booking.referralSourceDetail}` : ''}
        </span>
      </div>
    )}
    {booking.specialRequests && (
      <div className="text-sm">
        <p className="font-caption text-xs text-text-secondary uppercase tracking-wide mb-1">Special request</p>
        <p className="font-body text-text-primary">{booking.specialRequests}</p>
      </div>
    )}
    <div className="flex items-baseline justify-between gap-4 text-sm pt-1 border-t border-dashed border-border">
      <span className="font-caption text-xs text-text-secondary uppercase tracking-wide">Amount</span>
      <span className="font-data font-data-medium text-text-primary text-right">{booking.price}</span>
    </div>
  </>
);

const BookingRow = ({ booking, accent }) => (
  <details className={`group bg-surface border rounded-spa spa-transition-fast hover:shadow-spa-resting [&_summary::-webkit-details-marker]:hidden ${accent ? 'border-primary/20' : 'border-border'}`}>
    <summary className="p-4 flex items-center justify-between gap-4 cursor-pointer list-none">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="w-9 h-9 rounded-spa bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Icon name="Sparkles" size={15} className="text-primary" />
        </div>
        <div className="min-w-0">
          <p className="font-body font-body-medium text-sm text-text-primary truncate">{booking.service}</p>
          <p className="font-caption text-xs text-text-secondary">
            {formatRelativeDate(booking.date)} at {formatTime12h(booking.time)} &middot; {booking.price}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={`px-2.5 py-1 rounded-full text-xs font-medium capitalize flex-shrink-0 ${STATUS_BADGE[booking.status] || 'bg-background text-text-secondary'}`}>
          {booking.status}
        </span>
        <Icon name="ChevronDown" size={15} className="text-text-secondary spa-transition-fast group-open:rotate-180" />
      </div>
    </summary>
    <div className="px-4 pb-4 pt-1 border-t border-border ml-12 space-y-2.5">
      <BookingDetailFields booking={booking} />
    </div>
  </details>
);

export default CustomerAccount;
