import React, { useState } from 'react';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import Input from '../../../../components/ui/Input';
import CountryCodeSelect from '../../../../components/ui/CountryCodeSelect';
import CustomerForm from '../../../customer-booking-flow/components/CustomerForm';
import { useResolvedServicePricing } from '../../../../hooks/useCustomerServicePricing';
import { mapBookingError } from '../../../../services/bookingErrorMessages';
import { isValidPhoneForCountry } from '../../../../utils/phone';
import { isCustomerInfoValid } from '../../utils/customerInfoValid';

const GUEST_GENDER_OPTIONS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
];

export { mapBookingError };

// The lead contact has the same shape (and the same Terms checkbox) as solo's customerInfo,
// so it composes the shared validator directly -- including agreeToTerms. Guests below do
// NOT compose this: they have no checkbox of their own, and calling this on a guest would
// silently make Terms a per-guest requirement, which is explicitly not the design.
export const isLeadContactValid = (leadContact) => isCustomerInfoValid(leadContact);

// A guest row with every field still blank is valid as-is — submitGroupBooking
// (api.js) fills a fully-blank guest in with the lead's own name/email/phone/gender
// (ZNLY-184's established fallback, now extended beyond just name). The moment a
// guest provides ANY of their own info, they're held to the same bar the lead
// already is (isLeadContactValid above) so a half-filled guest row can't silently
// submit with a missing phone etc.
const isGuestFilled = (person) => Boolean(
  person.firstName?.trim() || person.lastName?.trim() || person.email?.trim() ||
  person.phone?.trim() || person.gender
);

export const isGuestContactValid = (person) => {
  if (!isGuestFilled(person)) return true;
  if (!person.firstName?.trim()) return false;
  if (person.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email)) return false;
  return isValidPhoneForCountry(person.phone, person.phoneCountryCode);
};

const GroupConfirmStep = ({ people, leadContact, onLeadContactChange, selectedBranch, selectedDateTime, orgSlug, genderPreference, customerAccountId, onGuestFieldChange, onSubmit, submitting, submitError }) => {
  const pricingItems = people.map((p) => ({
    key: p.id,
    service: p.service,
    therapistId: p.professional?.mode === 'specific' ? (p.professional.therapist?.id || null) : null,
  }));
  const { perItem, totalLabel } = useResolvedServicePricing(pricingItems);
  const labelFor = (personId) => perItem.find((p) => p.key === personId)?.label ?? null;

  // Collapsed by default — a guest already carrying info (e.g. navigated back to
  // this step) starts expanded so their filled-in fields stay visible, not hidden
  // behind a closed toggle.
  const [expandedGuestIds, setExpandedGuestIds] = useState(
    () => new Set(people.filter((p) => !p.isLead && isGuestFilled(p)).map((p) => p.id))
  );
  const toggleGuestExpanded = (guestId) => setExpandedGuestIds((prev) => {
    const next = new Set(prev);
    if (next.has(guestId)) next.delete(guestId); else next.add(guestId);
    return next;
  });

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
          <div key={person.id} className={person.isLead ? 'flex items-center justify-between gap-3' : 'space-y-2.5'}>
            {person.isLead ? (
              <>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[var(--zn-foreground)]">
                    {leadContact.firstName || 'Me'} {leadContact.lastName}
                  </p>
                  <p className="text-xs text-[var(--zn-muted-foreground)] truncate">{person.service?.name}</p>
                </div>
                {labelFor(person.id) != null && (
                  <span className="text-sm text-[var(--zn-foreground)] shrink-0 font-mono">
                    {labelFor(person.id)}
                  </span>
                )}
              </>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-medium text-[var(--zn-muted-foreground)]">{person.label}</p>
                  {labelFor(person.id) != null && (
                    <span className="text-sm text-[var(--zn-foreground)] shrink-0 font-mono">
                      {labelFor(person.id)}
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--zn-muted-foreground)] truncate -mt-1.5">{person.service?.name}</p>

                <button
                  type="button"
                  onClick={() => toggleGuestExpanded(person.id)}
                  className="flex items-center gap-1.5 text-xs font-medium text-primary"
                >
                  <Icon name={expandedGuestIds.has(person.id) ? 'ChevronDown' : 'ChevronRight'} size={14} />
                  <span>
                    {isGuestFilled(person)
                      ? `${person.label}'s information`
                      : `Add ${person.label.toLowerCase()}'s information`}
                  </span>
                  {!expandedGuestIds.has(person.id) && !isGuestFilled(person) && (
                    <span className="text-[var(--zn-muted-foreground)] font-normal">
                      (optional — defaults to {leadContact.firstName || 'your'} details)
                    </span>
                  )}
                </button>

                {expandedGuestIds.has(person.id) && (
                  <div className="space-y-2.5 pt-1">
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        value={person.firstName || ''}
                        placeholder="First name"
                        onChange={(e) => onGuestFieldChange(person.id, 'firstName', e.target.value)}
                        className="text-sm"
                      />
                      <Input
                        value={person.lastName || ''}
                        placeholder="Last name"
                        onChange={(e) => onGuestFieldChange(person.id, 'lastName', e.target.value)}
                        className="text-sm"
                      />
                    </div>
                    <Input
                      type="email"
                      value={person.email || ''}
                      placeholder="Email address"
                      onChange={(e) => onGuestFieldChange(person.id, 'email', e.target.value)}
                      className="text-sm"
                    />
                    <div className="flex">
                      <CountryCodeSelect
                        value={person.phoneCountryCode || '+977'}
                        onChange={(dial) => onGuestFieldChange(person.id, 'phoneCountryCode', dial)}
                      />
                      <div className="flex-1">
                        <Input
                          type="tel"
                          value={person.phone || ''}
                          placeholder="Phone number"
                          onChange={(e) => onGuestFieldChange(person.id, 'phone', e.target.value)}
                          className="w-full rounded-l-none text-sm"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {GUEST_GENDER_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => onGuestFieldChange(person.id, 'gender', person.gender === option.value ? '' : option.value)}
                          className={`py-1.5 rounded-[var(--zn-radius)] border text-xs font-medium spa-transition-fast ${
                            person.gender === option.value
                              ? 'border-primary bg-primary/5 text-primary'
                              : 'border-[var(--zn-border)] text-[var(--zn-muted-foreground)] hover:border-primary/50'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    {!isGuestContactValid(person) && (
                      <p className="text-xs text-error flex items-center gap-1">
                        <Icon name="AlertCircle" size={12} />
                        <span>First name and a valid phone number are required once you fill in {person.label.toLowerCase()}'s details.</span>
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        ))}

        <div className="pt-3 border-t border-[var(--zn-border)] flex items-center justify-between">
          <span className="font-medium text-sm text-[var(--zn-foreground)]">Total</span>
          <span className="font-semibold text-base text-[var(--zn-foreground)] font-mono">{totalLabel}</span>
        </div>
      </div>

      {submitError && (
        <div className="flex items-center gap-2 px-4 py-3 bg-error/5 border border-error/20 rounded-[var(--zn-radius-lg)] text-sm text-[var(--zn-foreground)]">
          <Icon name="AlertCircle" size={16} className="text-error shrink-0" />
          <span>{submitError}</span>
        </div>
      )}

      <Button
        variant="primary"
        onClick={onSubmit}
        disabled={submitting || !isLeadContactValid(leadContact) || people.some((p) => !p.isLead && !isGuestContactValid(p))}
        className="w-full justify-center"
      >
        {submitting ? 'Booking…' : `Confirm group booking — ${totalLabel}`}
      </Button>
    </div>
  );
};

export default GroupConfirmStep;
