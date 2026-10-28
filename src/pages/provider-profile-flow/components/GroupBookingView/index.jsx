import React, { useState, useLayoutEffect } from 'react';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import DiscardDialog from '../BookingView/DiscardDialog';
import GuestsStep from './GuestsStep';
import GroupProfessionalStep from './GroupProfessionalStep';
import GroupTimeStep from './GroupTimeStep';
import GroupConfirmStep, { mapBookingError } from './GroupConfirmStep';
import { addGuest, removeGuest, updateGuestField } from '../../utils/groupBooking';
import { submitGroupBooking } from '../../../../services/api';
import { toE164 } from '../../../../utils/phone';
import { scrollToTopInstant } from '../../../../utils/scroll';

const STEP_HEADINGS = {
  guests: 'Add guests and services',
  professional: 'Select professional',
  time: 'Select date and time',
  confirm: 'Your details',
};

const STEPS = [
  { key: 'guests', label: 'Guests' },
  { key: 'professional', label: 'Professional' },
  { key: 'time', label: 'Time' },
  { key: 'confirm', label: 'Confirm' },
];

// Group-booking counterpart to BookingView — same full-page step-machine shell, but
// for N people instead of one. `people` is owned by the parent (ProviderProfileFlow),
// same split BookingView itself uses: ephemeral step/UI state lives here, the actual
// selections live one level up so closing never loses them.
const GroupBookingView = ({
  onClose,
  orgSlug,
  selectedBranch,
  services,
  people,
  onPeopleChange,
  therapists,
  loadingTherapists,
  therapistsError,
  onRetryTherapists,
  customerAccountId,
  onGroupBookingComplete,
}) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [activeGuestId, setActiveGuestId] = useState('lead');
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [professionalMode, setProfessionalMode] = useState(null); // null | 'any' | 'per-guest'
  const [selectedDateTime, setSelectedDateTime] = useState({ date: '', time: '' });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [leadContact, setLeadContact] = useState({
    firstName: '', lastName: '', email: '', phone: '', phoneCountryCode: '+977', gender: '',
    referralSource: '', referralClientName: '', referralPhone: '', referralCountryCode: '+977',
    referralSocialPlatform: '', referralStaffName: '', specialRequests: '', agreeToTerms: false,
  });

  useLayoutEffect(() => {
    scrollToTopInstant();
  }, [stepIndex]);

  const currentStep = STEPS[stepIndex]?.key;

  const canContinue = {
    guests: people.every((p) => !!p.service),
    professional: people.every((p) => !!p.professional),
    time: !!(selectedDateTime.date && selectedDateTime.time),
    confirm: false, // GroupConfirmStep (Task 8) owns its own submit gating
  };

  const goBack = () => setStepIndex((i) => Math.max(0, i - 1));
  const goNext = () => setStepIndex((i) => Math.min(STEPS.length - 1, i + 1));
  const handleBack = stepIndex > 0 ? goBack : onClose;
  const handleContinue = goNext;

  const handleAddGuest = () => onPeopleChange(addGuest(people));
  const handleRemoveGuest = (guestId) => {
    onPeopleChange(removeGuest(people, guestId));
    if (activeGuestId === guestId) setActiveGuestId('lead');
  };
  const handleServiceChosenForActiveGuest = (service) => {
    onPeopleChange(updateGuestField(people, activeGuestId, 'service', service));
  };

  const handleSelectAnyForAll = () => {
    onPeopleChange(people.map((p) => ({ ...p, professional: { mode: 'any' } })));
    setProfessionalMode('any');
  };
  const handleSelectPerGuestMode = () => setProfessionalMode('per-guest');
  const handlePersonProfessionalSelect = (personId, selection) => {
    onPeopleChange(updateGuestField(people, personId, 'professional', selection));
  };

  const handleGuestNameChange = (guestId, name) => {
    onPeopleChange(updateGuestField(people, guestId, 'name', name));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);

    const resolvedPeople = people.map((p) => ({
      isLead: p.isLead,
      label: p.label,
      name: p.name,
      service: p.service,
      therapistId: p.professional?.mode === 'specific' ? (p.professional.therapist?.id || null) : null,
    }));

    const { data, error } = await submitGroupBooking({
      branchId: selectedBranch?.id,
      orgSlug,
      date: selectedDateTime.date,
      startTime: selectedDateTime.time,
      // v1 group booking has no gender-preference or special-requests UI of its own —
      // every row gets the branch default / the lead's shared special request text.
      genderPreference: 'no-preference',
      specialRequests: leadContact.specialRequests || null,
      leadContact: {
        name: `${leadContact.firstName} ${leadContact.lastName}`.trim(),
        email: leadContact.email || null,
        phone: toE164(leadContact.phone, leadContact.phoneCountryCode || '+977'),
        gender: leadContact.gender || null,
      },
      people: resolvedPeople,
    });

    setSubmitting(false);

    if (error) {
      console.error('[GroupBookingView] submitGroupBooking failed:', error.code, error.message);
      setSubmitError(mapBookingError(error));
      return;
    }

    // Parent (index.jsx) doesn't track this view's own date/time or people selections —
    // they're carried along here so handleGroupBookingComplete can build BookingSuccess's
    // bookingData shape without needing a second source of truth for them.
    onGroupBookingComplete({ bookings: data.bookings, selectedDateTime, people, leadContact });
  };

  return (
    <div className="zn-scope min-h-screen bg-[var(--zn-background)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-5 flex items-center justify-between">
        <button
          onClick={handleBack}
          aria-label="Back"
          className="w-10 h-10 rounded-full border border-[var(--zn-border)] bg-[var(--zn-card)] flex items-center justify-center hover:border-[var(--zn-foreground)]/40"
        >
          <Icon name="ArrowLeft" size={18} className="text-[var(--zn-foreground)]" />
        </button>

        <button
          onClick={() => setConfirmingClose(true)}
          aria-label="Close booking"
          className="w-10 h-10 rounded-full border border-[var(--zn-border)] bg-[var(--zn-card)] flex items-center justify-center hover:border-[var(--zn-foreground)]/40"
        >
          <Icon name="X" size={18} className="text-[var(--zn-foreground)]" />
        </button>
      </div>

      {confirmingClose && (
        <DiscardDialog onCancel={() => setConfirmingClose(false)} onConfirm={onClose} />
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-28 lg:pb-16">
        <nav aria-label="Group booking steps" className="flex items-center gap-2 flex-wrap mt-4">
          {STEPS.map((s, i) => (
            <React.Fragment key={s.key}>
              {i > 0 && <Icon name="ChevronRight" size={14} className="text-[var(--zn-muted-foreground)]" />}
              <button
                type="button"
                disabled={i >= stepIndex}
                onClick={() => setStepIndex(i)}
                aria-current={i === stepIndex ? 'step' : undefined}
                className={`text-sm transition-colors ${
                  i === stepIndex
                    ? 'font-semibold text-[var(--zn-foreground)]'
                    : i < stepIndex
                      ? 'text-[var(--zn-muted-foreground)] hover:text-[var(--zn-foreground)] underline'
                      : 'text-[var(--zn-muted-foreground)]/50 cursor-default'
                }`}
              >
                {s.label}
              </button>
            </React.Fragment>
          ))}
        </nav>

        <h1 className="font-normal text-[32px] sm:text-[40px] tracking-[-0.01em] text-[var(--zn-foreground)] mt-4 mb-6">
          {STEP_HEADINGS[currentStep]}
        </h1>

        <div className="max-w-2xl">
          {currentStep === 'guests' && (
            <GuestsStep
              people={people}
              services={services}
              activeGuestId={activeGuestId}
              onSelectActiveGuest={setActiveGuestId}
              onServiceChosenForActiveGuest={handleServiceChosenForActiveGuest}
              onAddGuest={handleAddGuest}
              onRemoveGuest={handleRemoveGuest}
            />
          )}

          {currentStep === 'professional' && (
            <GroupProfessionalStep
              people={people}
              therapists={therapists}
              loading={loadingTherapists}
              error={therapistsError}
              onRetry={onRetryTherapists}
              mode={professionalMode}
              onSelectAnyForAll={handleSelectAnyForAll}
              onSelectPerGuestMode={handleSelectPerGuestMode}
              onPersonProfessionalSelect={handlePersonProfessionalSelect}
            />
          )}

          {currentStep === 'time' && (
            <GroupTimeStep
              selectedBranch={selectedBranch}
              orgSlug={orgSlug}
              people={people}
              therapists={therapists}
              selectedDateTime={selectedDateTime}
              onDateTimeSelect={setSelectedDateTime}
            />
          )}

          {currentStep === 'confirm' && (
            <GroupConfirmStep
              people={people}
              leadContact={leadContact}
              onLeadContactChange={setLeadContact}
              selectedBranch={selectedBranch}
              selectedDateTime={selectedDateTime}
              orgSlug={orgSlug}
              customerAccountId={customerAccountId}
              onGuestNameChange={handleGuestNameChange}
              onSubmit={handleSubmit}
              submitting={submitting}
              submitError={submitError}
            />
          )}
        </div>
      </div>

      {currentStep !== 'confirm' && (
        <div className="lg:hidden fixed bottom-0 inset-x-0 z-sticky-filter border-t border-[var(--zn-border)] bg-[var(--zn-card)] px-4 py-3">
          <Button
            variant="primary"
            onClick={handleContinue}
            disabled={!canContinue[currentStep]}
            className={`w-full justify-center rounded-[var(--zn-radius-md)] border-0 ${
              !canContinue[currentStep]
                ? 'bg-[var(--zn-muted)] text-[var(--zn-muted-foreground)]'
                : 'bg-[var(--zn-primary)] hover:bg-[var(--zn-primary-hover)] text-[var(--zn-primary-foreground)]'
            }`}
          >
            Continue
          </Button>
        </div>
      )}

      {currentStep !== 'confirm' && (
        <div className="hidden lg:block max-w-7xl mx-auto px-4 sm:px-6 pb-16">
          <Button
            variant="primary"
            onClick={handleContinue}
            disabled={!canContinue[currentStep]}
          >
            Continue
          </Button>
        </div>
      )}
    </div>
  );
};

export default GroupBookingView;
