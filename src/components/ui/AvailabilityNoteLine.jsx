import React from 'react';
import Icon from '../AppIcon';

// The amber line on an existing booking the staff-availability rule would now refuse, e.g. "In a block 11:00–12:00 · booking kept".
// Text comes from availabilityShading#outsideNote; shown in the calendar hover card and the side panel's Details tab.
const AvailabilityNoteLine = ({ note, className = '' }) => {
  if (!note) return null;
  return (
    <div data-testid="availability-note" className={`flex items-start gap-1.5 rounded-spa px-2.5 py-1.5 text-[12px] font-medium ${className}`} style={{ background: '#FBF5E6', color: '#7A5408' }}>
      <Icon name="AlertTriangle" size={13} className="mt-px flex-shrink-0" />
      <span>{note}</span>
    </div>
  );
};

export default AvailabilityNoteLine;
