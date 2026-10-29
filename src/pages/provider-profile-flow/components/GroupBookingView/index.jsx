import React, { useState, useEffect, useLayoutEffect, useMemo } from 'react';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import CustomerHeader from '../../../../components/ui/CustomerHeader';
import ProfileHero from '../ProfileHero';
import GroupSummaryCard from './GroupSummaryCard';
import GuestsStep from './GuestsStep';
import GroupProfessionalStep from './GroupProfessionalStep';
import GroupTimeStep from './GroupTimeStep';
import GroupConfirmStep, { mapBookingError } from './GroupConfirmStep';
import { addGuest, removeGuest, updateGuestField, MAX_GROUP_SIZE } from '../../utils/groupBooking';
import { submitGroupBooking } from '../../../../services/api';
import { toE164 } from '../../../../utils/phone';
import { scrollToTopInstant } from '../../../../utils/scroll';

const STEP_HEADINGS = {
  guests: 'Add guests and services',
  professional: 'Select professional',
  time: 'Select date and time',
  confirm: 'Your details',
};

const ALL_STEPS = [
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
  orgName,
  logoUrl,
  heroImageUrl,
  selectedBranch,
  services,
  people,
  onPeopleChange,
  therapists,
  loadingTherapists,
  therapistsError,
  onRetryTherapists,
  showStaffSelection,
  customerAccountId,
  onGroupBookingComplete,
}) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [activeGuestId, setActiveGuestId] = useState('lead');
  const [professionalMode, setProfessionalMode] = useState(null); // null | 'any' | 'per-guest'
  const [selectedDateTime, setSelectedDateTime] = useState({ date: '', time: '' });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [leadContact, setLeadContact] = useState({
    firstName: '', lastName: '', email: '', phone: '', phoneCountryCode: '+977', gender: '',
    referralSource: '', referralClientName: '', referralPhone: '', referralCountryCode: '+977',
    referralSocialPlatform: '', referralStaffName: '', specialRequests: '', agreeToTerms: false,
  });

  // Mirrors BookingView's own steps list exactly: showStaffSelection=false drops the
  // professional step entirely for solo, so group booking's toggle-respecting fix
  // (Anish: "make group booking respect the toggle too") does the same here rather
  // than just hiding the staff names within a step the customer still has to click
  // through. The therapist roster itself is still fetched regardless (migration-305's
  // group-booking bypass) -- computeGroupSlots needs real therapist data to size its
  // "any professional" reserve-count math even when nobody ever sees a name.
  const STEPS = useMemo(
    () => (showStaffSelection ? ALL_STEPS : ALL_STEPS.filter((s) => s.key !== 'professional')),
    [showStaffSelection],
  );

  // With no professional step to click through, every person needs {mode:'any'}
  // auto-assigned the moment they have a service -- same implicit behavior BookingView
  // already has for solo (selectedProfessional just stays null/unset and the booking
  // goes to "any professional" without ever asking). Guarded on already being 'any' so
  // this doesn't fight a stale 'specific' pick left over from toggling the setting
  // mid-session.
  useEffect(() => {
    if (showStaffSelection) return;
    const needsAny = people.some((p) => p.service && p.professional?.mode !== 'any');
    if (!needsAny) return;
    onPeopleChange((prev) => prev.map((p) => (
      p.service && p.professional?.mode !== 'any' ? { ...p, professional: { mode: 'any' } } : p
    )));
  }, [showStaffSelection, people, onPeopleChange]);

  useLayoutEffect(() => {
    scrollToTopInstant();
  }, [stepIndex]);

  const currentStep = STEPS[stepIndex]?.key;
  const pageTitle = STEP_HEADINGS[currentStep];

  const canContinue = {
    guests: people.every((p) => !!p.service),
    professional: people.every((p) => !!p.professional),
    time: !!(selectedDateTime.date && selectedDateTime.time),
    confirm: false, // GroupConfirmStep (Task 8) owns its own submit gating
  };

  const goNext = () => setStepIndex((i) => Math.min(STEPS.length - 1, i + 1));
  const handleContinue = goNext;

  // Functional updates throughout — onPeopleChange is the parent's raw setState
  // setter, and several of ProfessionalStep's own child instances (per-guest mode)
  // can call back in the same commit (e.g. its own "empty roster" auto-select effect
  // firing for every person at once); computing the next array from the `people`
  // closure instead of the updater's own `prev` would let later calls in the same
  // batch silently overwrite earlier ones.
  // A branch's online_booking_capacity (Booking Settings) can be set lower than
  // MAX_GROUP_SIZE's hard product cap -- every guest counts 1-for-1 against that cap
  // (confirmed decision, see groupBooking.js's addGuest comment), so the UI must never
  // let a customer build a group bigger than the branch could ever actually seat
  // online. null/undefined capacity means "no limit" (Booking Settings: "Leave it
  // blank for no limit"), so only clamp down when a real number is set and it's
  // tighter than the product cap. Anish caught this live: Lazimpat capped at 5, but
  // "Add guest" let a customer build a 6-person group anyway.
  const effectiveMaxGroupSize = selectedBranch?.online_booking_capacity != null
    ? Math.min(MAX_GROUP_SIZE, selectedBranch.online_booking_capacity)
    : MAX_GROUP_SIZE;

  const handleAddGuest = () => onPeopleChange((prev) => addGuest(prev, effectiveMaxGroupSize));
  const handleRemoveGuest = (guestId) => {
    onPeopleChange((prev) => removeGuest(prev, guestId));
    if (activeGuestId === guestId) setActiveGuestId('lead');
  };
  const handleServiceChosenForActiveGuest = (service) => {
    onPeopleChange((prev) => updateGuestField(prev, activeGuestId, 'service', service));
  };

  const handleSelectAnyForAll = () => {
    onPeopleChange((prev) => prev.map((p) => ({ ...p, professional: { mode: 'any' } })));
    setProfessionalMode('any');
  };
  const handleSelectPerGuestMode = () => setProfessionalMode('per-guest');
  const handlePersonProfessionalSelect = (personId, selection) => {
    onPeopleChange((prev) => updateGuestField(prev, personId, 'professional', selection));
  };

  const handleGuestNameChange = (guestId, name) => {
    onPeopleChange((prev) => updateGuestField(prev, guestId, 'name', name));
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
        referralSource: leadContact.referralSource || null,
        referralClientName: leadContact.referralClientName || null,
        referralPhone: leadContact.referralPhone || null,
        referralCountryCode: leadContact.referralCountryCode || '+977',
        referralSocialPlatform: leadContact.referralSocialPlatform || null,
        referralStaffName: leadContact.referralStaffName || null,
      },
      people: resolvedPeople,
      customerAccountId,
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

  // No back/X icon row -- matches the solo profile page exactly (persistent
  // CustomerHeader, no floating icon buttons). Anish: "make it similar like individual
  // bookings with no back button and no cross button." Exiting and moving between steps
  // both go through the nav below (the leading "Services" crumb calls onClose
  // unconditionally, same label/destination as BookingView's own escape hatch; each
  // passed step name is its own back-navigation) or the browser's Back button.
  return (
    <div className="zn-scope min-h-screen bg-[var(--zn-background)]" style={{ paddingTop: 'var(--customer-header-h, 64px)' }}>
      <CustomerHeader branch={selectedBranch} containerClassName="relative max-w-7xl mx-auto px-4 sm:px-6" />

      {/* Solo's equivalent "pick a service" screen is the profile page itself, which
          always shows ProfileHero -- Anish: "there is cover image similar to individual
          bookings" [missing here]. Only on 'guests' (group booking's service-picking
          step), matching BookingView's later steps (professional/time/confirm), which
          never show a hero either -- this isn't "every step gets a hero", it's "the
          service-picking step gets the same hero the solo service-picking screen has". */}
      {currentStep === 'guests' && (
        <ProfileHero orgName={orgName} heroImageUrl={heroImageUrl} logoUrl={logoUrl} />
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-28 lg:pb-16">
        <nav aria-label="Group booking steps" className="flex items-center gap-2 flex-wrap mt-4">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-[var(--zn-muted-foreground)] hover:text-[var(--zn-foreground)] underline transition-colors"
          >
            Services
          </button>
          <Icon name="ChevronRight" size={14} className="text-[var(--zn-muted-foreground)]" />
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
          {pageTitle}
        </h1>

        {currentStep === 'confirm' ? (
          <div className="max-w-2xl">
            <GroupConfirmStep
              people={people}
              leadContact={leadContact}
              onLeadContactChange={setLeadContact}
              selectedBranch={selectedBranch}
              selectedDateTime={selectedDateTime}
              orgSlug={orgSlug}
              genderPreference="no-preference"
              customerAccountId={customerAccountId}
              onGuestNameChange={handleGuestNameChange}
              onSubmit={handleSubmit}
              submitting={submitting}
              submitError={submitError}
            />
          </div>
        ) : (
          // Mirrors BookingView's grid + sticky SummaryCard — guests/professional/time
          // previously had no summary at all, just a step's content with a plain
          // Continue button below a potentially very long service list (Anish: "why
          // group booking doesn't have similar UI like individual bookings"). confirm
          // stays full-width/no sidebar since GroupConfirmStep already renders its own
          // equivalent per-person breakdown + total inline as the final review.
          <div className="grid gap-8 lg:gap-12 lg:grid-cols-[minmax(0,1fr)_380px] items-start">
            {/* No max-w cap, matching BookingView's left column exactly (just min-w-0) --
                a stray max-w-2xl here left the service list narrower than the solo
                flow's equivalent (Anish: "services width is not same... increase the
                width"). */}
            <div className="min-w-0">
              {currentStep === 'guests' && (
                <GuestsStep
                  people={people}
                  services={services}
                  activeGuestId={activeGuestId}
                  onSelectActiveGuest={setActiveGuestId}
                  onServiceChosenForActiveGuest={handleServiceChosenForActiveGuest}
                  onAddGuest={handleAddGuest}
                  onRemoveGuest={handleRemoveGuest}
                  maxGroupSize={effectiveMaxGroupSize}
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
            </div>

            <GroupSummaryCard
              orgName={orgName}
              logoUrl={logoUrl}
              heroImageUrl={heroImageUrl}
              people={people}
              onContinue={handleContinue}
              continueLabel="Continue"
              disabled={!canContinue[currentStep]}
              stickyTop="calc(var(--customer-header-h, 64px) + 1.5rem)"
            />
          </div>
        )}
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

    </div>
  );
};

export default GroupBookingView;
