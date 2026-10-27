import React from 'react';
import DateTimeSelection from '../../../customer-booking-flow/components/DateTimeSelection';

// Thin wrapper around the reused v1 DateTimeSelection — genderPreference/
// onGenderPreferenceChange pass straight through; DateTimeSelection itself already
// hides the selector when the tenant's industry has no staff-gender concept
// (enableStaffGender) or a specific therapist/filter is already in play.
//
// DateTimeSelection reads selectedService.durationMinutes, while this flow's service
// objects carry duration_minutes — normalized here rather than renaming a field on the
// shared component.
//
// Several services are booked back-to-back as one block, so availability has to be
// checked against the COMBINED duration, not each service's own. A synthetic service
// carrying the summed duration is what makes the shared slot maths reserve the whole
// visit instead of just the first item.
const DateTimeStep = ({ selectedBranch, selectedServices = [], totalMinutes = 0, selectedDateTime, onDateTimeSelect, genderPreference, onGenderPreferenceChange, therapistFilter }) => {
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
        genderPreference={genderPreference}
        onGenderPreferenceChange={onGenderPreferenceChange}
        therapistFilter={therapistFilter}
      />
    </div>
  );
};

export default DateTimeStep;
