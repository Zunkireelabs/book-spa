import React from 'react';
import CustomerForm from '../../../customer-booking-flow/components/CustomerForm';
import BookingConfirmation from '../../../customer-booking-flow/components/BookingConfirmation';

// Thin wrapper composing the reused v1 CustomerForm + BookingConfirmation — "Confirm"
// is itself a two-part sub-step (details form, then the confirm screen), toggled by
// whether the customer has agreed to terms yet.
const ConfirmStep = ({
  orgSlug,
  selectedBranch,
  selectedServices = [],
  selectedDateTime,
  customerInfo,
  onCustomerInfoChange,
  customerAccountId,
  selectedProfessional,
  showConfirmation,
  onConfirmBooking,
  onEditBooking,
}) => {
  const therapistId = selectedProfessional?.mode === 'specific' ? selectedProfessional.therapist?.id : null;
  const therapistName = selectedProfessional?.mode === 'specific' ? selectedProfessional.therapist?.name : null;

  return (
  <div>
    {showConfirmation ? (
      <BookingConfirmation
        orgSlug={orgSlug}
        selectedBranch={selectedBranch}
        selectedService={selectedServices[0] || null}
        additionalServices={selectedServices}
        selectedDateTime={selectedDateTime}
        customerInfo={customerInfo}
        genderPreference="no-preference"
        customerAccountId={customerAccountId}
        therapistId={therapistId}
        therapistName={therapistName}
        onConfirmBooking={onConfirmBooking}
        onEditBooking={onEditBooking}
      />
    ) : (
      <CustomerForm
        customerInfo={customerInfo}
        onCustomerInfoChange={onCustomerInfoChange}
        selectedBranch={selectedBranch}
        selectedService={selectedServices[0] || null}
        selectedDateTime={selectedDateTime}
        genderPreference="no-preference"
        orgSlug={orgSlug}
        showSummary={false}
      />
    )}
  </div>
  );
};

export default ConfirmStep;
