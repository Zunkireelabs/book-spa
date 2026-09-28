import React, { useEffect, useRef, useState } from 'react';
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
  onPrevious,
}) => {
  // Same fade-out-on-scroll treatment as "Your Information"'s title (index.jsx) and
  // the service page's own title — except this drawer scrolls *internally*
  // (overflow-y-auto on its own div, see below), not the window, so it needs its
  // own scroll listener on that container rather than the window-based
  // useScrollCollapse hook. "Back to services" stays outside this scrollable area
  // (shrink-0) so it's already always visible without needing a fade-in.
  const drawerScrollRef = useRef(null);
  const drawerTitleRef = useRef(null);
  const [drawerTitleHeight, setDrawerTitleHeight] = useState(0);
  const [drawerScrollProgress, setDrawerScrollProgress] = useState(0);
  const DRAWER_TITLE_COLLAPSE_DISTANCE = 60;

  useEffect(() => {
    if (!drawerTitleRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setDrawerTitleHeight(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height);
    });
    observer.observe(drawerTitleRef.current);
    return () => observer.disconnect();
  }, [selectedService?.id]);

  useEffect(() => {
    const el = drawerScrollRef.current;
    if (!el) return;
    let ticking = false;
    const update = () => {
      ticking = false;
      setDrawerScrollProgress(Math.min(1, Math.max(0, el.scrollTop / DRAWER_TITLE_COLLAPSE_DISTANCE)));
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };
    update();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [selectedService?.id]);

  return (
    <div className="lg:flex lg:items-start lg:justify-center lg:gap-10">
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
          onPrevious={onPrevious}
        />

        {/* Sits right under the grid itself (not after the whole row), so with
            only one or two cards visible it lands just below them instead of
            trailing all the way down to match the taller drawer sibling. */}
        <div className="mt-4">
          <Button
            variant="outline"
            onClick={onPrevious}
            iconName="ChevronLeft"
            iconSize={16}
          >
            Previous
          </Button>
        </div>
      </div>

      {/* `top`/`max-h` match the same --customer-header-h / --progress-indicator-h
          vars the service grid's sticky title uses (ServiceSelection.jsx), instead
          of a hardcoded px offset that goes stale whenever the header or stepper's
          own height changes. On mobile this drawer used to be `inset-0` (covering
          the site header and step progress bar entirely) — starting it below both
          instead keeps them visible, same as desktop. */}
      {selectedService && (
        <div className="fixed inset-x-0 bottom-0 top-[calc(var(--customer-header-h,64px)+var(--progress-indicator-h,67px))] z-modal bg-background flex flex-col overflow-hidden lg:static lg:z-auto lg:flex-none lg:w-[460px] lg:shrink-0 lg:bg-surface lg:rounded-spa-lg lg:border lg:border-border lg:shadow-spa-elevated lg:sticky lg:top-[calc(var(--customer-header-h,64px)+var(--progress-indicator-h,67px)+12px)] lg:max-h-[calc(100dvh-var(--customer-header-h,64px)-var(--progress-indicator-h,67px)-28px)]">
          {/* Icon-only, always visible — same treatment as the other steps' top
              Previous button, not tied to scroll. Stays outside the scrollable area
              (shrink-0) so it never scrolls away. */}
          <div className="lg:hidden shrink-0 px-4 pt-2">
            <button
              type="button"
              onClick={() => onServiceSelect(null)}
              aria-label="Back to services"
              className="flex items-center justify-center w-8 h-8 rounded-full text-text-secondary hover:text-text-primary hover:bg-surface spa-transition-fast spa-touch-target"
            >
              <Icon name="ChevronLeft" size={20} />
            </button>
          </div>

          {/* Scrollable content — the footer below is a separate flex sibling, never a
              sticky overlay, so it can never overlap this area no matter how tall it gets.
              `min-h-0` is required for this to actually scroll inside the flex column
              (without it the flex item refuses to shrink below its content height, so the
              panel overflows the viewport and the footer button drops below the fold).
              On desktop (lg:) the outer wrapper is `sticky` and height-capped to the
              viewport, so this scrolls internally once content is taller than that —
              the drawer stays pinned alongside the service grid either way. */}
          <div ref={drawerScrollRef} className="flex-1 min-h-0 overflow-y-auto p-4 lg:p-6">
            <div
              className="overflow-hidden [overflow-anchor:none]"
              style={{
                maxHeight: drawerTitleHeight ? drawerTitleHeight * (1 - drawerScrollProgress) : undefined,
                opacity: 1 - drawerScrollProgress,
              }}
            >
              <h2 ref={drawerTitleRef} className="font-heading font-heading-semibold text-xl text-text-primary mb-3 text-center">
                Book Your Visit
              </h2>
            </div>
            <div className="flex items-center justify-between gap-2 sm:gap-3 p-2 sm:p-3 mb-3 sm:mb-4 bg-primary/5 border border-primary/10 rounded-spa">
              <div className="min-w-0">
                <p className="font-heading font-heading-medium text-sm sm:text-base text-text-primary">{selectedService.name}</p>
                <p className="font-body font-body-normal text-xs sm:text-sm text-text-secondary flex items-center gap-1 mt-0.5">
                  <Icon name="Clock" size={12} />
                  {selectedService.duration}
                </p>
              </div>
              <span className="font-heading font-heading-semibold text-sm sm:text-base text-primary whitespace-nowrap">
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
              size="sm"
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
