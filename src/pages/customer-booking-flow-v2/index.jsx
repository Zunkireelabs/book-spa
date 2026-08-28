import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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

// v2 of the customer booking flow: identical business logic and steps to
// pages/customer-booking-flow, except Service Selection + Date & Time are collapsed into a
// single side-by-side step (ServiceBookingPanel) instead of two sequential pages. Reuses the
// v1 BranchSelection / CustomerForm / BookingConfirmation / BookingSuccess components and the
// v1 ServiceSelection / DateTimeSelection components unchanged — no parallel booking system.
const CustomerBookingFlowV2 = () => {
  const navigate = useNavigate();
  const { orgSlug } = useParams();
  const { orgName, getBookingJourneyText, loading: tenantLoading, error: tenantError } = useTenant();
  const { customerProfile } = useCustomerAuth();
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  // Step 2's floating "Previous" button only appears once the customer has
  // scrolled past the top of the service list (at the top it would just
  // duplicate a control that's already in reach) AND the real Previous button
  // — rendered in its normal spot right after the service grid, see prevBtnRef
  // — has scrolled out of view. That way it never doubles up with, or floats
  // on top of, the real one once the customer reaches the bottom of the page.
  const [showFloatingPrev, setShowFloatingPrev] = useState(false);
  const prevBtnRef = useRef(null);

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

  useEffect(() => {
    const bookingState = {
      currentStep,
      selectedBranch,
      selectedService,
      selectedDateTime,
      genderPreference,
      customerInfo
    };
    localStorage.setItem('bookingFlowV2', JSON.stringify(bookingState));
  }, [currentStep, selectedBranch, selectedService, selectedDateTime, genderPreference, customerInfo]);

  useEffect(() => {
    const savedState = localStorage.getItem('bookingFlowV2');
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
  }, []);

  useEffect(() => {
    if (currentStep !== 2) {
      setShowFloatingPrev(false);
      return;
    }
    const onScroll = () => {
      const pastTop = window.scrollY > 280;
      const realBtnRect = prevBtnRef.current?.getBoundingClientRect();
      const realBtnVisible = realBtnRect ? realBtnRect.top < window.innerHeight : false;
      setShowFloatingPrev(pastTop && !realBtnVisible);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [currentStep, selectedService]);

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

  const handleBranchSelect = (branch) => {
    setSelectedBranch(branch);
    setSelectedService(null); // Reset service when branch changes
  };

  const handleServiceSelect = (service) => {
    setSelectedService(service);
    setSelectedDateTime({ date: '', time: '' }); // Duration differs per service — a stale slot may no longer fit
  };

  const handleDateTimeSelect = (dateTime) => {
    setSelectedDateTime(dateTime);
  };

  const handleGenderPreferenceChange = (preference) => {
    setGenderPreference(preference);
    setSelectedDateTime({ date: '', time: '' }); // Reset time when preference changes
  };

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

  // When the drawer is open, main's left edge is pinned with the exact same formula that
  // `mx-auto max-w-4xl` already produces (viewport width minus 56rem, halved) — so the box
  // grows to the right only. Never switch to `mx-auto` here: auto margins recompute on both
  // sides when width changes, which is what caused the grid to recenter/shift before.
  const wideOpen = currentStep === 2 && selectedService !== null;

  return (
    <div className="min-h-screen bg-background pt-16">
      <CustomerHeader />

      {currentStep < 5 && (
        <ProgressIndicatorV2
          currentStep={currentStep}
          totalSteps={4}
        />
      )}

      <main
        className={
          wideOpen
            ? 'mx-auto px-4 py-4 lg:py-6 max-w-4xl lg:ml-[calc((100vw-56rem)/2)] lg:mr-3 lg:max-w-[1600px]'
            : 'mx-auto px-4 py-4 lg:py-6 max-w-4xl'
        }
      >
        {currentStep !== 2 && (
          <div className="text-center mb-4">
            <div className="flex items-center justify-center space-x-2 mb-2">
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
        )}

        <div className="mb-8">
          {renderStepContent()}
        </div>

        {/* Navigation — step 2 has its own Continue button inside the booking panel */}
        {currentStep < 5 && currentStep !== 2 && (
          <div className="flex flex-col sm:flex-row gap-4 justify-between">
            <div className="flex space-x-4">
              {currentStep > 1 && (
                <Button
                  variant="outline"
                  onClick={handlePrevious}
                  iconName="ChevronLeft"
                  iconSize={16}
                  disabled={isLoading}
                >
                  Previous
                </Button>
              )}

              <Button
                variant="text"
                onClick={() => navigate('/booking-management-portal')}
                iconName="Search"
                iconSize={16}
                disabled={isLoading}
              >
                Find Existing Booking
              </Button>
            </div>

            <div className="flex space-x-4">
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

        {/* Step 2's own back control — lives in its normal spot right after the
            service grid. The service grid is long, so a floating copy (below)
            keeps it reachable while scrolling; it hides once this real one
            scrolls into view, so at the bottom of the page it's exactly here —
            never stacked on top of the footer. */}
        {currentStep === 2 && (
          <div ref={prevBtnRef} className="mt-4">
            <Button
              variant="outline"
              onClick={handlePrevious}
              iconName="ChevronLeft"
              iconSize={16}
            >
              Previous
            </Button>
          </div>
        )}

        {currentStep === 2 && showFloatingPrev && (
          <div className={`fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-4 lg:bottom-6 lg:left-[max(1rem,calc((100vw-56rem)/2-8.5rem))] z-dropdown ${selectedService ? 'hidden lg:block' : ''}`}>
            <Button
              variant="outline"
              onClick={handlePrevious}
              iconName="ChevronLeft"
              iconSize={16}
              className="bg-surface shadow-spa-elevated"
            >
              Previous
            </Button>
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
