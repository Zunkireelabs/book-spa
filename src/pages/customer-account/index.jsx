import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import Icon from 'components/AppIcon';
import { useTenant } from 'contexts/TenantContext';
import { useCustomerAuth } from 'contexts/CustomerAuthContext';
import {
  getCustomerBookingHistory, getCustomerMembership, getCustomerMembershipTransactions,
  getCustomerMembershipHistory, getCustomerVouchers, getCustomerVoucherClaims,
  getCustomerPackages, getCustomerReferralStats,
} from 'services/api';
import { transformBooking } from 'services/bookingTransformers';
import { formatPhoneDisplay } from 'utils/phone';
import { MEMBERSHIP_ENABLED, VOUCHER_ENABLED, CUSTOMER_REFERRALS_ENABLED } from 'lib/featureFlags';
import CustomerMembershipSection from 'components/ui/CustomerMembershipSection';
import CustomerVouchersSection from 'components/ui/CustomerVouchersSection';
import CustomerPackagesSection from 'components/ui/CustomerPackagesSection';
import CustomerReferralStats from 'components/ui/CustomerReferralStats';
import CustomerProfileEditModal from 'components/ui/CustomerProfileEditModal';
import nuadThaiSpaLogo from 'assets/tenants/nuad-thai-spa-logo.png';

// Per-tenant logo image, keyed by org slug. Orgs with no entry here fall
// back to the plain text org name (see header render below) — adding a new
// tenant's logo is a one-line addition to this map plus dropping the asset
// in assets/tenants/, no other code change needed.
const TENANT_LOGOS = {
  'nuad-thai-spa': nuadThaiSpaLogo,
};

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

function formatDateShort(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
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

const StatTile = ({ icon, label, value, tone = 'primary', empty, emptyLabel, showValue = true, to, onClick }) => {
  const toneStyle = TONE_STYLES[tone] || TONE_STYLES.primary;
  const clickable = to || onClick;
  const content = (
    <div className={`h-full min-w-0 p-4 bg-surface border border-border rounded-spa-lg shadow-spa-resting hover:shadow-spa-elevated spa-transition-fast flex flex-col ${clickable ? 'cursor-pointer' : ''}`}>
      <div className="flex items-center justify-between mb-2">
        <div className={`w-8 h-8 rounded-spa flex items-center justify-center ${toneStyle.chip}`}>
          <Icon name={icon} size={15} className={toneStyle.icon} />
        </div>
      </div>
      {showValue && (
        empty ? (
          <p className="font-caption text-xs text-text-tertiary leading-6 truncate">{emptyLabel}</p>
        ) : (
          <p className="font-data font-data-semibold text-lg text-text-primary leading-6 truncate">{value}</p>
        )
      )}
      <p className={`font-caption text-[11px] text-text-secondary uppercase tracking-wide ${showValue ? 'mt-0.5' : ''}`}>{label}</p>
    </div>
  );
  if (to) return <Link to={to}>{content}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className="text-left h-full w-full">{content}</button>;
  return content;
};

const StatDetailModal = ({ title, onClose, children }) => (
  <div
    className="fixed inset-0 z-modal-overlay bg-background flex flex-col"
    role="dialog"
    aria-modal="true"
    aria-labelledby="stat-detail-title"
  >
    <div className="flex-shrink-0 bg-surface border-b border-border px-4 sm:px-6 py-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
      <span />
      <h2 id="stat-detail-title" className="font-heading font-heading-semibold text-base text-text-primary text-center truncate">
        {title}
      </h2>
      <button type="button" onClick={onClose} className="p-1.5 -mr-1.5 rounded-spa hover:bg-background spa-transition-fast justify-self-end">
        <Icon name="X" size={18} className="text-text-secondary" />
      </button>
    </div>
    <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 max-w-2xl w-full mx-auto">{children}</div>
  </div>
);

const InfoCard = ({ children, className = '' }) => (
  <div className={`bg-surface border border-border rounded-spa-lg shadow-spa-resting p-5 ${className}`}>{children}</div>
);

const StatHighlightCard = ({ icon, value, label }) => (
  <InfoCard className="text-center py-6">
    <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-4">
      <Icon name={icon} size={20} className="text-accent" />
    </div>
    <p className="font-data font-data-semibold text-3xl text-text-primary mb-1">{value}</p>
    <p className="font-caption text-xs text-text-secondary uppercase tracking-wide">{label}</p>
  </InfoCard>
);

const EmptyStateCard = ({ icon, message }) => (
  <InfoCard className="text-center py-6">
    <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-4">
      <Icon name={icon} size={20} className="text-accent" />
    </div>
    <p className="font-body text-sm text-text-secondary">{message}</p>
  </InfoCard>
);

const DetailRow = ({ label, value }) => (
  <div className="flex items-baseline justify-between gap-3 text-sm">
    <span className="font-caption text-xs text-text-secondary uppercase tracking-wide flex-shrink-0">{label}</span>
    <span className="font-body text-text-primary text-right truncate min-w-0">{value}</span>
  </div>
);

const CustomerAccount = () => {
  const { orgSlug } = useParams();
  const { orgName } = useTenant();
  const navigate = useNavigate();
  const { customer, customerProfile, loading: authLoading, signOut } = useCustomerAuth();
  const [bookings, setBookings] = useState([]);
  const [loadingBookings, setLoadingBookings] = useState(true);
  const [membership, setMembership] = useState(null);
  const [membershipTransactions, setMembershipTransactions] = useState([]);
  const [pastMemberships, setPastMemberships] = useState([]);
  const [vouchers, setVouchers] = useState([]);
  const [voucherClaims, setVoucherClaims] = useState([]);
  const [packages, setPackages] = useState([]);
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
      getCustomerMembershipHistory(customerProfile.customer_id).then(({ data: h }) => {
        if (!cancelled) setPastMemberships((h || []).filter((row) => row.id !== m.id));
      });
    });

    return () => { cancelled = true; };
  }, [customerProfile?.customer_id]);

  useEffect(() => {
    if (!VOUCHER_ENABLED || !customerProfile?.customer_id) return;

    let cancelled = false;
    getCustomerVouchers(customerProfile.customer_id).then(({ data }) => {
      if (cancelled) return;
      const list = data || [];
      setVouchers(list);
      if (list.length > 0) {
        getCustomerVoucherClaims(list.map((v) => v.id)).then(({ data: claims }) => {
          if (!cancelled) setVoucherClaims(claims || []);
        });
      }
    });

    return () => { cancelled = true; };
  }, [customerProfile?.customer_id]);

  useEffect(() => {
    if (!customerProfile?.customer_id) return;

    let cancelled = false;
    getCustomerPackages(customerProfile.customer_id).then(({ data }) => {
      if (!cancelled) setPackages(data || []);
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

  const membershipBranch = useMemo(() => {
    const deposit = [...membershipTransactions]
      .filter((t) => t.kind === 'deposit')
      .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    return deposit?.branch?.name || null;
  }, [membershipTransactions]);

  const isVoucherPast = (v) =>
    v.status === 'fully_redeemed' || (v.expiry_date && new Date(v.expiry_date) < new Date());

  const activeVouchers = useMemo(() => vouchers.filter((v) => !isVoucherPast(v)), [vouchers]);
  const pastVouchers = useMemo(() => vouchers.filter((v) => isVoucherPast(v)), [vouchers]);

  const voucherValue = useMemo(
    () => activeVouchers.reduce((sum, v) => sum + Number(v.remaining_balance ?? v.total_amount_issued ?? 0), 0),
    [activeVouchers]
  );

  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const [activeStat, setActiveStat] = useState(null); // null | 'membership' | 'vouchers' | 'referral' | 'visits'
  const [activeVoucherId, setActiveVoucherId] = useState(null); // set when a specific voucher row was clicked, vs. the summary tile
  const [membershipView, setMembershipView] = useState('overview'); // 'overview' (top tile: past plans) | 'current' (Your membership card: current details + activity)
  const [referralView, setReferralView] = useState('overview'); // 'overview' (top tile: counts only) | 'history' (Your referrals card: full history list)

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
    <div className="min-h-dvh bg-background">
      <header className="px-4 sm:px-6 md:px-8 py-4 sm:py-5 flex items-center justify-between gap-3 border-b border-border bg-surface">
        {TENANT_LOGOS[orgSlug] ? (
          <img
            src={TENANT_LOGOS[orgSlug]}
            alt={orgName || 'Zennly'}
            className="h-9 w-auto flex-shrink-0 ml-2"
          />
        ) : (
          <span className="font-heading font-heading-semibold text-lg text-text-primary tracking-tight truncate">
            {orgName || 'Zennly'}
          </span>
        )}
        <div className="flex items-center gap-3 sm:gap-4 flex-shrink-0">
          <button
            type="button"
            onClick={() => setShowProfileEdit(true)}
            className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            <Icon name="UserCog" size={16} />
            <span className="hidden sm:inline">Edit profile</span>
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            <Icon name="LogOut" size={16} />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </header>

      {showProfileEdit && (
        <CustomerProfileEditModal onClose={() => setShowProfileEdit(false)} />
      )}

      {activeStat === 'membership' && (
        <StatDetailModal
          title={membershipView === 'current' ? 'Your membership' : 'Membership'}
          onClose={() => setActiveStat(null)}
        >
          <div className="max-w-sm mx-auto space-y-4">
            {membership ? (
              <>
                <StatHighlightCard icon="Wallet" value={formatNPR(membership.balance)} label="Balance" />
                {membershipView === 'current' ? (
                  <>
                    <InfoCard className="space-y-2.5">
                      <DetailRow label="Tier" value={membership.tierName || '—'} />
                      <DetailRow label="Total deposited" value={formatNPR(membership.totalDeposited)} />
                      {membership.activationDate && (
                        <DetailRow label="Created" value={formatRelativeDate(membership.activationDate)} />
                      )}
                      {membershipBranch && (
                        <DetailRow label="Branch" value={membershipBranch} />
                      )}
                      {membership.expiryDate && (
                        <DetailRow label="Expires" value={formatRelativeDate(membership.expiryDate)} />
                      )}
                    </InfoCard>
                    <InfoCard className="space-y-3">
                      <p className="font-caption text-xs text-text-secondary uppercase tracking-wide">Activity</p>
                      {membershipTransactions.length > 0 ? (
                        membershipTransactions.map((t) => (
                          <div key={t.id} className="flex items-center justify-between gap-3 py-1.5 border-b border-border last:border-0 last:pb-0">
                            <div className="min-w-0">
                              <p className="font-body text-sm text-text-primary capitalize">
                                {t.booking?.service_name_snapshot || t.kind.replace('_', ' ')}
                              </p>
                              <p className="font-caption text-xs text-text-secondary">
                                {formatDateShort(t.created_at)}
                                {t.branch?.name ? ` · ${t.branch.name}` : ''}
                              </p>
                            </div>
                            <span className={`font-data font-data-medium text-sm flex-shrink-0 ${Number(t.amount) < 0 ? 'text-error' : 'text-success'}`}>
                              {Number(t.amount) < 0 ? '-' : '+'}{formatNPR(Math.abs(t.amount))}
                            </span>
                          </div>
                        ))
                      ) : (
                        <p className="font-body text-sm text-text-secondary">No activity yet.</p>
                      )}
                    </InfoCard>
                  </>
                ) : (
                  <>
                    <InfoCard className="space-y-2.5">
                      <p className="font-caption text-xs text-primary uppercase tracking-wide font-semibold pb-1 border-b border-border">
                        Current membership
                      </p>
                      <DetailRow label="Tier" value={membership.tierName || '—'} />
                      {membershipBranch && (
                        <DetailRow label="Branch" value={membershipBranch} />
                      )}
                      {membership.activationDate && (
                        <DetailRow label="Issued" value={formatDateShort(membership.activationDate)} />
                      )}
                      {membership.expiryDate && (
                        <DetailRow label="Expires" value={formatDateShort(membership.expiryDate)} />
                      )}
                    </InfoCard>
                    {pastMemberships.length > 0 ? (
                      pastMemberships.map((pm, i) => (
                        <InfoCard key={pm.id} className="space-y-2.5">
                          <p className="font-caption text-xs text-warning uppercase tracking-wide font-semibold pb-1 border-b border-border">
                            Past membership{pastMemberships.length > 1 ? ` ${i + 1}` : ''}
                          </p>
                          <DetailRow label="Tier" value={pm.tier?.name || 'Membership'} />
                          <DetailRow label="Total deposited" value={formatNPR(pm.total_deposited)} />
                          {pm.activation_date && (
                            <DetailRow label="Issued" value={formatDateShort(pm.activation_date)} />
                          )}
                          {pm.expiry_date && (
                            <DetailRow label="Expired" value={formatDateShort(pm.expiry_date)} />
                          )}
                        </InfoCard>
                      ))
                    ) : (
                      <EmptyStateCard icon="Wallet" message="No past memberships yet." />
                    )}
                  </>
                )}
              </>
            ) : (
              <EmptyStateCard
                icon="Wallet"
                message="You're not a member yet. Ask our team about membership plans on your next visit."
              />
            )}
          </div>
        </StatDetailModal>
      )}

      {activeStat === 'vouchers' && (() => {
        const scopedVouchers = activeVoucherId
          ? activeVouchers.filter((v) => v.id === activeVoucherId)
          : activeVouchers;
        const scopedClaims = activeVoucherId
          ? voucherClaims.filter((c) => c.voucher_id === activeVoucherId)
          : voucherClaims;
        const highlight = activeVoucherId
          ? {
              value: formatNPR(scopedVouchers[0]?.remaining_balance ?? scopedVouchers[0]?.total_amount_issued ?? 0),
              label: scopedVouchers[0]?.voucher_type?.name || 'Voucher',
            }
          : { value: formatNPR(voucherValue), label: 'Active voucher value' };

        return (
          <StatDetailModal
            title={activeVoucherId ? 'Voucher' : 'Vouchers'}
            onClose={() => { setActiveStat(null); setActiveVoucherId(null); }}
          >
            <div className="max-w-sm mx-auto space-y-4">
              {vouchers.length > 0 ? (
                <>
                  <StatHighlightCard icon="Ticket" value={highlight.value} label={highlight.label} />
                  {scopedVouchers.map((v, i) => (
                    <InfoCard key={v.id} className="space-y-2.5">
                      <p className="font-caption text-xs text-primary uppercase tracking-wide font-semibold pb-1 border-b border-border">
                        Active voucher{scopedVouchers.length > 1 ? ` ${i + 1}` : ''}
                      </p>
                      <DetailRow label="Code" value={v.voucher_code} />
                      <DetailRow label="Total issued" value={formatNPR(v.total_amount_issued)} />
                      {v.branch?.name && <DetailRow label="Branch" value={v.branch.name} />}
                      <DetailRow label="Expires" value={formatRelativeDate(v.expiry_date)} />
                    </InfoCard>
                  ))}
                  {!activeVoucherId && pastVouchers.map((v, i) => (
                    <InfoCard key={v.id} className="space-y-2.5">
                      <p className="font-caption text-xs text-warning uppercase tracking-wide font-semibold pb-1 border-b border-border">
                        Past voucher{pastVouchers.length > 1 ? ` ${i + 1}` : ''}
                      </p>
                      <DetailRow label="Code" value={v.voucher_code} />
                      <DetailRow label="Total issued" value={formatNPR(v.total_amount_issued)} />
                    </InfoCard>
                  ))}
                  {activeVoucherId && (
                    <InfoCard className="space-y-3">
                      <p className="font-caption text-xs text-text-secondary uppercase tracking-wide">Activity</p>
                      {scopedClaims.length > 0 ? (
                        scopedClaims.map((c) => (
                          <div key={c.id} className="flex items-center justify-between gap-3 py-1.5 border-b border-border last:border-0 last:pb-0">
                            <div className="min-w-0">
                              <p className="font-body text-sm text-text-primary truncate">{c.service_claimed || 'Service redemption'}</p>
                              <p className="font-caption text-xs text-text-secondary">
                                {formatDateShort(c.redeemed_date)}{c.branch?.name ? ` · ${c.branch.name}` : ''}
                              </p>
                            </div>
                            <span className="font-data text-sm text-error flex-shrink-0">-{formatNPR(c.amount_claimed)}</span>
                          </div>
                        ))
                      ) : (
                        <p className="font-body text-sm text-text-secondary">No activity yet.</p>
                      )}
                    </InfoCard>
                  )}
                </>
              ) : (
                <EmptyStateCard icon="Ticket" message="No active vouchers yet. Vouchers issued to you will show up here." />
              )}
            </div>
          </StatDetailModal>
        );
      })()}

      {activeStat === 'referral' && (
        <StatDetailModal
          title={referralView === 'history' ? 'Your referrals' : 'Referral earnings'}
          onClose={() => setActiveStat(null)}
        >
          <div className="max-w-sm mx-auto space-y-4">
            {referralStats && referralStats.totalReferred > 0 ? (
              <>
                <StatHighlightCard icon="Users" value={formatNPR(referralStats.totalCredited)} label="Total earned" />
                {referralView === 'history' ? (
                  <InfoCard className="space-y-3">
                    <p className="font-caption text-xs text-text-secondary uppercase tracking-wide">Referral history</p>
                    {referralStats.referrals.map((r) => (
                      <div key={r.id} className="flex items-center justify-between gap-3 py-1.5 border-b border-border last:border-0 last:pb-0">
                        <div className="min-w-0">
                          <p className="font-body text-sm text-text-primary truncate">
                            {r.booking?.service_name_snapshot || 'Referral'}
                          </p>
                          <p className="font-caption text-xs text-text-secondary capitalize">
                            {r.booking?.date ? formatRelativeDate(r.booking.date) : formatDateShort(r.created_at)} · {r.reward_status}
                          </p>
                        </div>
                        <span className="font-data text-sm text-success flex-shrink-0">
                          {r.reward_status === 'credited' ? `+${formatNPR(r.reward_amount)}` : '—'}
                        </span>
                      </div>
                    ))}
                  </InfoCard>
                ) : (
                  <InfoCard className="space-y-2.5">
                    <DetailRow label="Friends referred" value={referralStats.totalReferred} />
                    <DetailRow label="Pending" value={referralStats.pendingCount} />
                  </InfoCard>
                )}
              </>
            ) : (
              <EmptyStateCard
                icon="Users"
                message="You haven't referred anyone yet. Share your name with a friend at checkout to start earning."
              />
            )}
          </div>
        </StatDetailModal>
      )}

      {activeStat === 'visits' && (
        <StatDetailModal title="Total visits" onClose={() => setActiveStat(null)}>
          <div className="max-w-sm mx-auto space-y-4">
            {(() => {
              const completed = bookings
                .filter((b) => b.status === 'completed')
                .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
              if (completed.length === 0) {
                return (
                  <EmptyStateCard icon="Sparkles" message="Your first visit awaits — book a service to get started." />
                );
              }
              return (
                <>
                  <StatHighlightCard icon="Sparkles" value={completed.length} label="Visits completed" />
                  <InfoCard className="space-y-2.5">
                    {completed.map((b) => (
                      <div key={b.bookingId} className="flex items-center justify-between gap-3 py-1.5 border-b border-border last:border-0 last:pb-0">
                        <div className="min-w-0">
                          <p className="font-body text-sm text-text-primary truncate">{b.service}</p>
                          <p className="font-caption text-xs text-text-secondary">
                            {formatRelativeDate(b.date)} · {formatTime12h(b.time)}
                          </p>
                        </div>
                        <span className="font-data text-sm text-text-primary flex-shrink-0">{b.price}</span>
                      </div>
                    ))}
                  </InfoCard>
                </>
              );
            })()}
          </div>
        </StatDetailModal>
      )}

      <main className="max-w-4xl mx-auto px-5 py-6 sm:py-10">
        {/* Hero greeting */}
        <div className="mb-5 sm:mb-8 flex items-end justify-between gap-4 flex-wrap">
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
          <details className="group mb-6 sm:mb-8 relative overflow-hidden bg-surface border border-border rounded-spa-lg shadow-spa-elevated [&_summary::-webkit-details-marker]:hidden">
            <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-accent" />
            <summary className="p-4 pl-6 sm:p-6 sm:pl-7 flex items-center justify-between gap-3 sm:gap-4 flex-wrap cursor-pointer list-none">
              <div>
                <p className="font-caption text-xs text-accent uppercase tracking-widest mb-1">Your next appointment</p>
                <p className="font-heading font-heading-semibold text-lg sm:text-xl text-text-primary mb-0.5">{nextBooking.service}</p>
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
            <div className="px-4 pl-6 sm:px-6 sm:pl-7 pb-4 sm:pb-6 pt-1 border-t border-border space-y-2.5">
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
              showValue={false}
              onClick={() => { setMembershipView('overview'); setActiveStat('membership'); }}
            />
          )}
          {VOUCHER_ENABLED && (
            <StatTile
              icon="Ticket"
              tone="secondary"
              label="Vouchers"
              showValue={false}
              onClick={() => { setActiveVoucherId(null); setActiveStat('vouchers'); }}
            />
          )}
          {CUSTOMER_REFERRALS_ENABLED && (
            <StatTile
              icon="Users"
              tone="accent"
              label="Referral earnings"
              showValue={false}
              onClick={() => { setReferralView('overview'); setActiveStat('referral'); }}
            />
          )}
          <StatTile
            icon="Sparkles"
            tone="success"
            label="Total visits"
            value={bookings.filter((b) => b.status === 'completed').length || null}
            empty={bookings.filter((b) => b.status === 'completed').length === 0}
            emptyLabel="Your first visit awaits"
            onClick={() => setActiveStat('visits')}
          />
        </div>

        <CustomerMembershipSection
          membership={membership}
          onClick={() => { setMembershipView('current'); setActiveStat('membership'); }}
        />
        <CustomerVouchersSection
          vouchers={activeVouchers}
          onClickVoucher={(voucherId) => { setActiveVoucherId(voucherId); setActiveStat('vouchers'); }}
        />
        <CustomerPackagesSection packages={packages} />
        <CustomerReferralStats
          stats={referralStats}
          onClick={() => { setReferralView('history'); setActiveStat('referral'); }}
        />

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
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-caption text-xs text-text-secondary uppercase tracking-wide flex-shrink-0">Branch</span>
        <span className="font-body text-text-primary text-right truncate min-w-0">{booking.branchName}</span>
      </div>
    )}
    {booking.therapist?.name && (
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-caption text-xs text-text-secondary uppercase tracking-wide flex-shrink-0">Staff</span>
        <span className="font-body text-text-primary text-right truncate min-w-0">{booking.therapist.name}</span>
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
