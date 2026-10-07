import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { formatNPR } from '../../../services/bookingTransformers';

// Falls back to the icon tile when the URL is absent *or* fails to load — these are
// admin-pasted URLs with nothing validating them, so a dead link is a normal state, not
// an edge case, and a broken-image icon in the summary looks like a broken app.
const VenueThumb = ({ orgName, logoUrl, heroImageUrl }) => {
  const [failed, setFailed] = useState(false);
  const src = logoUrl || heroImageUrl;

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={orgName}
        onError={() => setFailed(true)}
        className="w-16 h-16 rounded-[var(--zn-radius-md)] object-cover shrink-0"
      />
    );
  }
  return (
    <div className="w-16 h-16 rounded-[var(--zn-radius-md)] shrink-0 flex items-center justify-center bg-[var(--zn-primary-tint-strong)] text-[var(--zn-primary)]">
      <Icon name="Sparkles" size={22} />
    </div>
  );
};

// Persistent right-hand booking summary — venue identity, the chosen service, who it's
// with, the total, and the primary action. Visible on every step so the customer can
// always see what they're about to pay for (replaces the old drawer's cart footer).
//
// There is no org-level rating in the schema (only therapists.rating), so unlike the
// Fresha reference this header carries no star line.
const SummaryCard = ({
  orgName,
  logoUrl,
  heroImageUrl,
  selectedServices = [],
  totalMinutes = 0,
  selectedProfessional,
  onContinue,
  continueLabel = 'Continue',
  disabled,
  showContinue = true,
  stickyTop = '1.5rem',
}) => {
  const priceOf = (s) => Number(s.effective_price_npr ?? s.price_npr ?? 0);
  const total = selectedServices.reduce((sum, s) => sum + priceOf(s), 0);

  const withWhom = selectedProfessional?.mode === 'specific'
    ? selectedProfessional.therapist?.name
    : selectedProfessional?.mode === 'any'
      ? 'any professional'
      : null;

  return (
    <div
      style={{ top: stickyTop, '--zn-summary-top': stickyTop }}
      className="lg:sticky bg-[var(--zn-card)] border border-[var(--zn-border)] rounded-[var(--zn-radius-lg)] shadow-[0_1px_3px_rgba(35,33,29,0.08)] p-5 h-fit lg:max-h-[calc(100vh-var(--zn-summary-top,1.5rem)-1.5rem)] lg:overflow-y-auto"
    >
      <div className="flex items-start gap-3">
        <VenueThumb orgName={orgName} logoUrl={logoUrl} heroImageUrl={heroImageUrl} />
        <div className="min-w-0">
          <p className="font-medium text-base text-[var(--zn-foreground)] truncate">{orgName}</p>
        </div>
      </div>

      <div className="mt-5 pt-5 border-t border-[var(--zn-border)]">
        {selectedServices.length === 0 ? (
          <p className="text-sm text-[var(--zn-muted-foreground)]">No services selected yet.</p>
        ) : (
          <div className="space-y-3">
            {selectedServices.map((service) => (
              <div key={service.id}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-medium text-sm text-[var(--zn-foreground)]">{service.name}</p>
                  <p className="font-['Space_Mono'] tabular-nums text-sm text-[var(--zn-foreground)] shrink-0">
                    {formatNPR(priceOf(service))}
                  </p>
                </div>
                <p className="text-sm text-[var(--zn-muted-foreground)] mt-0.5">
                  {service.duration_minutes} min{withWhom ? ` with ${withWhom}` : ''}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-5 pt-5 border-t border-[var(--zn-border)] flex items-baseline justify-between gap-3">
        <div>
          <p className="font-medium text-base text-[var(--zn-foreground)]">Total</p>
          {selectedServices.length > 1 && (
            <p className="text-xs text-[var(--zn-muted-foreground)] mt-0.5">
              {selectedServices.length} services · {totalMinutes} min
            </p>
          )}
        </div>
        <p className="font-['Space_Mono'] tabular-nums text-lg font-semibold text-[var(--zn-foreground)]">
          {formatNPR(total)}
        </p>
      </div>

      {showContinue && (
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
      )}
    </div>
  );
};

export default SummaryCard;
