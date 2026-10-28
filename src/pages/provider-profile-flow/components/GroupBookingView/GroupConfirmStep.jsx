import React from 'react';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import Input from '../../../../components/ui/Input';
import CustomerForm from '../../../customer-booking-flow/components/CustomerForm';
import { formatNPR } from '../../../../services/bookingTransformers';

// Same list createBooking()/createBookingGroup() error codes map to customer-safe
// copy for in BookingConfirmation.jsx (customer-booking-flow) — kept in sync there;
// submitGroupBooking (api.js) reuses the exact same codes, so the same list applies here.
const KNOWN_BOOKING_ERROR_CODES = [
  'COUPLE_SERVICE_NOT_ALLOWED_IN_GROUP', 'ROOMS_FULL', 'ROOM_FULL', 'INVALID_ROOM',
  'ROOM_INACTIVE', 'INVALID_THERAPIST', 'THERAPIST_INACTIVE', 'THERAPIST_ABSENT',
  'THERAPIST_CHECKED_OUT', 'THERAPIST_NOT_ELIGIBLE', 'BOOKING_GROUP_PARTIAL',
  'NO_SERVICES', 'THERAPIST_CONFLICT', 'BRANCH_ONLINE_CAPACITY', 'BOOKING_CROSSES_MIDNIGHT',
  'BOOKING_CONFIRMATION_UNAVAILABLE',
];

export const mapBookingError = (error) => {
  if (!error) return null;
  return KNOWN_BOOKING_ERROR_CODES.includes(error.code) && error.message
    ? error.message
    : 'Something went wrong while confirming your booking. Please try again.';
};

const priceOf = (service) => Number(service?.effective_price_npr ?? service?.price_npr ?? 0);

const GroupConfirmStep = ({ people, leadContact, onLeadContactChange, selectedBranch, selectedDateTime, orgSlug, genderPreference, customerAccountId, onGuestNameChange, onSubmit, submitting, submitError }) => {
  const total = people.reduce((sum, p) => sum + priceOf(p.service), 0);

  return (
    <div className="space-y-6">
      <CustomerForm
        customerInfo={leadContact}
        onCustomerInfoChange={onLeadContactChange}
        selectedBranch={selectedBranch}
        selectedService={null}
        selectedDateTime={selectedDateTime}
        genderPreference={genderPreference}
        orgSlug={orgSlug}
        showSummary={false}
      />

      <div className="bg-[var(--zn-card)] border border-[var(--zn-border)] rounded-[var(--zn-radius-lg)] p-5 space-y-4">
        <h3 className="font-medium text-base text-[var(--zn-foreground)]">Your group</h3>

        {people.map((person) => (
          <div key={person.id} className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              {person.isLead ? (
                <p className="text-sm font-medium text-[var(--zn-foreground)]">
                  {leadContact.firstName || 'Me'} {leadContact.lastName}
                </p>
              ) : (
                <Input
                  value={person.name || ''}
                  placeholder={person.label}
                  onChange={(e) => onGuestNameChange(person.id, e.target.value)}
                  className="text-sm"
                />
              )}
              <p className="text-xs text-[var(--zn-muted-foreground)] truncate">{person.service?.name}</p>
            </div>
            <span className="text-sm text-[var(--zn-foreground)] shrink-0 font-mono">
              {formatNPR(priceOf(person.service))}
            </span>
          </div>
        ))}

        <div className="pt-3 border-t border-[var(--zn-border)] flex items-center justify-between">
          <span className="font-medium text-sm text-[var(--zn-foreground)]">Total</span>
          <span className="font-semibold text-base text-[var(--zn-foreground)] font-mono">{formatNPR(total)}</span>
        </div>
      </div>

      {submitError && (
        <div className="flex items-center gap-2 px-4 py-3 bg-error/5 border border-error/20 rounded-[var(--zn-radius-lg)] text-sm text-[var(--zn-foreground)]">
          <Icon name="AlertCircle" size={16} className="text-error shrink-0" />
          <span>{submitError}</span>
        </div>
      )}

      <Button variant="primary" onClick={onSubmit} disabled={submitting} className="w-full justify-center">
        {submitting ? 'Booking…' : `Confirm group booking — ${formatNPR(total)}`}
      </Button>
    </div>
  );
};

export default GroupConfirmStep;
