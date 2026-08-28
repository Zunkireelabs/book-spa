import React from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import ServiceSelection from '../../customer-booking-flow/components/ServiceSelection';
import DateTimeSelection from '../../customer-booking-flow/components/DateTimeSelection';

const formatPrice = (price) => new Intl.NumberFormat('ne-NP', {
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
    <div className="lg:flex lg:items-start lg:gap-6">
      <div className="lg:flex-1 lg:min-w-0">
        <ServiceSelection
          selectedService={selectedService}
          onServiceSelect={onServiceSelect}
          selectedBranch={selectedBranch}
        />
      </div>

      {selectedService && (
        <div className="fixed inset-0 z-modal bg-background flex flex-col overflow-hidden lg:static lg:z-auto lg:flex-none lg:w-[520px] lg:shrink-0 lg:bg-surface lg:rounded-spa-lg lg:border lg:border-border lg:shadow-spa-elevated lg:sticky lg:top-[136px] lg:max-h-[calc(100dvh-152px)]">
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
              panel overflows the viewport and the footer button drops below the fold). */}
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
