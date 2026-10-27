import React from 'react';
import Icon from '../AppIcon';

// The one pill for a staff transfer: green = happening now, grey = coming up, outline = in the past.
const LOOKS = {
  now: 'bg-primary/10 text-primary',
  upcoming: 'bg-gray-100 text-text-secondary',
  'permanent-upcoming': 'bg-gray-100 text-text-secondary',
  ended: 'border border-border text-text-tertiary',
  'back-early': 'border border-border text-text-tertiary',
  'permanent-done': 'border border-border text-text-tertiary',
};

const TransferPill = ({ state, children, className = '' }) => (
  <span
    data-transfer-pill={state}
    className={`inline-flex items-center rounded-full px-2 py-0.5 font-body text-[11px] font-medium leading-tight whitespace-nowrap ${LOOKS[state] || LOOKS.upcoming} ${className}`}
  >
    <Icon name={state === 'upcoming' || state === 'permanent-upcoming' ? 'Calendar' : 'ArrowRightLeft'} size={11} className="mr-1 flex-shrink-0" />
    {children}
  </span>
);

export default TransferPill;
