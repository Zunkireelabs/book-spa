import React from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import ServiceSelection from '../../customer-booking-flow/components/ServiceSelection';
import DateTimeSelection from '../../customer-booking-flow/components/DateTimeSelection';

const formatPrice = (price) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'NPR',
  minimumFractionDigits: 0
}).format(price);

// ServiceSelection is rendered completely untouched. The only thing that changes when a
// service is picked is that its wrapper becomes a flex-1 child sharing a row with a
// fixed-width drawer sibling — the grid's own internal `grid-cols-3` naturally reflows
// narrower to fit, the same way it would in any responsive container. Nothing here ever
// repositions the grid or overlays on top of it; the drawer only ever occupies the space
// freed up by that reflow (see index.jsx for how the row's left edge stays pinned).
const ServiceBookingPanel = ({
  selectedBranch,
  selectedService,
  onServiceSelect,
  selectedDateTime,
  onDateTimeSelect,
  genderPreference,
  onGenderPreferenceChange,
  onContinue,
  canContinue,
}) => {
  return (
    <div className="lg:flex lg:items-start lg:justify-center lg:gap-8">
      {/* Capped (not flex-1/growing) so cards don't keep stretching wider as `main`
          grows to 1600px for the drawer — 3 columns of ever-wider cards read as
          flat/"fat" rather than more content. `justify-center` on the row means any
          leftover width splits evenly on the outside (left of the grid, right of the
          drawer) instead of piling up as a single dead gap between the two. */}
      <div className="lg:w-full lg:max-w-4xl lg:min-w-0">
        <ServiceSelection
          selectedService={selectedService}
          onServiceSelect={onServiceSelect}
          selectedBranch={selectedBranch}
        />
      </div>

      {/* `top`/`max-h` match the same --customer-header-h / --progress-indicator-h
          vars the service grid's sticky title uses (ServiceSelection.jsx), instead
          of a hardcoded px offset that goes stale whenever the header or stepper's
          own height changes. */}
      {selectedService && (
        <div className="fixed inset-0 z-modal bg-background flex flex-col overflow-hidden lg:static lg:z-auto lg:flex-none lg:w-[460px] lg:shrink-0 lg:bg-surface lg:rounded-spa-lg lg:border lg:border-border lg:shadow-spa-elevated lg:sticky lg:top-[calc(var(--customer-header-h,64px)+var(--progress-indicator-h,67px)+12px)] lg:max-h-[calc(100dvh-var(--customer-header-h,64px)-var(--progress-indicator-h,67px)-28px)]">
          <button
            type="button"
            onClick={() => onServiceSelect(null)}
            className="lg:hidden shrink-0 flex items-center gap-1 text-text-secondary hover:text-text-primary spa-transition-fast p-4 pb-0"
          >
            <Icon name="ChevronLeft" size={18} />
            <span className="font-body font-body-medium text-sm">Back to services</span>
          </button>

          {/* Scrollable content — the footer below is a separate flex sibling, never a
              sticky overlay, so it can never overlap this area no matter how tall it gets.
              `min-h-0` is required for this to actually scroll inside the flex column
              (without it the flex item refuses to shrink below its content height, so the
              panel overflows the viewport and the footer button drops below the fold).
              On desktop (lg:) the outer wrapper is `sticky` and height-capped to the
              viewport, so this scrolls internally once content is taller than that —
              the drawer stays pinned alongside the service grid either way. */}
          <div className="flex-1 min-h-0 overflow-y-auto p-4 lg:p-6">
            <h2 className="font-heading font-heading-semibold text-xl text-text-primary mb-3">
              Book Your Visit
            </h2>
            <div className="flex items-center justify-between gap-3 p-3 mb-4 bg-primary/5 border border-primary/10 rounded-spa">
              <div>
                <p className="font-heading font-heading-medium text-text-primary">{selectedService.name}</p>
                <p className="font-body font-body-normal text-sm text-text-secondary flex items-center gap-1 mt-0.5">
                  <Icon name="Clock" size={12} />
                  {selectedService.duration}
                </p>
              </div>
              <span className="font-heading font-heading-semibold text-primary whitespace-nowrap">
                {formatPrice(selectedService.price)}
              </span>
            </div>

            <DateTimeSelection
              selectedDateTime={selectedDateTime}
              onDateTimeSelect={onDateTimeSelect}
              selectedService={selectedService}
              selectedBranch={selectedBranch}
              genderPreference={genderPreference}
              onGenderPreferenceChange={onGenderPreferenceChange}
            />
          </div>

          {/* Fixed footer — always visible at the bottom of the drawer, own space, no overlap */}
          <div className="shrink-0 border-t border-border bg-surface p-4">
            <Button
              variant="primary"
              onClick={onContinue}
              disabled={!canContinue}
              iconName="ChevronRight"
              iconPosition="right"
              fullWidth
              className="spa-touch-target"
            >
              Continue to Your Details
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ServiceBookingPanel;
