import React from 'react';
import Button from '../../../components/ui/Button';

// Mirrors SummaryCard's live total + Continue, for the mobile breakpoint where the
// card sits below the service list instead of alongside it. totalLabel is a
// pre-formatted string (see useCustomerServicePricing) rather than a number —
// an unresolved tiered service in the cart makes this a range, not a figure
// this component can format on its own.
const MobileBookingBar = ({ totalLabel, count, totalMinutes, onContinue, disabled }) => (
  <div className="zn-scope lg:hidden fixed bottom-0 left-0 right-0 z-sticky-filter bg-[var(--zn-card)] border-t border-[var(--zn-border)] shadow-[0_-2px_8px_rgba(35,33,29,0.08)] px-4 py-3 flex items-center gap-4">
    <div className="flex-1 min-w-0">
      <p className="font-['Space_Mono'] tabular-nums text-base font-semibold text-[var(--zn-foreground)]">
        {totalLabel}
      </p>
      {count > 1 && (
        <p className="text-xs text-[var(--zn-muted-foreground)]">
          {count} services · {totalMinutes} min
        </p>
      )}
    </div>
    <Button
      variant="primary"
      onClick={onContinue}
      disabled={disabled}
      className={`shrink-0 rounded-[var(--zn-radius-md)] border-0 ${
        disabled
          ? 'bg-[var(--zn-muted)] text-[var(--zn-muted-foreground)]'
          : 'bg-[var(--zn-primary)] hover:bg-[var(--zn-primary-hover)] text-[var(--zn-primary-foreground)]'
      }`}
    >
      Continue
    </Button>
  </div>
);

export default MobileBookingBar;
