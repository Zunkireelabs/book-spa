import React from 'react';
import Button from '../../../../components/ui/Button';
import { formatNPR } from '../../../../services/bookingTransformers';
import { VenueThumb } from '../SummaryCard';

// Group-booking counterpart to SummaryCard — same persistent, sticky right-hand
// summary pattern (venue identity, what's being booked, running total, the primary
// action, always visible without scrolling), just grouped per person instead of a
// single flat service list. Only used for the guests/professional/time steps —
// GroupConfirmStep already renders its own equivalent "Your group" breakdown
// inline as the final review, so this card isn't duplicated there (same split
// SummaryCard has with BookingView's confirm step via `showContinue`).
const priceOf = (s) => Number(s?.effective_price_npr ?? s?.price_npr ?? 0);

const GroupSummaryCard = ({
  orgName,
  logoUrl,
  heroImageUrl,
  people,
  onContinue,
  continueLabel = 'Continue',
  disabled,
  stickyTop = '1.5rem',
}) => {
  const peopleWithServices = people.filter((p) => p.service);
  const total = peopleWithServices.reduce((sum, p) => sum + priceOf(p.service), 0);

  return (
    <div
      style={{ top: stickyTop, '--zn-summary-top': stickyTop }}
      className="lg:sticky bg-[var(--zn-card)] border border-[var(--zn-border)] rounded-[var(--zn-radius-lg)] shadow-[0_1px_3px_rgba(35,33,29,0.08)] p-5 h-fit lg:max-h-[calc(100vh-var(--zn-summary-top,1.5rem)-1.5rem)] lg:overflow-y-auto"
    >
      <div className="flex items-start gap-3">
        <VenueThumb orgName={orgName} logoUrl={logoUrl} heroImageUrl={heroImageUrl} />
        {!logoUrl && (
          <div className="min-w-0">
            <p className="font-medium text-base text-[var(--zn-foreground)] truncate">{orgName}</p>
          </div>
        )}
      </div>

      <div className="mt-5 pt-5 border-t border-[var(--zn-border)] space-y-4">
        {peopleWithServices.length === 0 ? (
          <p className="text-sm text-[var(--zn-muted-foreground)]">No services selected yet.</p>
        ) : (
          peopleWithServices.map((person) => {
            const withWhom = person.professional?.mode === 'specific'
              ? person.professional.therapist?.name
              : person.professional?.mode === 'any'
                ? 'any professional'
                : null;
            return (
              <div key={person.id}>
                <p className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--zn-muted-foreground)] mb-1">
                  {person.label}
                </p>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-medium text-sm text-[var(--zn-foreground)]">{person.service.name}</p>
                  <p className="font-['Space_Mono'] tabular-nums text-sm text-[var(--zn-foreground)] shrink-0">
                    {formatNPR(priceOf(person.service))}
                  </p>
                </div>
                <p className="text-sm text-[var(--zn-muted-foreground)] mt-0.5">
                  {person.service.duration_minutes} min{withWhom ? ` with ${withWhom}` : ''}
                </p>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-5 pt-5 border-t border-[var(--zn-border)] flex items-baseline justify-between gap-3">
        <div>
          <p className="font-medium text-base text-[var(--zn-foreground)]">Total</p>
          {peopleWithServices.length > 1 && (
            <p className="text-xs text-[var(--zn-muted-foreground)] mt-0.5">
              {peopleWithServices.length} people
            </p>
          )}
        </div>
        <p className="font-['Space_Mono'] tabular-nums text-lg font-semibold text-[var(--zn-foreground)]">
          {formatNPR(total)}
        </p>
      </div>

      <Button
        variant="primary"
        onClick={onContinue}
        disabled={disabled}
        className={`hidden lg:flex w-full justify-center mt-6 rounded-[var(--zn-radius-md)] border-0 ${
          disabled
            ? 'bg-[var(--zn-muted)] text-[var(--zn-muted-foreground)]'
            : 'bg-[var(--zn-primary)] hover:bg-[var(--zn-primary-hover)] text-[var(--zn-primary-foreground)]'
        }`}
      >
        {continueLabel}
      </Button>
    </div>
  );
};

export default GroupSummaryCard;
