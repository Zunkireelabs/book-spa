import React from 'react';
import DateTimeSelection from '../../../customer-booking-flow/components/DateTimeSelection';

// Thin wrapper around the reused v1 DateTimeSelection — no gender preference UI in
// this layout (sbal's beauty industry has no staff-gender concept), so a stable
// no-preference value is passed through unchanged.
//
// DateTimeSelection reads selectedService.durationMinutes, while this flow's service
// objects carry duration_minutes — normalized here rather than renaming a field on the
// shared component.
//
// Several services are booked back-to-back as one block, so availability has to be
// checked against the COMBINED duration, not each service's own. A synthetic service
// carrying the summed duration is what makes the shared slot maths reserve the whole
// visit instead of just the first item.
const DateTimeStep = ({ selectedBranch, selectedServices = [], totalMinutes = 0, selectedDateTime, onDateTimeSelect, therapistFilter }) => {
  const normalizedService = selectedServices.length > 0
    ? {
        ...selectedServices[0],
        name: selectedServices.length > 1
          ? `${selectedServices.length} services`
          : selectedServices[0].name,
        durationMinutes: totalMinutes,
        duration_minutes: totalMinutes,
      }
    : null;

  return (
    <div>
      <DateTimeSelection
        selectedBranch={selectedBranch}
        selectedService={normalizedService}
        selectedDateTime={selectedDateTime}
        onDateTimeSelect={onDateTimeSelect}
        genderPreference="no-preference"
        onGenderPreferenceChange={() => {}}
        therapistFilter={therapistFilter}
      />
    </div>
  );
};

export default DateTimeStep;
