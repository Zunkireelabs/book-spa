import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import CustomerHeader from '../../components/ui/CustomerHeader';
import Icon from '../../components/AppIcon';
import { useTenant } from '../../contexts/TenantContext';
import { useCustomerAuth } from '../../contexts/CustomerAuthContext';
import { fetchBranchesByOrgId, fetchBookableServicesByOrgSlug, fetchBookableTherapists } from '../../services/api';
import { splitE164 } from '../../utils/phone';
import { scrollToTopInstant } from '../../utils/scroll';
import BookingSuccess from '../customer-booking-flow/components/BookingSuccess';
import ProfileHero from './components/ProfileHero';
import ServicesSection from './components/ServicesSection';
import TeamSection from './components/TeamSection';
import LocationSection from './components/LocationSection';
import BranchGate from './components/BranchGate';
import SummaryCard from './components/SummaryCard';
import MobileBookingBar from './components/MobileBookingBar';
import BookingView from './components/BookingView';
import './zennly-theme.css';

// Profile-page-style alternative to the default step-wizard customer booking flow
// (CustomerBookingFlowV2), gated behind organizations.settings.use_provider_profile_layout.
// Reuses the v1 DateTimeSelection/CustomerForm/BookingConfirmation/BookingSuccess
// components unchanged — only the surrounding page chrome (hero, scroll-spy category
// pills, full-page booking view) is net-new.
const ProviderProfileFlow = () => {
  const { orgSlug } = useParams();
  const {
    orgId,
    orgName,
    loading: tenantLoading,
    error: tenantError,
    logoUrl,
    heroImageUrl,
    showStaffSelection,
    enableStaffRatings,
  } = useTenant();
  const { customerProfile } = useCustomerAuth();

  const [selectedBranch, setSelectedBranch] = useState(null);
  const [branches, setBranches] = useState([]);
  const [branchesLoaded, setBranchesLoaded] = useState(false);
  const [services, setServices] = useState([]);
  // Array: a visit can bundle several services, created as one back-to-back group
  // booking (shared booking_group_id). Order is selection order, which is also the
  // order they get scheduled in.
  const [selectedServices, setSelectedServices] = useState([]);
  // null | {mode:'any'} | {mode:'specific', therapist} — tri-state is deliberate:
  // "Any professional" is a real choice (gates Continue) distinguishable from
  // "untouched" (null), which plain boolean/undefined can't express.
  const [selectedProfessional, setSelectedProfessional] = useState(null);
  const [selectedDateTime, setSelectedDateTime] = useState({ date: '', time: '' });
  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookingData, setBookingData] = useState(null);
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
    agreeToTerms: false,
  });
  const prefilledFromProfile = useRef(false);

  useEffect(() => {
    if (!customerProfile || prefilledFromProfile.current) return;
    prefilledFromProfile.current = true;
    const [firstName, ...rest] = (customerProfile.full_name || '').split(' ');
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

  useEffect(() => {
    if (!orgId) return;
    fetchBranchesByOrgId(orgId).then(({ data }) => {
      setBranches(data || []);
      // Auto-select only when unambiguous. Two or more branches show BranchGate
      // first instead — silently picking data[0] let a customer book the wrong
      // location on a multi-branch org with no way to tell.
      if (data?.length === 1) setSelectedBranch(data[0]);
      setBranchesLoaded(true);
    });
  }, [orgId]);

  const handleBranchSelect = useCallback((branch) => {
    if (!branch) return;
    setSelectedBranch(branch);
    // Branch-scoped selections don't carry over — services/therapists/slots are a
    // different set at a different branch. The services and therapist fetches
    // already key on selectedBranch?.id, so both refetch on their own.
    setSelectedServices([]);
    setSelectedProfessional(null);
    setSelectedDateTime({ date: '', time: '' });
  }, []);

  // Only the gate (first entry) pushes history — LocationSection's selector is for
  // switching later, where leaving a history trail would make Back behave oddly.
  const handleBranchGateSelect = useCallback((branch) => {
    handleBranchSelect(branch);
    window.history.pushState({ providerBranch: true }, '');
  }, [handleBranchSelect]);

  useEffect(() => {
    if (!orgSlug || !selectedBranch) return;
    fetchBookableServicesByOrgSlug(orgSlug, selectedBranch.id).then(({ data }) => {
      setServices(data || []);
    });
  }, [orgSlug, selectedBranch]);

  const handleServiceToggle = useCallback((service) => {
    setSelectedServices((prev) => (
      prev.some((s) => s.id === service.id)
        ? prev.filter((s) => s.id !== service.id)
        : [...prev, service]
    ));
    // Total duration changes which slots fit, so the date/time resets. The professional
    // pick is NOT cleared here — a Team-section preselection should survive a service
    // change when the person can still cover it; the reconciliation effect below is
    // what drops it when they can't.
    setSelectedDateTime({ date: '', time: '' });
  }, []);

  const totalMinutes = useMemo(
    () => selectedServices.reduce((sum, s) => sum + (s.duration_minutes || 0), 0),
    [selectedServices],
  );

  const handleBookAnother = useCallback(() => {
    setBookingData(null);
    setSelectedServices([]);
    setSelectedProfessional(null);
    setSelectedDateTime({ date: '', time: '' });
  }, []);

  const handleProfessionalSelect = useCallback((professional) => {
    setSelectedProfessional(professional);
    // Slots are person-dependent — a previously-picked date/time may not be free
    // for whoever was just selected.
    setSelectedDateTime({ date: '', time: '' });
  }, []);

  const [therapists, setTherapists] = useState([]);
  const [loadingTherapists, setLoadingTherapists] = useState(false);
  const [therapistsError, setTherapistsError] = useState(null);
  const [fetchNonce, setFetchNonce] = useState(0);

  // Single round trip shared by TeamSection (profile page) and, downstream, by
  // ProfessionalStep/DateTimeStep inside the booking view — lifted here instead of
  // each consumer fetching independently. With no services selected the RPC gets an
  // empty id list, which the service layer turns into `null` → the full bookable
  // roster, so Team shows everyone on first load. Cancelled flag so a fast service
  // switch can't land a stale list.
  useEffect(() => {
    if (!showStaffSelection || !orgSlug || !selectedBranch?.id) return undefined;
    let cancelled = false;
    setLoadingTherapists(true);
    setTherapistsError(null);
    fetchBookableTherapists(orgSlug, selectedBranch.id, selectedServices.map((s) => s.id)).then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        setTherapistsError(error);
        setTherapists([]);
      } else {
        setTherapists(data || []);
      }
      setLoadingTherapists(false);
    });
    return () => { cancelled = true; };
  }, [showStaffSelection, orgSlug, selectedBranch?.id, selectedServices, fetchNonce]);

  // Drops a specific pick once the (re-fetched) roster no longer includes them —
  // e.g. a newly-ticked service they can't perform. Guarded on loading/error: mid-fetch
  // `therapists` is still the previous list, and on error it's `[]` — clearing on
  // either would wipe a valid pick instead of just a stale one.
  useEffect(() => {
    if (loadingTherapists || therapistsError) return;
    if (selectedProfessional?.mode !== 'specific') return;
    if (!therapists.some((t) => t.id === selectedProfessional.therapist.id)) {
      setSelectedProfessional(null);
      setSelectedDateTime({ date: '', time: '' });
    }
  }, [therapists, loadingTherapists, therapistsError, selectedProfessional]);

  // Booking is a full-page takeover rather than a route, so all the selection state
  // above stays put with no rehydration layer. The trade-off is that browser Back would
  // otherwise leave the site entirely instead of returning to the profile — so opening
  // pushes a history entry and Back pops it.
  const openBooking = () => {
    setBookingOpen(true);
    window.history.pushState({ providerBooking: true }, '');
  };

  const closeBooking = () => {
    if (window.history.state?.providerBooking) window.history.back();
    else setBookingOpen(false);
    scrollToTopInstant();
  };

  useEffect(() => {
    const onPopState = (e) => {
      setBookingOpen(false);
      // Popping back past the gate's pushed entry (state.providerBranch) lands on
      // the pre-selection entry (state null) — re-show the gate instead of leaving
      // the customer on services with no way back to it.
      if (branches.length > 1 && !e.state?.providerBranch) {
        setSelectedBranch(null);
      }
      scrollToTopInstant();
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [branches]);

  const handleConfirmBooking = (confirmationData) => {
    setBookingData({
      ...confirmationData,
      selectedBranch,
      selectedServices,
      selectedDateTime,
      customerInfo,
      bookingDate: new Date().toISOString(),
      status: 'confirmed',
    });
    setBookingOpen(false);
  };

  if (tenantError) {
    return (
      <div className="zn-scope min-h-screen bg-[var(--zn-background)] flex items-center justify-center">
        <div className="text-center p-8">
          <Icon name="AlertCircle" size={48} className="text-error mx-auto mb-4" />
          <h1 className="font-normal text-2xl text-[var(--zn-foreground)]">We couldn't find that business</h1>
        </div>
      </div>
    );
  }

  if (tenantLoading) {
    return (
      <div className="zn-scope min-h-screen bg-[var(--zn-background)] flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-[var(--zn-primary)] border-t-transparent rounded-full" />
      </div>
    );
  }

  if (bookingData) {
    return <BookingSuccess bookingData={bookingData} orgSlug={orgSlug} onBookAnother={handleBookAnother} />;
  }

  // Full-page takeover rather than an overlay: the profile page simply isn't rendered
  // while booking, so there's no scrim, z-index or scroll-locking to get wrong.
  if (bookingOpen) {
    return (
      <BookingView
        onClose={closeBooking}
        orgSlug={orgSlug}
        selectedBranch={selectedBranch}
        selectedServices={selectedServices}
        selectedProfessional={selectedProfessional}
        onProfessionalSelect={handleProfessionalSelect}
        selectedDateTime={selectedDateTime}
        onDateTimeSelect={setSelectedDateTime}
        customerInfo={customerInfo}
        onCustomerInfoChange={setCustomerInfo}
        customerAccountId={customerProfile?.id}
        onConfirmBooking={handleConfirmBooking}
        therapists={therapists}
        loadingTherapists={loadingTherapists}
        therapistsError={therapistsError}
        onRetryTherapists={() => setFetchNonce((n) => n + 1)}
        initialStepKey={selectedProfessional ? 'time' : 'professional'}
      />
    );
  }

  if (branchesLoaded && branches.length === 0) {
    return (
      <div className="zn-scope min-h-screen bg-[var(--zn-background)] flex items-center justify-center">
        <div className="text-center p-8">
          <Icon name="AlertCircle" size={48} className="text-error mx-auto mb-4" />
          <h1 className="font-normal text-2xl text-[var(--zn-foreground)]">No locations available right now</h1>
        </div>
      </div>
    );
  }

  if (branches.length > 1 && !selectedBranch) {
    return (
      <BranchGate
        orgName={orgName}
        heroImageUrl={heroImageUrl}
        logoUrl={logoUrl}
        branches={branches}
        onSelect={handleBranchGateSelect}
      />
    );
  }

  return (
    <div className="zn-scope min-h-screen bg-[var(--zn-background)]" style={{ paddingTop: 'var(--customer-header-h, 64px)' }}>
      <CustomerHeader branch={selectedBranch} containerClassName="relative max-w-7xl mx-auto px-4 sm:px-6" />
      <ProfileHero orgName={orgName} heroImageUrl={heroImageUrl} logoUrl={logoUrl} />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 grid gap-8 lg:gap-12 lg:grid-cols-[minmax(0,1fr)_380px] pb-24 lg:pb-10">
        <div className="min-w-0">
          <ServicesSection
            services={services}
            selectedServices={selectedServices}
            onServiceToggle={handleServiceToggle}
          />

          {showStaffSelection && (loadingTherapists || therapists.length > 0) && (
            <TeamSection
              therapists={therapists}
              loading={loadingTherapists}
              enableStaffRatings={enableStaffRatings}
              selectedProfessional={selectedProfessional}
              onSelect={handleProfessionalSelect}
            />
          )}

          <LocationSection
            branch={selectedBranch}
            branches={branches}
            onSelectBranch={handleBranchSelect}
          />
        </div>

        <div className="pt-6">
          <SummaryCard
            orgName={orgName}
            logoUrl={logoUrl}
            heroImageUrl={heroImageUrl}
            branch={selectedBranch}
            selectedServices={selectedServices}
            totalMinutes={totalMinutes}
            selectedProfessional={selectedProfessional}
            onContinue={openBooking}
            disabled={selectedServices.length === 0}
            stickyTop="calc(var(--customer-header-h, 64px) + 1.5rem)"
          />
        </div>
      </div>

      <MobileBookingBar
        total={selectedServices.reduce((sum, s) => sum + Number(s.effective_price_npr ?? s.price_npr ?? 0), 0)}
        count={selectedServices.length}
        totalMinutes={totalMinutes}
        onContinue={openBooking}
        disabled={selectedServices.length === 0}
      />

    </div>
  );
};

export default ProviderProfileFlow;
