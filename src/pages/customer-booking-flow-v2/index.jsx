import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { capture } from '../../lib/analytics';
import CustomerHeader from '../../components/ui/CustomerHeader';
import Button from '../../components/ui/Button';
import Icon from '../../components/AppIcon';
import ProgressIndicatorV2 from './components/ProgressIndicatorV2';
import ServiceBookingPanel from './components/ServiceBookingPanel';
import BranchSelection from '../customer-booking-flow/components/BranchSelection';
import CustomerForm from '../customer-booking-flow/components/CustomerForm';
import BookingConfirmation from '../customer-booking-flow/components/BookingConfirmation';
import BookingSuccess from '../customer-booking-flow/components/BookingSuccess';
import { useTenant } from '../../contexts/TenantContext';
import { useCustomerAuth } from '../../contexts/CustomerAuthContext';
import { splitE164 } from '../../utils/phone';
import useScrollCollapse from '../../hooks/useScrollCollapse';

// Callback ref, not useRef + a useLayoutEffect keyed on [currentStep]: this page
// returns an early "Loading..." placeholder while tenant data is still in flight, so
// on a cold load the measured element's DOM node doesn't exist yet on the first
// render any [currentStep]-keyed effect would run against. By the time tenant data
// resolves and the real element mounts, currentStep is still 1 — unchanged — so that
// effect's dependency never changes and React never re-runs it, leaving the measured
// height stuck at 0 forever (until currentStep happens to change some other way,
// e.g. advancing a step and coming back). A spacer sized from that stuck-at-0 height
// reserves no space, so whatever's fixed above it sits on top of — crops — the
// content underneath. A callback ref fires exactly when React actually
// attaches/detaches this specific DOM node, for any reason, so it can't go stale
// like this.
function useMeasuredRef(setHeight) {
  const observerRef = useRef(null);
  return useCallback((el) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!el) return;
    setHeight(el.getBoundingClientRect().height);
    const observer = new ResizeObserver(([entry]) => {
      setHeight(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height);
    });
    observer.observe(el);
    observerRef.current = observer;
  }, [setHeight]);
}

// v2 of the customer booking flow: identical business logic and steps to
// pages/customer-booking-flow, except Service Selection + Date & Time are collapsed into a
// single side-by-side step (ServiceBookingPanel) instead of two sequential pages. Reuses the
// v1 BranchSelection / CustomerForm / BookingConfirmation / BookingSuccess components and the
// v1 ServiceSelection / DateTimeSelection components unchanged — no parallel booking system.
const CustomerBookingFlowV2 = () => {
  const { orgSlug } = useParams();
  const { orgName, getBookingJourneyText, loading: tenantLoading, error: tenantError } = useTenant();
  const { customerProfile } = useCustomerAuth();
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  // Same fade-in-on-scroll treatment as step 2's (Choose Service) inline "Previous" —
  // hidden at rest, appears once the customer has scrolled a bit, instead of sitting
  // there immediately above "Your Information"/"Confirm Booking" from the first frame.
  const topPreviousProgress = useScrollCollapse(120);
  const [topTitleHeight, setTopTitleHeight] = useState(0);
  // The title bar (Previous link + title) is `fixed`, not `sticky` — `sticky` inside
  // this `flex flex-col` <main> wasn't reliably staying put on desktop scroll. `fixed`
  // is the same proven approach CustomerHeader/ProgressIndicator already use, but it
  // takes the bar out of document flow entirely, so its own height has to be measured
  // and reserved as a spacer below it or the step content jumps up underneath it.
  const [topBarHeight, setTopBarHeight] = useState(0);
  const topTitleInnerRef = useMeasuredRef(setTopTitleHeight);
  const topBarRef = useMeasuredRef(setTopBarHeight);

  // Booking state
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [selectedService, setSelectedService] = useState(null);
  const [selectedDateTime, setSelectedDateTime] = useState({ date: '', time: '' });
  const [genderPreference, setGenderPreference] = useState('no-preference');
  const [customerInfo, setCustomerInfo] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    phoneCountryCode: '+977',
    gender: '',
    referralSource: '',
    referralClientName: '',
    referralPhone: '',
    referralCountryCode: '+977',
    referralSocialPlatform: '',
    referralStaffName: '',
    specialRequests: '',
    agreeToTerms: false
  });
  const [bookingData, setBookingData] = useState(null);
  const prefilledFromProfile = useRef(false);

  useEffect(() => {
    if (!customerProfile || prefilledFromProfile.current) return;
    prefilledFromProfile.current = true;

    const [firstName, ...rest] = (customerProfile.full_name || '').split(' ');
    // The saved profile phone is canonical E.164 ("+9779841234567") — split it so
    // the country-code picker and the national-number box each show their own part
    // (the number box must never contain the dial code).
    const savedPhone = splitE164(customerProfile.phone || '');
    setCustomerInfo((prev) => ({
      ...prev,
      firstName: prev.firstName || firstName || '',
      lastName: prev.lastName || rest.join(' '),
      email: prev.email || customerProfile.email || '',
      phone: prev.phone || savedPhone.national,
      phoneCountryCode: prev.phone ? prev.phoneCountryCode : (savedPhone.national ? savedPhone.dial : prev.phoneCountryCode),
    }));
  }, [customerProfile]);

  const totalSteps = 5;
  const stepNames = ['branch_selection', 'service_datetime_selection', 'customer_details', 'booking_confirmation', 'booking_success'];
  const stepEnteredAt = useRef(Date.now());

  // useLayoutEffect (not useEffect) — must run and repaint BEFORE the browser
  // shows the new step's first frame. Without this, moving to the next step
  // keeps whatever scroll position the previous step was left at (e.g.
  // scrolling down the branch list before tapping one), so the new step's
  // scroll-collapse chrome (ServiceSelection's sticky header, the "Previous"
  // fade-in, the floating Previous button) reads that leftover scrollY on its
  // very first render — a regular useEffect fires only after that stale frame
  // has already painted, which is exactly the glitch/flash this was seeing.
  useLayoutEffect(() => {
    // 'instant' explicitly overrides the global `scroll-behavior: smooth` (see
    // tailwind.css) — this reset must happen before paint with no visible
    // animation, or it reintroduces the stale-scroll flash this effect exists
    // to prevent (see the big comment above).
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [currentStep]);

  useEffect(() => {
    if (currentStep >= 5) return;
    stepEnteredAt.current = Date.now();
    capture('customer_booking_step_viewed', {
      step_index: currentStep,
      step_name: stepNames[currentStep - 1],
      org_slug: orgSlug,
      branch_id: selectedBranch?.id,
      flow_variant: 'v2',
    });
  }, [currentStep]); // eslint-disable-line react-hooks/exhaustive-deps

  // Must run (and be declared) before the SAVE effect below. Effects fire in
  // declaration order on mount, and this one calls setState — it doesn't
  // synchronously update the closure values the SAVE effect reads, so on the
  // very first commit SAVE still writes out the pre-load defaults regardless
  // of order. What matters is that LOAD reads and captures the real stored
  // draft before anything overwrites it: with LOAD declared first, that read
  // happens first, and SAVE's subsequent default-state write gets replaced
  // again on the re-render its own setState calls trigger (SAVE re-runs
  // because currentStep/etc. are now in its deps and just changed). Declared
  // in the other order, SAVE would clobber the real draft with defaults
  // *before* LOAD ever got to read it — permanently, since by the time LOAD
  // ran there'd be nothing but defaults left to load.
  useEffect(() => {
    if (!orgSlug) return;
    // Drop the old org-unscoped key so a stale cross-org draft from before this
    // fix can't leak into any org's flow.
    localStorage.removeItem('bookingFlowV2');
    const savedState = localStorage.getItem(`bookingFlowV2:${orgSlug}`);
    if (savedState) {
      try {
        const parsed = JSON.parse(savedState);
        if (parsed.currentStep && parsed.currentStep < 5) { // Don't restore success step
          setCurrentStep(parsed.currentStep);
          setSelectedBranch(parsed.selectedBranch);
          setSelectedService(parsed.selectedService);
          setSelectedDateTime(parsed.selectedDateTime || { date: '', time: '' });
          setGenderPreference(parsed.genderPreference || 'no-preference');
          // A draft's saved phone may be a bare national number or (from an older
          // build) a full E.164 string — split defensively so the number box only
          // ever holds the national part.
          const draftPhone = splitE164(parsed.customerInfo?.phone || '', parsed.customerInfo?.phoneCountryCode || '+977');
          setCustomerInfo((prev) => ({
            ...prev,
            ...(parsed.customerInfo || {}),
            firstName: prev.firstName || parsed.customerInfo?.firstName || '',
            lastName: prev.lastName || parsed.customerInfo?.lastName || '',
            email: prev.email || parsed.customerInfo?.email || '',
            phone: prev.phone || draftPhone.national,
            phoneCountryCode: prev.phone ? prev.phoneCountryCode : (draftPhone.national ? draftPhone.dial : (parsed.customerInfo?.phoneCountryCode || prev.phoneCountryCode)),
          }));
        }
      } catch (error) {
        console.error('Error loading saved booking state:', error);
      }
    }
  }, [orgSlug]);

  useEffect(() => {
    if (!orgSlug) return;
    const bookingState = {
      currentStep,
      selectedBranch,
      selectedService,
      selectedDateTime,
      genderPreference,
      customerInfo
    };
    localStorage.setItem(`bookingFlowV2:${orgSlug}`, JSON.stringify(bookingState));
  }, [orgSlug, currentStep, selectedBranch, selectedService, selectedDateTime, genderPreference, customerInfo]);

  const handleNext = async () => {
    if (!canProceed()) return;

    setIsLoading(true);

    try {
      if (currentStep < totalSteps) {
        capture('customer_booking_step_completed', {
          step_index: currentStep,
          step_name: stepNames[currentStep - 1],
          org_slug: orgSlug,
          branch_id: selectedBranch?.id,
          service_id: selectedService?.id,
          time_on_step_ms: Date.now() - stepEnteredAt.current,
          flow_variant: 'v2',
        });
        setCurrentStep(currentStep + 1);
      }
    } catch (error) {
      console.error('Navigation error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const canProceed = () => {
    switch (currentStep) {
      case 1: return selectedBranch !== null;
      case 2: return selectedService !== null && !!selectedDateTime.date && !!selectedDateTime.time;
      case 3: return isCustomerInfoValid();
      case 4: return customerInfo.agreeToTerms;
      default: return false;
    }
  };

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

  const handleBranchSelect = (branch, isUserAction = true) => {
    if (!branch) return;

    setSelectedBranch(branch);
    setSelectedService(null); // Reset service when branch changes

    // Only a real card tap should advance the step / log step-completion — BranchSelection
    // also calls this to auto-select a tenant's sole branch on load, and that time-to-select
    // is page-load latency, not user engagement.
    if (currentStep === 1 && isUserAction) {
      capture('customer_booking_step_completed', {
        step_index: 1,
        step_name: stepNames[0],
        org_slug: orgSlug,
        branch_id: branch?.id,
        time_on_step_ms: Date.now() - stepEnteredAt.current,
        flow_variant: 'v2',
      });
      setCurrentStep(2);
    }
  };

  const handleServiceSelect = (service) => {
    setSelectedService(service);
    setSelectedDateTime({ date: '', time: '' }); // Duration differs per service — a stale slot may no longer fit
  };

  // Stable references (useCallback) — DateTimeSelection is memoized (it re-renders a
  // large calendar grid) since it's a child of this page, which re-renders every scroll
  // animation frame (topPreviousProgress, see useScrollCollapse above); without stable
  // callback props, that memoization would be defeated by a fresh function each frame,
  // and the calendar would re-render on every frame of scrolling — visible as jitter.
  const handleDateTimeSelect = useCallback((dateTime) => {
    setSelectedDateTime(dateTime);
  }, []);

  const handleGenderPreferenceChange = useCallback((preference) => {
    setGenderPreference(preference);
    setSelectedDateTime({ date: '', time: '' }); // Reset time when preference changes
  }, []);

  const handleCustomerInfoChange = (info) => {
    setCustomerInfo(info);
  };

  const handleConfirmBooking = (confirmationData) => {
    const finalBookingData = {
      ...confirmationData,
      selectedBranch,
      selectedService,
      selectedDateTime,
      genderPreference,
      customerInfo,
      bookingDate: new Date().toISOString(),
      status: 'confirmed'
    };

    setBookingData(finalBookingData);
    setCurrentStep(5);
    localStorage.removeItem('bookingFlowV2');

    capture('customer_booking_submitted', {
      org_slug: orgSlug,
      branch_id: selectedBranch?.id,
      branch_name: selectedBranch?.name,
      service_id: selectedService?.id,
      service_name: selectedService?.name,
      service_price_npr: selectedService?.price_npr,
      customer_gender: customerInfo.gender || null,
      flow_variant: 'v2',
    });
  };

  const handleEditBooking = () => {
    // BookingConfirmation only ever calls onEditBooking(1) ("Edit Booking" -> back to
    // service selection); v2's equivalent is the combined service+time step.
    setCurrentStep(2);
  };

  const getStepTitle = () => {
    switch (currentStep) {
      case 1: return 'Select Branch';
      case 2: return 'Choose Service & Time';
      case 3: return 'Your Information';
      case 4: return 'Confirm Booking';
      case 5: return 'Booking Confirmed';
      default: return 'Booking Flow';
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <BranchSelection
            selectedBranch={selectedBranch}
            onBranchSelect={handleBranchSelect}
          />
        );

      case 2:
        return (
          <ServiceBookingPanel
            selectedBranch={selectedBranch}
            selectedService={selectedService}
            onServiceSelect={handleServiceSelect}
            selectedDateTime={selectedDateTime}
            onDateTimeSelect={handleDateTimeSelect}
            genderPreference={genderPreference}
            onGenderPreferenceChange={handleGenderPreferenceChange}
            onContinue={handleNext}
            canContinue={!!selectedDateTime.date && !!selectedDateTime.time}
            onPrevious={handlePrevious}
          />
        );

      case 3:
        return (
          <CustomerForm
            customerInfo={customerInfo}
            onCustomerInfoChange={handleCustomerInfoChange}
            selectedBranch={selectedBranch}
            selectedService={selectedService}
            selectedDateTime={selectedDateTime}
            genderPreference={genderPreference}
            orgSlug={orgSlug}
          />
        );

      case 4:
        return (
          <BookingConfirmation
            orgSlug={orgSlug}
            selectedBranch={selectedBranch}
            selectedService={selectedService}
            selectedDateTime={selectedDateTime}
            customerInfo={customerInfo}
            genderPreference={genderPreference}
            customerAccountId={customerProfile?.id}
            onConfirmBooking={handleConfirmBooking}
            onEditBooking={handleEditBooking}
          />
        );

      case 5:
        return (
          <BookingSuccess
            bookingData={bookingData}
          />
        );

      default:
        return null;
    }
  };

  if (tenantError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center p-8">
          <Icon name="AlertCircle" size={48} className="text-error mx-auto mb-4" />
          <h1 className="font-heading font-heading-semibold text-2xl text-text-primary mb-2">
            Organization Not Found
          </h1>
          <p className="font-body font-body-normal text-text-secondary mb-4">
            The booking page you're looking for doesn't exist or is no longer available.
          </p>
          <a
            href="https://www.zunkireelabs.com/products/ai-booking-engine/"
            className="inline-flex items-center px-4 py-2 bg-primary text-primary-foreground rounded-spa font-body font-body-medium text-sm hover:bg-primary/90"
          >
            Learn More About Zennly
          </a>
        </div>
      </div>
    );
  }

  if (tenantLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-text-secondary">Loading...</p>
        </div>
      </div>
    );
  }

  // Widening the container to fit the drawer used to keep the OLD max-w-4xl
  // centered position for its left edge and only grow rightward, which kept
  // step transitions from shifting but left a lopsided gutter on the left
  // once the container was actually 1600px wide. Recentering on `wideOpen`
  // instead (a normal `mx-auto`) makes the widened layout look balanced,
  // which matters more than avoiding the small left-edge shift.
  const wideOpen = currentStep === 2 && selectedService !== null;

  return (
    <div
      className="min-h-screen bg-background"
      style={{
        // ProgressIndicatorV2 is `fixed`, not `sticky` (see that component for why),
        // so unlike sticky it no longer auto-reserves its own space in the page's
        // normal flow — that space has to be added here explicitly, and only while
        // it's actually rendered (currentStep < 5), or content starts underneath it.
        paddingTop: currentStep < 5
          ? 'calc(var(--customer-header-h, 64px) + var(--progress-indicator-h, 67px))'
          : 'var(--customer-header-h, 64px)',
      }}
    >
      <CustomerHeader wide={wideOpen} />

      {currentStep < 5 && (
        <ProgressIndicatorV2
          currentStep={currentStep}
          totalSteps={4}
          wide={wideOpen}
        />
      )}

      <main
        className={
          'mx-auto px-4 py-4 lg:py-6 flex flex-col ' +
          (wideOpen ? 'max-w-4xl lg:max-w-[1600px]' : 'max-w-4xl')
        }
      >
        {currentStep !== 2 && (
          <>
            {/* Fixed pinned bar (matching the service page's title/search block) whose
                title collapses away as "Previous" fades in once scrolled — hidden at
                rest so it doesn't sit there from the very first frame. `fixed`, not
                `sticky` — sticky inside this flex-col <main> wasn't reliably staying
                pinned on desktop scroll, same proven approach as CustomerHeader/
                ProgressIndicatorV2 instead. Being `fixed` takes it out of document
                flow, so its own rendered height is measured (topBarRef/topBarHeight)
                and reserved via the spacer div right after it, so content doesn't
                jump up underneath it. The inner div mirrors <main>'s own
                mx-auto/px-4/max-w so the bar's content lines up with the page below it. */}
            <div
              ref={topBarRef}
              className="fixed left-0 right-0 z-sticky-filter bg-background"
              style={{ top: 'calc(var(--customer-header-h, 64px) + var(--progress-indicator-h, 67px))' }}
            >
              <div className={'mx-auto px-4 pb-2 ' + (currentStep === 3 ? 'pt-3 ' : 'pt-6 ') + (wideOpen ? 'max-w-4xl lg:max-w-[1600px]' : 'max-w-4xl')}>
                {/* Back arrow + title on one row — arrow is icon-only, always visible
                    from the top (mobile and desktop alike, not tied to scroll) and
                    absolutely positioned so the title can independently collapse away
                    on scroll (topPreviousProgress) without shifting the arrow. Desktop
                    has its title pinned fully visible (lg:!max-h-none/!opacity-100). */}
                <div
                  className="relative"
                  style={{ minHeight: currentStep > 1 && currentStep < 5 ? 28 : undefined }}
                >
                  {currentStep > 1 && currentStep < 5 && (
                    <button
                      type="button"
                      onClick={handlePrevious}
                      aria-label="Previous"
                      // Visual circle stays w-7 h-7 (28px); the ::before pseudo-element pads
                      // the actual hit area out to 44px (spa-touch-target) without growing
                      // the chrome or shifting the title's absolute-positioned layout.
                      className="absolute left-0 top-0 z-10 flex items-center justify-center w-7 h-7 rounded-full border border-border bg-surface text-text-secondary shadow-spa-resting hover:text-text-primary hover:bg-background active:scale-95 spa-transition-fast before:absolute before:-inset-2 before:content-['']"
                    >
                      <Icon name="ChevronLeft" size={16} />
                    </button>
                  )}
                  <div
                    className="text-center overflow-hidden [overflow-anchor:none] lg:!max-h-none lg:!opacity-100"
                    style={{
                      maxHeight: topTitleHeight ? topTitleHeight * (1 - topPreviousProgress) : undefined,
                      opacity: 1 - topPreviousProgress,
                    }}
                  >
                    <div ref={topTitleInnerRef}>
                      <div className="flex items-center justify-center space-x-2 mb-1">
                        <Icon name="Sparkles" size={20} className="text-primary" />
                        <h1 className="font-heading font-heading-semibold text-2xl text-text-primary">
                          {getStepTitle()}
                        </h1>
                      </div>
                      {currentStep < 5 && (
                        <p className="font-body font-body-normal text-text-secondary">
                          Step {currentStep} of 4 - {getBookingJourneyText()}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div style={{ height: topBarHeight }} className="mb-1" />
          </>
        )}

        <div className={currentStep === 1 ? 'mb-2' : 'mb-4 sm:mb-8'}>
          {renderStepContent()}
        </div>

        {/* Navigation — step 1 (branch) auto-advances on card click/tap, so it has no
            Previous/Continue row of its own (nothing to go back to, nothing to confirm
            before advancing) — nothing renders here for it. Step 2 has its own Continue
            button inside the booking panel. */}
        {currentStep > 1 && currentStep < 5 && currentStep !== 2 && (
          <div className="flex items-center justify-end gap-2 mt-6">
            <div>
              {currentStep === 4 ? (
                <div className="text-center">
                  <p className="font-caption font-caption-normal text-xs text-text-secondary mb-2">
                    By confirming, you agree to our terms and conditions
                  </p>
                </div>
              ) : (
                <Button
                  variant="primary"
                  onClick={handleNext}
                  iconName="ChevronRight"
                  iconPosition="right"
                  iconSize={16}
                  disabled={!canProceed() || isLoading}
                  loading={isLoading}
                  className="spa-touch-target"
                >
                  Enter Details
                </Button>
              )}
            </div>
          </div>
        )}

      </main>

      <footer className="bg-surface border-t border-border mt-16">
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="text-center">
            <div className="flex items-center justify-center space-x-2 mb-4">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  className="text-primary-foreground"
                >
                  <path
                    d="M12 2L13.09 8.26L20 9L13.09 9.74L12 16L10.91 9.74L4 9L10.91 8.26L12 2Z"
                    fill="currentColor"
                  />
                  <circle cx="12" cy="19" r="2" fill="currentColor" opacity="0.7"/>
                </svg>
              </div>
              <span className="font-heading font-heading-semibold text-lg text-text-primary">
                Zennly
              </span>
            </div>
            <p className="font-body font-body-normal text-sm text-text-secondary mb-4">
              Nepal's premier spa booking platform
            </p>
            <div className="flex items-center justify-center space-x-6 text-xs text-text-secondary">
              <button className="hover:text-primary spa-transition-fast">Privacy Policy</button>
              <button className="hover:text-primary spa-transition-fast">Terms of Service</button>
              <button className="hover:text-primary spa-transition-fast">Contact Us</button>
            </div>
            <p className="font-caption font-caption-normal text-xs text-text-secondary mt-4 inline-flex items-center justify-center flex-wrap gap-1">
              <span>© {new Date().getFullYear()} Zennly. All rights reserved. A product from</span>
              <a
                href="https://zunkireelabs.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center space-x-1 hover:text-text-primary spa-transition-fast"
              >
                <img src="/zunkireelabs-icon.webp" alt="Zunkireelabs" className="w-4 h-4" />
                <span className="font-caption font-caption-medium text-xs">zunkireelabs</span>
              </a>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default CustomerBookingFlowV2;
