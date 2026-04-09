import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import CustomerHeader from '../../components/ui/CustomerHeader';
import Button from '../../components/ui/Button';
import Icon from '../../components/AppIcon';
import ProgressIndicator from './components/ProgressIndicator';
import BranchSelection from './components/BranchSelection';
import ServiceSelection from './components/ServiceSelection';
import DateTimeSelection from './components/DateTimeSelection';
import CustomerForm from './components/CustomerForm';
import BookingConfirmation from './components/BookingConfirmation';
import BookingSuccess from './components/BookingSuccess';
import { useTenant } from '../../contexts/TenantContext';

const CustomerBookingFlow = () => {
  const navigate = useNavigate();
  const { orgSlug } = useParams();
  const { orgName, getBookingJourneyText, loading: tenantLoading, error: tenantError } = useTenant();
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  
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
    gender: '',
    specialRequests: '',
    agreeToTerms: false
  });
  const [bookingData, setBookingData] = useState(null);

  const totalSteps = 6;

  // Auto-save to localStorage
  useEffect(() => {
    const bookingState = {
      currentStep,
      selectedBranch,
      selectedService,
      selectedDateTime,
      genderPreference,
      customerInfo
    };
    localStorage.setItem('bookingFlow', JSON.stringify(bookingState));
  }, [currentStep, selectedBranch, selectedService, selectedDateTime, genderPreference, customerInfo]);

  // Load from localStorage on mount
  useEffect(() => {
    const savedState = localStorage.getItem('bookingFlow');
    if (savedState) {
      try {
        const parsed = JSON.parse(savedState);
        if (parsed.currentStep && parsed.currentStep < 6) { // Don't restore success step
          setCurrentStep(parsed.currentStep);
          setSelectedBranch(parsed.selectedBranch);
          setSelectedService(parsed.selectedService);
          setSelectedDateTime(parsed.selectedDateTime || { date: '', time: '' });
          setGenderPreference(parsed.genderPreference || 'no-preference');
          setCustomerInfo(parsed.customerInfo || {
            firstName: '',
            lastName: '',
            email: '',
            phone: '',
            gender: '',
            specialRequests: '',
            agreeToTerms: false
          });
        }
      } catch (error) {
        console.error('Error loading saved booking state:', error);
      }
    }
  }, []);

  const handleNext = async () => {
    if (!canProceed()) return;
    
    setIsLoading(true);
    
    try {
      if (currentStep < totalSteps) {
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

  const handleStepJump = (step) => {
    if (step <= currentStep || canJumpToStep(step)) {
      setCurrentStep(step);
    }
  };

  const canJumpToStep = (step) => {
    switch (step) {
      case 1: return true;
      case 2: return selectedBranch !== null;
      case 3: return selectedBranch !== null && selectedService !== null;
      case 4: return selectedBranch !== null && selectedService !== null && selectedDateTime.date && selectedDateTime.time;
      case 5: return selectedBranch !== null && selectedService !== null && selectedDateTime.date && selectedDateTime.time && isCustomerInfoValid();
      default: return false;
    }
  };

  const canProceed = () => {
    switch (currentStep) {
      case 1: return selectedBranch !== null;
      case 2: return selectedService !== null;
      case 3: return selectedDateTime.date && selectedDateTime.time;
      case 4: return isCustomerInfoValid();
      case 5: return customerInfo.agreeToTerms;
      default: return false;
    }
  };

  const isCustomerInfoValid = () => {
    // Only customer name is required per US-CUS-003; email, phone, gender are optional
    if (!customerInfo.firstName.trim()) return false;
    if (customerInfo.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerInfo.email)) return false;
    if (customerInfo.phone.trim() && !/^[0-9]{10}$/.test(customerInfo.phone.replace(/\s+/g, ''))) return false;
    return true;
  };

  const handleBranchSelect = (branch) => {
    setSelectedBranch(branch);
    setSelectedService(null); // Reset service when branch changes
  };

  const handleServiceSelect = (service) => {
    setSelectedService(service);
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
    setCurrentStep(6);
    localStorage.removeItem('bookingFlow');
  };

  const handleEditBooking = (step) => {
    setCurrentStep(step + 1); // Convert to 1-based indexing
  };

  const getStepTitle = () => {
    switch (currentStep) {
      case 1: return 'Select Branch';
      case 2: return 'Choose Service';
      case 3: return 'Pick Date & Time';
      case 4: return 'Your Information';
      case 5: return 'Confirm Booking';
      case 6: return 'Booking Confirmed';
      default: return 'Booking Flow';
    }
  };

  const getNextButtonText = () => {
    switch (currentStep) {
      case 1: return 'Continue to Services';
      case 2: return 'Select Date & Time';
      case 3: return 'Enter Details';
      case 4: return 'Review Booking';
      case 5: return 'Confirm Booking';
      default: return 'Next';
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
          <ServiceSelection
            selectedService={selectedService}
            onServiceSelect={handleServiceSelect}
            selectedBranch={selectedBranch}
          />
        );
      
      case 3:
        return (
          <DateTimeSelection
            selectedDateTime={selectedDateTime}
            onDateTimeSelect={handleDateTimeSelect}
            selectedService={selectedService}
            genderPreference={genderPreference}
            onGenderPreferenceChange={handleGenderPreferenceChange}
          />
        );
      
      case 4:
        return (
          <CustomerForm
            customerInfo={customerInfo}
            onCustomerInfoChange={handleCustomerInfoChange}
            selectedBranch={selectedBranch}
            selectedService={selectedService}
            selectedDateTime={selectedDateTime}
            genderPreference={genderPreference}
          />
        );
      
      case 5:
        return (
          <BookingConfirmation
            selectedBranch={selectedBranch}
            selectedService={selectedService}
            selectedDateTime={selectedDateTime}
            customerInfo={customerInfo}
            genderPreference={genderPreference}
            onConfirmBooking={handleConfirmBooking}
            onEditBooking={handleEditBooking}
          />
        );
      
      case 6:
        return (
          <BookingSuccess
            bookingData={bookingData}
          />
        );
      
      default:
        return null;
    }
  };

  // Show error if tenant not found
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
            Learn More About Zenly
          </a>
        </div>
      </div>
    );
  }

  // Show loading while tenant is being fetched
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

  return (
    <div className="min-h-screen bg-background pt-32">
      <CustomerHeader />

      {/* Progress Indicator */}
      {currentStep < 6 && (
        <ProgressIndicator
          currentStep={currentStep}
          totalSteps={5} // Don't count success step
        />
      )}

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 py-4 lg:py-6">
        {/* Step Header — Step 2 renders its own header inside ServiceSelection */}
        {currentStep !== 2 && (
          <div className="text-center mb-4">
            <div className="flex items-center justify-center space-x-2 mb-2">
              <Icon name="Sparkles" size={20} className="text-primary" />
              <h1 className="font-heading font-heading-semibold text-2xl text-text-primary">
                {getStepTitle()}
              </h1>
            </div>
            {currentStep < 6 && (
              <p className="font-body font-body-normal text-text-secondary">
                Step {currentStep} of 5 - {getBookingJourneyText()}
              </p>
            )}
          </div>
        )} (feat: Fix now-indicator line bleeding and calendar improvements)

        {/* Step Content */}
        <div className="mb-8">
          {renderStepContent()}
        </div>

        {/* Navigation Buttons */}
        {currentStep < 6 && (
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
              {currentStep === 5 ? (
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
                  {getNextButtonText()}
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Help Section */}
        {currentStep < 6 && (
          <div className="mt-12 text-center">
            <div className="bg-surface rounded-spa-lg border border-border p-6">
              <h3 className="font-heading font-heading-medium text-lg text-text-primary mb-4">
                Need Help?
              </h3>
              <div className="flex flex-col sm:flex-row items-center justify-center space-y-4 sm:space-y-0 sm:space-x-6">
                <a 
                  href="tel:+977-1-4441234"
                  className="flex items-center space-x-2 text-primary hover:text-primary/80 spa-transition-fast"
                >
                  <Icon name="Phone" size={16} />
                  <span className="font-body font-body-medium text-sm">
                    Call: +977-1-4441234
                  </span>
                </a>
                
                <a 
                  href="mailto:support@bookspa.com"
                  className="flex items-center space-x-2 text-primary hover:text-primary/80 spa-transition-fast"
                >
                  <Icon name="Mail" size={16} />
                  <span className="font-body font-body-medium text-sm">
                    Email: support@bookspa.com
                  </span>
                </a>
                
                <button className="flex items-center space-x-2 text-primary hover:text-primary/80 spa-transition-fast">
                  <Icon name="MessageCircle" size={16} />
                  <span className="font-body font-body-medium text-sm">
                    Live Chat
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
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
                Zenly
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
              <span>© {new Date().getFullYear()} Zenly. All rights reserved. A product from</span>
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

export default CustomerBookingFlow;