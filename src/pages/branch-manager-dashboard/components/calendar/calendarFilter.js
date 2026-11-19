// Team filter helpers (pure). Empty selections mean "everyone".

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

// Label for the filter button: nothing narrowed -> allLabel; one person -> first name; 2+ people or any position -> "N selected".
export function teamFilterLabel({ selectedStaffIds = [], selectedPositions = [], staffOptions = [], allLabel }) {
  const n = selectedStaffIds.length + selectedPositions.length;
  if (n === 0) return allLabel;
  if (selectedStaffIds.length === 1 && selectedPositions.length === 0) {
    const p = staffOptions.find((s) => s.id === selectedStaffIds[0]);
    return p ? firstName(p.name) : '1 selected';
  }
  return `${n} selected`;
}

export const isTeamFilterActive = ({ selectedStaffIds = [], selectedPositions = [] }) => selectedStaffIds.length + selectedPositions.length > 0;

// The word for "everyone": spa keeps "All positions", other industries "All <plural staff label>".
export const teamAllLabel = (staffLabel, staffLabelPlural) => (staffLabel === 'Therapist' ? 'All positions' : `All ${(staffLabelPlural || 'staff').toLowerCase()}`);

export const staffInitials = (name) => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
