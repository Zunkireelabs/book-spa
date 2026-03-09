import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { fetchServices, createBooking } from '../../../services/api';
import { useBranch } from '../../../contexts/BranchContext';

const StaffBookingForm = ({ onBookingCreated }) => {
  const { branchId } = useBranch();

  // Steps: service → datetime → customer → confirm
  const [step, setStep] = useState(1);
  const [services, setServices] = useState([]);
  const [loadingServices, setLoadingServices] = useState(true);

  // Booking data
  const [selectedService, setSelectedService] = useState(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerGender, setCustomerGender] = useState('');
  const [specialRequests, setSpecialRequests] = useState('');

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [createdBooking, setCreatedBooking] = useState(null);

  // Load services
  useEffect(() => {
    (async () => {
      setLoadingServices(true);
      const result = await fetchServices();
      if (result.data) setServices(result.data);
      setLoadingServices(false);
    })();
  }, []);

  // Generate next 14 days
  const dates = useCallback(() => {
    const result = [];
    const today = new Date();
    for (let i = 0; i <= 14; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      result.push({
        value: d.toISOString().split('T')[0],
        label: d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
        isToday: i === 0,
      });
    }
    return result;
  }, [])();

  // Generate time slots 9AM-9PM
  const timeSlots = useCallback(() => {
    const slots = [];
    for (let h = 9; h < 21; h++) {
      for (let m = 0; m < 60; m += 30) {
        const time24 = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
        const t = new Date();
        t.setHours(h, m);
        const time12 = t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        slots.push({ time24, time12 });
      }
    }
    return slots;
  }, [])();

  const handleSubmit = async () => {
    if (!selectedService || !selectedDate || !selectedTime || !customerName.trim()) return;

    setSubmitting(true);
    setError(null);

    const result = await createBooking({
      branchId,
      serviceId: selectedService.id,
      date: selectedDate,
      startTime: selectedTime,
      customerName: customerName.trim(),
      customerEmail: customerEmail.trim() || null,
      customerPhone: customerPhone.trim() ? `+977${customerPhone.replace(/\s+/g, '')}` : null,
      customerGender: customerGender || null,
      specialRequests: specialRequests.trim() || null,
    });

    if (result.error) {
      setError(result.error.message || 'Failed to create booking.');
      setSubmitting(false);
      return;
    }

    setCreatedBooking(result.data);
    setStep(5); // success
    setSubmitting(false);
    onBookingCreated?.();
  };

  const resetForm = () => {
    setStep(1);
    setSelectedService(null);
    setSelectedDate('');
    setSelectedTime('');
    setCustomerName('');
    setCustomerPhone('');
    setCustomerEmail('');
    setCustomerGender('');
    setSpecialRequests('');
    setError(null);
    setCreatedBooking(null);
  };

  const canProceed = () => {
    switch (step) {
      case 1: return !!selectedService;
      case 2: return !!selectedDate && !!selectedTime;
      case 3: return !!customerName.trim();
      case 4: return true;
      default: return false;
    }
  };

  // ========== SUCCESS SCREEN ==========
  if (step === 5 && createdBooking) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-surface rounded-spa-lg spa-shadow-resting border border-success/20 p-8 text-center">
          <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <Icon name="CheckCircle" size={32} className="text-success" />
          </div>
          <h2 className="font-heading font-heading-semibold text-xl text-text-primary mb-2">
            Booking Created
          </h2>
          <p className="font-data font-data-medium text-lg text-primary mb-1">
            {createdBooking.booking_number}
          </p>
          <p className="font-body text-sm text-text-secondary mb-6">
            {selectedService?.name} • {new Date(selectedDate).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} at{' '}
            {timeSlots.find(s => s.time24 === selectedTime)?.time12}
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button variant="outline" onClick={resetForm} iconName="Plus" iconPosition="left">
              Create Another
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="bg-surface rounded-spa-lg spa-shadow-resting border border-border p-6">
        <div className="flex items-center space-x-3 mb-4">
          <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
            <Icon name="CalendarPlus" size={20} className="text-primary" />
          </div>
          <div>
            <h2 className="font-heading font-heading-semibold text-lg text-text-primary">
              New Booking
            </h2>
            <p className="font-caption text-xs text-text-secondary">
              Step {step} of 4 — {['Select Service', 'Date & Time', 'Customer Info', 'Review & Confirm'][step - 1]}
            </p>
          </div>
        </div>

        {/* Step indicator */}
        <div className="flex items-center space-x-2">
          {[1, 2, 3, 4].map(s => (
            <div key={s} className="flex items-center flex-1">
              <div className={`w-full h-1.5 rounded-full spa-transition-fast ${
                s <= step ? 'bg-primary' : 'bg-border'
              }`} />
            </div>
          ))}
        </div>
      </div>

      {/* Step Content */}
      <div className="bg-surface rounded-spa-lg spa-shadow-resting border border-border p-6">

        {/* STEP 1: Service */}
        {step === 1 && (
          <div>
            <h3 className="font-heading font-heading-medium text-base text-text-primary mb-4">
              Select Service
            </h3>
            {loadingServices ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {services.map(svc => (
                  <button
                    key={svc.id}
                    onClick={() => setSelectedService(svc)}
                    className={`text-left p-4 rounded-spa border-2 spa-transition-fast ${
                      selectedService?.id === svc.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/30 hover:bg-background'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-1">
                      <span className="font-body font-body-medium text-sm text-text-primary">
                        {svc.name}
                      </span>
                      {selectedService?.id === svc.id && (
                        <Icon name="CheckCircle" size={16} className="text-primary flex-shrink-0" />
                      )}
                    </div>
                    <div className="flex items-center space-x-3 text-xs text-text-secondary">
                      <span className="flex items-center space-x-1">
                        <Icon name="Clock" size={12} />
                        <span>{svc.duration_minutes} min</span>
                      </span>
                      <span className="font-data font-data-medium text-primary">
                        NPR {Number(svc.price_npr).toLocaleString('en-IN')}
                      </span>
                    </div>
                    {svc.description && (
                      <p className="font-caption text-xs text-text-tertiary mt-1 line-clamp-1">
                        {svc.description}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* STEP 2: Date & Time */}
        {step === 2 && (
          <div className="space-y-6">
            <div>
              <h3 className="font-heading font-heading-medium text-base text-text-primary mb-3">
                Select Date
              </h3>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {dates.map(d => (
                  <button
                    key={d.value}
                    onClick={() => { setSelectedDate(d.value); setSelectedTime(''); }}
                    className={`p-2 rounded-spa text-sm font-body spa-transition-fast text-center ${
                      selectedDate === d.value
                        ? 'bg-primary text-primary-foreground'
                        : d.isToday
                          ? 'bg-accent/10 border border-accent/30 text-text-primary hover:bg-accent/20'
                          : 'bg-background hover:bg-border text-text-primary'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            {selectedDate && (
              <div>
                <h3 className="font-heading font-heading-medium text-base text-text-primary mb-3">
                  Select Time
                </h3>
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                  {timeSlots.map(s => (
                    <button
                      key={s.time24}
                      onClick={() => setSelectedTime(s.time24)}
                      className={`p-2 rounded-spa text-sm font-body spa-transition-fast ${
                        selectedTime === s.time24
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-background hover:bg-border text-text-primary'
                      }`}
                    >
                      {s.time12}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* STEP 3: Customer Info */}
        {step === 3 && (
          <div className="space-y-4">
            <h3 className="font-heading font-heading-medium text-base text-text-primary mb-2">
              Customer Information
            </h3>

            <div>
              <label className="block font-body font-body-medium text-sm text-text-primary mb-1">
                Customer Name <span className="text-error">*</span>
              </label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Full name"
                className="w-full px-3 py-2.5 rounded-spa border border-border bg-background font-body text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-body font-body-medium text-sm text-text-primary mb-1">
                  Phone
                </label>
                <div className="flex">
                  <span className="inline-flex items-center px-3 rounded-l-spa border border-r-0 border-border bg-background font-body text-sm text-text-secondary">
                    +977
                  </span>
                  <input
                    type="tel"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    placeholder="9800000000"
                    className="flex-1 px-3 py-2.5 rounded-r-spa border border-border bg-background font-body text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                </div>
              </div>

              <div>
                <label className="block font-body font-body-medium text-sm text-text-primary mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="email@example.com"
                  className="w-full px-3 py-2.5 rounded-spa border border-border bg-background font-body text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>
            </div>

            <div>
              <label className="block font-body font-body-medium text-sm text-text-primary mb-1">
                Gender
              </label>
              <div className="flex space-x-3">
                {[{ value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' }].map(g => (
                  <button
                    key={g.value}
                    onClick={() => setCustomerGender(customerGender === g.value ? '' : g.value)}
                    className={`px-4 py-2 rounded-spa text-sm font-body spa-transition-fast border ${
                      customerGender === g.value
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-border text-text-secondary hover:border-primary/30'
                    }`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block font-body font-body-medium text-sm text-text-primary mb-1">
                Special Requests
              </label>
              <textarea
                value={specialRequests}
                onChange={(e) => setSpecialRequests(e.target.value)}
                placeholder="Any preferences or notes..."
                rows={2}
                className="w-full px-3 py-2.5 rounded-spa border border-border bg-background font-body text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
              />
            </div>
          </div>
        )}

        {/* STEP 4: Review */}
        {step === 4 && (
          <div className="space-y-4">
            <h3 className="font-heading font-heading-medium text-base text-text-primary mb-2">
              Review Booking
            </h3>

            <div className="bg-background rounded-spa p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-body text-sm text-text-secondary">Service</span>
                <span className="font-body font-body-medium text-sm text-text-primary">{selectedService?.name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-body text-sm text-text-secondary">Duration</span>
                <span className="font-body text-sm text-text-primary">{selectedService?.duration_minutes} min</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-body text-sm text-text-secondary">Date</span>
                <span className="font-body text-sm text-text-primary">
                  {new Date(selectedDate).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-body text-sm text-text-secondary">Time</span>
                <span className="font-body text-sm text-text-primary">
                  {timeSlots.find(s => s.time24 === selectedTime)?.time12}
                </span>
              </div>
              <div className="border-t border-border pt-3 flex items-center justify-between">
                <span className="font-body text-sm text-text-secondary">Customer</span>
                <span className="font-body font-body-medium text-sm text-text-primary">{customerName}</span>
              </div>
              {customerPhone && (
                <div className="flex items-center justify-between">
                  <span className="font-body text-sm text-text-secondary">Phone</span>
                  <span className="font-body text-sm text-text-primary">+977 {customerPhone}</span>
                </div>
              )}
              {customerEmail && (
                <div className="flex items-center justify-between">
                  <span className="font-body text-sm text-text-secondary">Email</span>
                  <span className="font-body text-sm text-text-primary">{customerEmail}</span>
                </div>
              )}
              {specialRequests && (
                <div className="flex items-start justify-between">
                  <span className="font-body text-sm text-text-secondary">Requests</span>
                  <span className="font-body text-sm text-text-primary text-right max-w-xs">{specialRequests}</span>
                </div>
              )}
              <div className="border-t border-border pt-3 flex items-center justify-between">
                <span className="font-heading font-heading-medium text-sm text-text-primary">Total</span>
                <span className="font-heading font-heading-semibold text-lg text-primary">
                  NPR {Number(selectedService?.price_npr).toLocaleString('en-IN')}
                </span>
              </div>
            </div>

            {error && (
              <div className="flex items-center space-x-2 p-3 bg-error/10 border border-error/20 rounded-spa">
                <Icon name="AlertTriangle" size={14} className="text-error flex-shrink-0" />
                <span className="font-body text-sm text-error">{error}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <div>
          {step > 1 && (
            <Button variant="outline" onClick={() => setStep(step - 1)} iconName="ArrowLeft" iconPosition="left">
              Back
            </Button>
          )}
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={resetForm}
            className="font-body text-sm text-text-secondary hover:text-text-primary spa-transition-fast"
          >
            Cancel
          </button>
          {step < 4 ? (
            <Button
              variant="primary"
              onClick={() => setStep(step + 1)}
              disabled={!canProceed()}
              iconName="ArrowRight"
              iconPosition="right"
            >
              Next
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={handleSubmit}
              loading={submitting}
              disabled={!canProceed()}
              iconName="Check"
              iconPosition="left"
            >
              Create Booking
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default StaffBookingForm;
