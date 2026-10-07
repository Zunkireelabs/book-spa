import React, { useState, useEffect, useLayoutEffect, useMemo } from 'react';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import SummaryCard from '../SummaryCard';
import ProfessionalStep from './ProfessionalStep';
import DateTimeStep from './DateTimeStep';
import ConfirmStep from './ConfirmStep';
import DiscardDialog from './DiscardDialog';
import { useTenant } from '../../../../contexts/TenantContext';
import { scrollToTopInstant } from '../../../../utils/scroll';

// Full-page booking view (Fresha-style), replacing the earlier 460px slide-over: the
// drawer left two thirds of the screen empty while cramming every step into a narrow
// column. Here the step content gets the width it needs and the freed right column
// carries a persistent summary — venue, chosen service, who it's with, total, and the
// primary action — so the customer always sees what they're about to pay for.
//
// Rendered instead of the profile page (not layered over it), so there's no overlay or
// stacking to reason about. Step count isn't fixed: orgs with show_staff_selection
// (migration-248) get an extra "Professional" step between Services and Time.
const STEP_HEADINGS = {
  professional: 'Select professional',
  time: 'Select date and time',
  confirm: 'Your details',
};

const BookingView = ({
  onClose,
  orgSlug,
  selectedBranch,
  selectedServices,
  selectedProfessional,
  onProfessionalSelect,
  selectedDateTime,
  onDateTimeSelect,
  customerInfo,
  onCustomerInfoChange,
  customerAccountId,
  onConfirmBooking,
  therapists,
  loadingTherapists,
  therapistsError,
  onRetryTherapists,
  initialStepKey,
}) => {
  const { showStaffSelection, enableStaffRatings, orgName, logoUrl, heroImageUrl } = useTenant();

  const steps = useMemo(() => [
    ...(showStaffSelection ? [{ key: 'professional', label: 'Professional' }] : []),
    { key: 'time', label: 'Time' },
    { key: 'confirm', label: 'Confirm' },
  ], [showStaffSelection]);

  const totalMinutes = useMemo(
    () => selectedServices.reduce((sum, s) => sum + (s.duration_minutes || 0), 0),
    [selectedServices],
  );

  const [stepIndex, setStepIndex] = useState(() => {
    const i = steps.findIndex((s) => s.key === initialStepKey);
    return i > 0 ? i : 0;
  });
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);

  // A late-arriving flag (TenantContext resolves async) can't strand stepIndex past
  // the end of a shorter steps array.
  useEffect(() => {
    if (stepIndex > steps.length - 1) setStepIndex(steps.length - 1);
  }, [steps, stepIndex]);

  // Each step change starts at the top — on a full page the previous scroll position
  // would otherwise drop the customer into the middle of the next step. useLayoutEffect
  // (not useEffect) + scrollToTopInstant so the reset lands before paint, with no
  // scroll-clamp lurch and no smooth-scroll glide back up.
  useLayoutEffect(() => {
    scrollToTopInstant();
  }, [stepIndex, showConfirmation]);

  const therapistFilter = useMemo(() => {
    if (!showStaffSelection || !selectedProfessional) return null;
    if (selectedProfessional.mode === 'specific') return { therapistId: selectedProfessional.therapist.id };
    // An empty eligible list must fall back to the room/gender availability path
    // (null), not filter every slot out — anyProfessionalFree() always returns
    // false for an empty list, which with no staff eligible (or a failed roster
    // fetch) would show a totally empty calendar for a customer the UI just told
    // to continue with "Any professional".
    const ids = therapists.map((t) => t.id);
    return ids.length > 0 ? { eligibleIds: ids } : null;
  }, [showStaffSelection, selectedProfessional, therapists]);

  const handleEditBooking = () => setShowConfirmation(false);

  const goBack = () => setStepIndex((i) => Math.max(0, i - 1));
  const goNext = () => setStepIndex((i) => Math.min(steps.length - 1, i + 1));

  const isCustomerInfoValid = () => {
    if (!customerInfo.firstName.trim()) return false;
    if (customerInfo.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerInfo.email)) return false;
    if (customerInfo.phone.trim()) {
      const isNepal = (customerInfo.phoneCountryCode || '+977') === '+977';
      const digits = customerInfo.phone.replace(/\D/g, '');
      const phoneValid = isNepal ? /^[0-9]{10}$/.test(digits) : digits.length >= 6 && digits.length <= 15;
      if (!phoneValid) return false;
    }
    return true;
  };

  const canContinue = {
    professional: !!selectedProfessional,
    time: !!(selectedDateTime.date && selectedDateTime.time),
    confirm: isCustomerInfoValid(),
  };

  const currentStep = steps[stepIndex]?.key;
  const onReview = currentStep === 'confirm' && showConfirmation;

  // From the review screen, back edits the details again; otherwise it walks the
  // steps — and from the first step, back exits to the profile page (the services
  // step now lives there), same destination as the Services breadcrumb crumb below.
  const handleBack = onReview ? handleEditBooking : (stepIndex > 0 ? goBack : onClose);

  const continueLabel = currentStep === 'confirm' ? 'Review' : 'Continue';
  const handleContinue = currentStep === 'confirm' ? () => setShowConfirmation(true) : goNext;

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
        <nav aria-label="Booking steps" className="flex items-center gap-2 flex-wrap mt-4">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-[var(--zn-muted-foreground)] hover:text-[var(--zn-foreground)] underline transition-colors"
          >
            Services
          </button>
          {steps.map((s, i) => (
            <React.Fragment key={s.key}>
              <Icon name="ChevronRight" size={14} className="text-[var(--zn-muted-foreground)]" />
              <button
                type="button"
                disabled={i >= stepIndex}
                onClick={() => { setShowConfirmation(false); setStepIndex(i); }}
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
          {onReview ? 'Review and confirm' : STEP_HEADINGS[currentStep]}
        </h1>

        <div className="grid gap-8 lg:gap-12 lg:grid-cols-[minmax(0,1fr)_380px] items-start">
          <div className="min-w-0">
            {currentStep === 'professional' && (
              <ProfessionalStep
                therapists={therapists}
                loading={loadingTherapists}
                error={therapistsError}
                onRetry={onRetryTherapists}
                enableStaffRatings={enableStaffRatings}
                selectedProfessional={selectedProfessional}
                onSelect={onProfessionalSelect}
              />
            )}

            {currentStep === 'time' && (
              <DateTimeStep
                selectedBranch={selectedBranch}
                selectedServices={selectedServices}
                totalMinutes={totalMinutes}
                selectedDateTime={selectedDateTime}
                onDateTimeSelect={onDateTimeSelect}
                therapistFilter={therapistFilter}
              />
            )}

            {currentStep === 'confirm' && (
              <ConfirmStep
                orgSlug={orgSlug}
                selectedBranch={selectedBranch}
                selectedServices={selectedServices}
                selectedDateTime={selectedDateTime}
                selectedProfessional={selectedProfessional}
                customerInfo={customerInfo}
                onCustomerInfoChange={onCustomerInfoChange}
                customerAccountId={customerAccountId}
                showConfirmation={showConfirmation}
                onConfirmBooking={onConfirmBooking}
                onEditBooking={handleEditBooking}
              />
            )}
          </div>

          <SummaryCard
            orgName={orgName}
            logoUrl={logoUrl}
            heroImageUrl={heroImageUrl}
            branch={selectedBranch}
            selectedServices={selectedServices}
            totalMinutes={totalMinutes}
            selectedProfessional={selectedProfessional}
            onContinue={handleContinue}
            continueLabel={continueLabel}
            disabled={!canContinue[currentStep]}
            showContinue={!onReview}
          />
        </div>
      </div>

      {/* The summary card's Continue is desktop-only; on mobile the card sits below the
          step content, so the action is repeated here to stay reachable without scrolling. */}
      {!onReview && (
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
            {continueLabel}
          </Button>
        </div>
      )}
    </div>
  );
};

export default BookingView;
