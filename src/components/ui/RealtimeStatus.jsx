import React from 'react';

// Only surfaces when live updates are degraded; a healthy connection renders nothing.
const RealtimeStatus = ({ status }) => {
  if (status === 'connecting') {
    return (
      <span className="hidden sm:inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-warning/10 text-warning text-xs font-body font-body-medium whitespace-nowrap" role="status">
        <span className="h-1.5 w-1.5 rounded-full bg-warning" />
        Reconnecting…
      </span>
    );
  }
  if (status === 'disconnected') {
    return (
      <span
        className="hidden sm:inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-error/10 text-error text-xs font-body font-body-medium whitespace-nowrap"
        title="Live updates paused. Data may be out of date."
        role="status"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-error" />
        Offline
      </span>
    );
  }
  return null;
};

export default RealtimeStatus;
