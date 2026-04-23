import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import Image from '../../../components/AppImage';
import Button from '../../../components/ui/Button';
import { useAuth } from '../../../contexts/AuthContext';

const TERMINAL_STATUSES = ['completed', 'cancelled', 'no show'];

const VALID_TRANSITIONS = {
  'pending':      ['confirmed'],
  'confirmed':    ['in-progress', 'cancelled', 'no show'],
  'in-progress':  ['completed'],
};

const LIFECYCLE_STEPS = [
  { key: 'pending', label: 'Pending', icon: 'Clock' },
  { key: 'confirmed', label: 'Confirmed', icon: 'CheckCircle' },
  { key: 'in-progress', label: 'In Progress', icon: 'Play' },
  { key: 'completed', label: 'Completed', icon: 'Check' },
];

function getStepState(stepKey, currentStatus) {
  const TERMINAL_MAP = { cancelled: true, 'no show': true };
  if (TERMINAL_MAP[currentStatus]) return 'inactive';

  const order = { 'pending': 0, 'confirmed': 1, 'in-progress': 2, 'completed': 3 };
  const currentIdx = order[currentStatus] ?? -1;
  const stepIdx = order[stepKey] ?? -1;

  if (stepIdx < currentIdx) return 'done';
  if (stepIdx === currentIdx) return 'active';
  return 'upcoming';
}

function formatNPR(amount) {
  return `NPR ${Number(amount).toLocaleString('en-IN')}`;
}

const BookingDetailsPanel = ({ booking, onStatusUpdate, onRecordPayment, isLoading }) => {
  const navigate = useNavigate();
  const { orgSlug: urlOrgSlug } = useParams();
  const { profile } = useAuth();

  // Get org slug from URL or profile
  const orgSlug = urlOrgSlug || profile?.organizations?.slug;
  const basePath = orgSlug ? `/${orgSlug}/dashboard` : '/branch-manager-dashboard';

  const isTerminal = TERMINAL_STATUSES.includes(booking.status);
  const isLocked = booking.isLocked || booking.is_locked || false;
  const isMutationBlocked = isTerminal || isLocked;

  const nextStatuses = VALID_TRANSITIONS[booking.status] || [];

  const statusOptions = [
    { value: 'confirmed', label: 'Confirmed', color: 'success', icon: 'CheckCircle' },
    { value: 'pending', label: 'Pending', color: 'warning', icon: 'Clock' },
    { value: 'cancelled', label: 'Cancelled', color: 'error', icon: 'XCircle' },
    { value: 'completed', label: 'Completed', color: 'text-secondary', icon: 'Check' }
  ];

  const getStatusConfig = (status) => {
    return statusOptions.find(opt => opt.value === status) || statusOptions[1];
  };

  // Determine lock reason for tooltip
  let lockReason = null;
  if (isLocked) {
    lockReason = 'Day Closed — Financial records are locked';
  } else if (isTerminal) {
    lockReason = `${booking.status.replace('-', ' ')} bookings cannot be modified`;
  }

  const handleViewAudit = () => {
    const recordId = booking.bookingId || booking.id;
    navigate(`${basePath}?view=audit&recordId=${recordId}`);
  };

  return (
    <div className="space-y-6">
      {/* Lock / Immutability Banners */}
      {isLocked && (
        <div className="flex items-center space-x-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-spa">
          <Icon name="Lock" size={16} className="text-amber-600 flex-shrink-0" />
          <span className="font-body font-body-medium text-xs text-amber-700">
            Day Closed — Locked
          </span>
        </div>
      )}
      {isTerminal && !isLocked && (() => {
        const banner = booking.status === 'completed'
          ? booking.paymentStatus === 'paid'
            ? { bg: 'bg-success/5', border: 'border-success/20', color: 'text-success', icon: 'ShieldCheck', label: 'Completed — Settled' }
            : { bg: 'bg-warning/5', border: 'border-warning/20', color: 'text-warning', icon: 'Clock', label: 'Service Completed — Payment Pending' }
          : { bg: 'bg-gray-50', border: 'border-gray-200', color: 'text-gray-600', iconColor: 'text-gray-500', icon: 'ShieldCheck', label: booking.status === 'cancelled' ? 'Cancelled — Immutable' : 'No Show — Immutable' };
        const iconColor = banner.iconColor || banner.color;
        return (
          <div className={`flex items-center space-x-2 px-3 py-2 ${banner.bg} border ${banner.border} rounded-spa`}>
            <Icon name={banner.icon} size={16} className={`${iconColor} flex-shrink-0`} />
            <span className={`font-body font-body-medium text-xs ${banner.color}`}>
              {banner.label}
            </span>
          </div>
        );
      })()}

      {/* Booking Header */}
      <div className="flex items-center space-x-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-primary/10">
          <Icon name="Calendar" size={20} className="text-primary" />
        </div>
        <div>
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary">
            Booking #{booking.id || booking.booking_number}
          </h3>
          <p className="font-caption font-caption-normal text-sm text-text-secondary">
            {booking.date} at {booking.time}
          </p>
        </div>
      </div>

      {/* Lifecycle Progress Bar */}
      {['cancelled', 'no show'].includes(booking.status) ? (
        <div className="flex items-center space-x-2 px-3 py-2 bg-error/5 border border-error/20 rounded-spa">
          <Icon name="XCircle" size={16} className="text-error flex-shrink-0" />
          <span className="font-body font-body-medium text-sm text-error capitalize">
            {booking.status === 'no show' ? 'No Show' : 'Cancelled'}
          </span>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          {LIFECYCLE_STEPS.map((step, idx) => {
            const state = getStepState(step.key, booking.status);
            return (
              <React.Fragment key={step.key}>
                {idx > 0 && (
                  <div className={`flex-1 h-0.5 mx-1 rounded ${
                    state === 'done' || state === 'active' ? 'bg-primary' : 'bg-border'
                  }`} />
                )}
                <div className="flex flex-col items-center min-w-0">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    state === 'done' ? 'bg-primary text-primary-foreground'
                    : state === 'active' ? 'bg-primary/10 border-2 border-primary text-primary'
                    : 'bg-background border border-border text-text-tertiary'
                  }`}>
                    <Icon name={state === 'done' ? 'Check' : step.icon} size={14} />
                  </div>
                  <span className={`font-caption font-caption-normal text-[10px] mt-1 text-center ${
                    state === 'active' ? 'text-primary font-caption-medium' : 'text-text-tertiary'
                  }`}>
                    {step.label}
                  </span>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      )}

      {/* Quick Status Actions — only show valid transitions */}
      {nextStatuses.length > 0 && !isMutationBlocked ? (
        <div className="grid grid-cols-2 gap-2">
          {nextStatuses.map((statusValue) => {
            const config = getStatusConfig(statusValue);
            return (
              <button
                key={statusValue}
                onClick={() => onStatusUpdate(statusValue)}
                disabled={isLoading}
                className={`flex items-center justify-center space-x-2 px-3 py-2 rounded-spa border spa-transition-fast spa-touch-target border-border hover:border-primary/50 text-text-secondary hover:text-text-primary ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <Icon name={config.icon} size={16} />
                <span className="font-body font-body-medium text-xs capitalize">{statusValue.replace('-', ' ')}</span>
              </button>
            );
          })}
        </div>
      ) : isMutationBlocked ? (
        <div className="flex items-center space-x-2 px-3 py-2 bg-background rounded-spa border border-border" title={lockReason}>
          <Icon name="Lock" size={14} className="text-text-tertiary" />
          <span className="font-body text-xs text-text-tertiary">
            {lockReason}
          </span>
        </div>
      ) : null}

      {/* Customer Information */}
      <div className="space-y-4">
        <h4 className="font-heading font-heading-medium text-base text-text-primary flex items-center space-x-2">
          <Icon name="User" size={18} className="text-primary" />
          <span>Customer Information</span>
        </h4>

        <div className="bg-background rounded-spa p-4 space-y-3">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
              <Icon name="User" size={20} className="text-primary" />
            </div>
            <div className="flex-1">
              <p className="font-body font-body-semibold text-base text-text-primary">
                {booking.customerName}
              </p>
              {(booking.customerGender || booking.customerAge) && (
                <p className="font-caption font-caption-normal text-sm text-text-secondary">
                  {[booking.customerGender, booking.customerAge ? `${booking.customerAge} years old` : null].filter(Boolean).join(' \u00B7 ')}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 pt-2">
            {booking.customerEmail && (
              <div className="flex items-center space-x-3">
                <Icon name="Mail" size={16} className="text-text-secondary" />
                <span className="font-body font-body-normal text-sm text-text-primary">
                  {booking.customerEmail}
                </span>
              </div>
            )}
            {booking.customerPhone && (
              <div className="flex items-center space-x-3">
                <Icon name="Phone" size={16} className="text-text-secondary" />
                <span className="font-body font-body-normal text-sm text-text-primary">
                  {booking.customerPhone}
                </span>
              </div>
            )}
            {booking.branch && (
              <div className="flex items-center space-x-3">
                <Icon name="MapPin" size={16} className="text-text-secondary" />
                <span className="font-body font-body-normal text-sm text-text-primary">
                  {booking.branch}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Service Details */}
      <div className="space-y-4">
        <h4 className="font-heading font-heading-medium text-base text-text-primary flex items-center space-x-2">
          <Icon name="Sparkles" size={18} className="text-primary" />
          <span>Service Details</span>
        </h4>

        <div className="bg-background rounded-spa p-4 space-y-4">
          <div className="flex items-start space-x-3">
            <Image
              src="https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=80&h=80&fit=crop&crop=center"
              alt={booking.service}
              className="w-16 h-16 rounded-spa object-cover"
            />
            <div className="flex-1">
              <h5 className="font-body font-body-semibold text-base text-text-primary">
                {booking.service}
              </h5>
              {booking.serviceDescription && (
                <p className="font-caption font-caption-normal text-sm text-text-secondary mt-1">
                  {booking.serviceDescription}
                </p>
              )}
              <div className="flex items-center space-x-4 mt-2">
                <span className="flex items-center space-x-1 text-text-secondary">
                  <Icon name="Clock" size={14} />
                  <span className="font-caption font-caption-normal text-xs">{booking.duration}</span>
                </span>
                <span className="flex items-center space-x-1 text-text-secondary">
                  <Icon name="DollarSign" size={14} />
                  <span className="font-caption font-caption-normal text-xs">{booking.price}</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Financial Summary (Read-Only) */}
      <div className="space-y-4">
        <h4 className="font-heading font-heading-medium text-base text-text-primary flex items-center space-x-2">
          <Icon name="Receipt" size={18} className="text-primary" />
          <span>Financial Summary</span>
        </h4>

        <div className="bg-background rounded-spa p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-body font-body-medium text-sm text-text-secondary">Base Amount</span>
            <span className="font-data font-data-normal text-sm text-text-primary">
              {formatNPR(booking.base_amount ?? booking.baseAmount ?? 0)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-body font-body-medium text-sm text-text-secondary">Discount</span>
            <span className={`font-data font-data-normal text-sm ${Number(booking.discount_amount ?? booking.discountAmount ?? 0) > 0 ? 'text-error' : 'text-text-primary'}`}>
              {Number(booking.discount_amount ?? booking.discountAmount ?? 0) > 0 ? '-' : ''}
              {formatNPR(booking.discount_amount ?? booking.discountAmount ?? 0)}
            </span>
          </div>
          <div className="border-t border-border pt-2 flex items-center justify-between">
            <span className="font-body font-body-semibold text-sm text-text-primary">Final Amount</span>
            <span className="font-data font-data-normal text-sm font-semibold text-text-primary">
              {formatNPR(booking.final_amount ?? booking.finalAmount ?? 0)}
            </span>
          </div>
          <div className="border-t border-border pt-2 flex items-center justify-between">
            <span className="font-body font-body-medium text-sm text-text-secondary">Payment Status</span>
            {booking.paymentStatus === 'paid' ? (
              <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-success/10 text-success text-xs font-caption font-caption-medium">
                <Icon name="CheckCircle" size={12} />
                <span>Paid</span>
              </span>
            ) : (
              <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-warning/10 text-warning text-xs font-caption font-caption-medium">
                <Icon name="Clock" size={12} />
                <span>Unpaid</span>
              </span>
            )}
          </div>

          {/* Record Payment button — allowed on Confirmed, In-Progress, and Completed (pay-after-service is standard). */}
          {booking.paymentStatus !== 'paid'
            && ['confirmed', 'in-progress', 'completed'].includes(booking.status)
            && !isLocked
            && onRecordPayment && (
            <Button
              variant="success"
              size="sm"
              fullWidth
              iconName="CreditCard"
              iconPosition="left"
              onClick={onRecordPayment}
              disabled={isLoading}
            >
              Record Payment
            </Button>
          )}

          {/* Locked payment explanation */}
          {booking.paymentStatus !== 'paid' && isLocked && (
            <p className="font-body text-xs text-text-tertiary flex items-center space-x-1">
              <Icon name="Lock" size={12} className="text-text-tertiary" />
              <span>Payment recording disabled — day is closed</span>
            </p>
          )}
        </div>
      </div>

      {/* Special Requests */}
      {booking.specialRequests && (
        <div className="space-y-4">
          <h4 className="font-heading font-heading-medium text-base text-text-primary flex items-center space-x-2">
            <Icon name="MessageSquare" size={18} className="text-primary" />
            <span>Special Requests</span>
          </h4>

          <div className="bg-warning/5 border border-warning/20 rounded-spa p-4">
            <p className="font-body font-body-normal text-sm text-text-primary">
              {booking.specialRequests}
            </p>
          </div>
        </div>
      )}

      {/* Audit Shortcut */}
      {(booking.bookingId || booking.id) && (
        <button
          onClick={handleViewAudit}
          className="flex items-center space-x-2 text-primary hover:text-primary/80 spa-transition-fast"
        >
          <Icon name="Shield" size={16} />
          <span className="font-body font-body-medium text-sm underline underline-offset-2">
            View Audit History
          </span>
        </button>
      )}

      {/* Customer Preferences */}
      {(booking.therapistGenderPreference || booking.pressureLevel || booking.roomTemperature) && (
        <div className="space-y-4">
          <h4 className="font-heading font-heading-medium text-base text-text-primary flex items-center space-x-2">
            <Icon name="Settings" size={18} className="text-primary" />
            <span>Preferences</span>
          </h4>

          <div className="bg-background rounded-spa p-4 space-y-3">
            {booking.therapistGenderPreference && (
              <div className="flex items-center justify-between">
                <span className="font-body font-body-medium text-sm text-text-secondary">
                  Therapist Gender Preference
                </span>
                <span className="font-body font-body-normal text-sm text-text-primary capitalize">
                  {booking.therapistGenderPreference}
                </span>
              </div>
            )}
            {booking.pressureLevel && (
              <div className="flex items-center justify-between">
                <span className="font-body font-body-medium text-sm text-text-secondary">
                  Pressure Level
                </span>
                <span className="font-body font-body-normal text-sm text-text-primary capitalize">
                  {booking.pressureLevel}
                </span>
              </div>
            )}
            {booking.roomTemperature && (
              <div className="flex items-center justify-between">
                <span className="font-body font-body-medium text-sm text-text-secondary">
                  Room Temperature
                </span>
                <span className="font-body font-body-normal text-sm text-text-primary capitalize">
                  {booking.roomTemperature}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Previous Visits */}
      {booking.previousVisits && booking.previousVisits.length > 0 && (
        <div className="space-y-4">
          <h4 className="font-heading font-heading-medium text-base text-text-primary flex items-center space-x-2">
            <Icon name="History" size={18} className="text-primary" />
            <span>Previous Visits</span>
          </h4>

          <div className="space-y-2">
            {booking.previousVisits.slice(0, 3).map((visit, index) => (
              <div key={index} className="flex items-center space-x-3 p-3 bg-background rounded-spa">
                <div className="w-2 h-2 bg-success rounded-full"></div>
                <div className="flex-1">
                  <p className="font-body font-body-medium text-sm text-text-primary">
                    {visit.service}
                  </p>
                  <p className="font-caption font-caption-normal text-xs text-text-secondary">
                    {visit.date} {visit.therapist ? `\u00B7 ${visit.therapist}` : ''}
                  </p>
                </div>
                {visit.rating && (
                  <span className="font-caption font-caption-normal text-xs text-text-secondary">
                    {visit.rating}/5
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default BookingDetailsPanel;
