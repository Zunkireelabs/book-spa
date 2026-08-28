import React from 'react';
import Icon from '../../../components/AppIcon';

// Same visual language as the v1 ProgressIndicator, but with the Service and Date & Time
// steps collapsed into one ("Service & Time") since v2 books them side-by-side in one step.
const ProgressIndicatorV2 = ({ currentStep, totalSteps }) => {
  const steps = [
    { id: 1, label: 'Branch', icon: 'MapPin' },
    { id: 2, label: 'Service & Time', icon: 'Sparkles' },
    { id: 3, label: 'Details', icon: 'User' },
    { id: 4, label: 'Confirm', icon: 'CheckCircle' }
  ];

  return (
    <div className="w-full bg-surface border-b border-border sticky top-16 left-0 right-0 z-header">
      <div className="max-w-4xl mx-auto px-4 py-2">
        <div className="flex items-center justify-between">
          {steps.map((step, index) => (
            <div key={step.id} className="flex items-center flex-1">
              <div className="flex flex-col items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center spa-transition-fast ${
                  currentStep >= step.id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background border-2 border-border text-text-secondary'
                }`}>
                  <Icon
                    name={currentStep > step.id ? 'Check' : step.icon}
                    size={16}
                  />
                </div>
                <span className={`font-caption font-caption-normal text-xs mt-1 hidden sm:block ${
                  currentStep >= step.id ? 'text-primary' : 'text-text-secondary'
                }`}>
                  {step.label}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div className={`flex-1 h-0.5 mx-2 sm:mx-4 ${
                  currentStep > step.id ? 'bg-primary' : 'bg-border'
                }`} />
              )}
            </div>
          ))}
        </div>

        <div className="sm:hidden mt-2 text-center">
          <span className="font-body font-body-medium text-sm text-text-primary">
            Step {currentStep} of {totalSteps}: {steps[currentStep - 1]?.label}
          </span>
        </div>
      </div>
    </div>
  );
};

export default ProgressIndicatorV2;
