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
      <div className="max-w-2xl mx-auto px-3 sm:px-0">
        <div className="bg-white rounded-lg border border-emerald-200 p-5 sm:p-8 text-center">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Icon name="CheckCircle" size={32} className="text-emerald-600" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Booking Created
          </h2>
          <p className="text-lg font-medium text-primary mb-1">
            {createdBooking.booking_number}
          </p>
          <p className="text-sm text-gray-500 mb-6">
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
    <div className="max-w-3xl mx-auto flex flex-col gap-3 sm:gap-4 px-3 sm:px-0">
      {/* Header */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
        <div className="flex items-center gap-3 mb-3 sm:mb-4">
          <div className="w-9 h-9 sm:w-10 sm:h-10 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
            <Icon name="CalendarPlus" size={18} className="sm:w-5 sm:h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-semibold text-gray-900">
              New Booking
            </h2>
            <p className="text-xs text-gray-500 truncate">
              Step {step}/4 — {['Service', 'Date & Time', 'Customer', 'Review'][step - 1]}
            </p>
          </div>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2">
          {[1, 2, 3, 4].map(s => (
            <div key={s} className="flex items-center flex-1">
              <div className={`w-full h-1.5 rounded-full transition-colors ${
                s <= step ? 'bg-primary' : 'bg-gray-200'
              }`} />
            </div>
          ))}
        </div>
      </div>

      {/* Step Content */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">

        {/* STEP 1: Service */}
        {step === 1 && (
          <div>
            <h3 className="text-base font-medium text-gray-900 mb-4">
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
                    className={`text-left p-4 rounded-lg border transition-colors ${
                      selectedService?.id === svc.id
                        ? 'border-primary bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-1">
                      <span className="text-sm font-medium text-gray-900">
                        {svc.name}
                      </span>
                      {selectedService?.id === svc.id && (
                        <Icon name="CheckCircle" size={16} className="text-primary flex-shrink-0" />
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <Icon name="Clock" size={12} />
                        <span>{svc.duration_minutes} min</span>
                      </span>
                      <span className="font-medium text-primary">
                        NPR {Number(svc.price_npr).toLocaleString('en-IN')}
                      </span>
                    </div>
                    {svc.description && (
                      <p className="text-xs text-gray-400 mt-1 line-clamp-1">
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
          <div className="space-y-5 sm:space-y-6">
            <div>
              <h3 className="text-sm sm:text-base font-medium text-gray-900 mb-3">
                Select Date
              </h3>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {dates.map(d => (
                  <button
                    key={d.value}
                    onClick={() => { setSelectedDate(d.value); setSelectedTime(''); }}
                    className={`p-2 rounded-md text-xs sm:text-sm transition-colors text-center min-h-[44px] ${
                      selectedDate === d.value
                        ? 'bg-primary text-white'
                        : d.isToday
                          ? 'bg-amber-50 border border-amber-200 text-gray-900 hover:bg-amber-100'
                          : 'bg-gray-50 hover:bg-gray-100 text-gray-900'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            {selectedDate && (
              <div>
                <h3 className="text-sm sm:text-base font-medium text-gray-900 mb-3">
                  Select Time
                </h3>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                  {timeSlots.map(s => (
                    <button
                      key={s.time24}
                      onClick={() => setSelectedTime(s.time24)}
                      className={`p-2 rounded-md text-xs sm:text-sm transition-colors min-h-[40px] ${
                        selectedTime === s.time24
                          ? 'bg-primary text-white'
                          : 'bg-gray-50 hover:bg-gray-100 text-gray-900'
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
            <h3 className="text-base font-medium text-gray-900 mb-2">
              Customer Information
            </h3>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Customer Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Full name"
                className="w-full h-10 px-3 rounded-md border border-gray-200 bg-white text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Phone
                </label>
                <div className="flex">
                  <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-gray-200 bg-gray-50 text-sm text-gray-500">
                    +977
                  </span>
                  <input
                    type="tel"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    placeholder="9800000000"
                    className="flex-1 h-10 px-3 rounded-r-md border border-gray-200 bg-white text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="email@example.com"
                  className="w-full h-10 px-3 rounded-md border border-gray-200 bg-white text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Gender
              </label>
              <div className="flex gap-3">
                {[{ value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' }].map(g => (
                  <button
                    key={g.value}
                    onClick={() => setCustomerGender(customerGender === g.value ? '' : g.value)}
                    className={`px-4 py-2 rounded-md text-sm transition-colors border ${
                      customerGender === g.value
                        ? 'border-primary bg-blue-50 text-primary'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Special Requests
              </label>
              <textarea
                value={specialRequests}
                onChange={(e) => setSpecialRequests(e.target.value)}
                placeholder="Any preferences or notes..."
                rows={2}
                className="w-full px-3 py-2 rounded-md border border-gray-200 bg-white text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary resize-none"
              />
            </div>
          </div>
        )}

        {/* STEP 4: Review */}
        {step === 4 && (
          <div className="space-y-4">
            <h3 className="text-base font-medium text-gray-900 mb-2">
              Review Booking
            </h3>

            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Service</span>
                <span className="text-sm font-medium text-gray-900">{selectedService?.name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Duration</span>
                <span className="text-sm text-gray-900">{selectedService?.duration_minutes} min</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Date</span>
                <span className="text-sm text-gray-900">
                  {new Date(selectedDate).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Time</span>
                <span className="text-sm text-gray-900">
                  {timeSlots.find(s => s.time24 === selectedTime)?.time12}
                </span>
              </div>
              <div className="border-t border-gray-200 pt-3 flex items-center justify-between">
                <span className="text-sm text-gray-500">Customer</span>
                <span className="text-sm font-medium text-gray-900">{customerName}</span>
              </div>
              {customerPhone && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Phone</span>
                  <span className="text-sm text-gray-900">+977 {customerPhone}</span>
                </div>
              )}
              {customerEmail && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Email</span>
                  <span className="text-sm text-gray-900">{customerEmail}</span>
                </div>
              )}
              {specialRequests && (
                <div className="flex items-start justify-between">
                  <span className="text-sm text-gray-500">Requests</span>
                  <span className="text-sm text-gray-900 text-right max-w-xs">{specialRequests}</span>
                </div>
              )}
              <div className="border-t border-gray-200 pt-3 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-900">Total</span>
                <span className="text-lg font-semibold text-primary">
                  NPR {Number(selectedService?.price_npr).toLocaleString('en-IN')}
                </span>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <Icon name="AlertTriangle" size={14} className="text-red-600 flex-shrink-0" />
                <span className="text-sm text-red-600">{error}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation - Stack on mobile */}
      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center justify-between sm:justify-start">
          {step > 1 ? (
            <Button variant="outline" onClick={() => setStep(step - 1)} iconName="ArrowLeft" iconPosition="left" className="min-h-[44px]">
              Back
            </Button>
          ) : (
            <div />
          )}
          <button
            onClick={resetForm}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors sm:hidden px-3 py-2"
          >
            Cancel
          </button>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={resetForm}
            className="hidden sm:block text-sm text-gray-500 hover:text-gray-700 transition-colors"
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
              className="flex-1 sm:flex-initial min-h-[44px]"
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
              className="flex-1 sm:flex-initial min-h-[44px]"
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
