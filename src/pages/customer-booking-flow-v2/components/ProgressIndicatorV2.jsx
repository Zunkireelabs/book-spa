import React, { useRef } from 'react';
import Icon from '../../../components/AppIcon';
import useMeasuredHeightVar from 'hooks/useMeasuredHeightVar';

// Same visual language as the v1 ProgressIndicator, but with the Service and Date & Time
// steps collapsed into one ("Service & Time") since v2 books them side-by-side in one step.
const ProgressIndicatorV2 = ({ currentStep, totalSteps, wide }) => {
  const steps = [
    { id: 1, label: 'Branch', icon: 'MapPin' },
    { id: 2, label: 'Service & Time', icon: 'Sparkles' },
    { id: 3, label: 'Details', icon: 'User' },
    { id: 4, label: 'Confirm', icon: 'CheckCircle' }
  ];

  const barRef = useRef(null);
  useMeasuredHeightVar(barRef, '--progress-indicator-h');

  return (
    <div
      ref={barRef}
      className="w-full bg-surface border-b border-border fixed left-0 right-0 z-header"
      style={{ top: 'var(--customer-header-h, 64px)' }}
    >
      {/* The outer bar matches the header's own widening (`wide`, same as
          CustomerHeader) so the two stay consistent once the page expands for the
          drawer — only on this page, only once it's actually expanded. The inner
          icon row widens a step too (max-w-2xl -> max-w-4xl) so it isn't left as a
          small fixed island in a much wider bar, but stays capped well short of the
          full 95vw bar — the connector lines are `flex-1` and stretch to fill
          whatever width they're given, so letting them stretch the *entire* bar
          made them disproportionately long/"broken-looking" next to the icons. */}
      <div className={`mx-auto px-4 py-1 sm:py-2 ${wide ? 'max-w-4xl lg:max-w-[1600px]' : 'max-w-4xl'}`}>
        <div className="flex justify-center">
          <div className={`flex items-center w-full ${wide ? 'max-w-[280px] sm:max-w-3xl' : 'max-w-[280px] sm:max-w-2xl'}`}>
          {steps.map((step, index) => (
            <React.Fragment key={step.id}>
              <div className="flex flex-col items-center flex-shrink-0">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center spa-transition-fast ${
                  currentStep >= step.id
                    ? 'bg-primary text-primary-foreground shadow-spa-elevated'
                    : 'bg-background border-2 border-border text-text-secondary'
                } ${currentStep === step.id ? 'ring-4 ring-primary/15' : ''}`}>
                  <Icon
                    name={currentStep > step.id ? 'Check' : step.icon}
                    size={16}
                  />
                </div>
                <span className={`font-caption font-caption-normal text-xs mt-1.5 hidden sm:block ${
                  currentStep >= step.id ? 'text-primary' : 'text-text-secondary'
                }`}>
                  {step.label}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div className={`flex-1 h-0.5 mx-2 sm:mx-4 rounded-full spa-transition-fast ${
                  currentStep > step.id ? 'bg-primary' : 'bg-border'
                }`} />
              )}
            </React.Fragment>
          ))}
        </div>
        </div>

        <div className="sm:hidden mt-2 text-center leading-tight">
          <span className="font-body font-body-medium text-sm text-text-primary">
            Step {currentStep} of {totalSteps}: {steps[currentStep - 1]?.label}
          </span>
        </div>
      </div>
    </div>
  );
};

export default ProgressIndicatorV2;
