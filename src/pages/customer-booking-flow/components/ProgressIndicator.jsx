import React, { useRef } from 'react';
import Icon from '../../../components/AppIcon';
import useMeasuredHeightVar from 'hooks/useMeasuredHeightVar';

const ProgressIndicator = ({ currentStep, totalSteps }) => {
  const steps = [
    { id: 1, label: 'Branch', icon: 'MapPin' },
    { id: 2, label: 'Service', icon: 'Sparkles' },
    { id: 3, label: 'Date & Time', icon: 'Calendar' },
    { id: 4, label: 'Details', icon: 'User' },
    { id: 5, label: 'Confirm', icon: 'CheckCircle' }
  ];

  const barRef = useRef(null);
  useMeasuredHeightVar(barRef, '--progress-indicator-h');

  return (
    <div
      ref={barRef}
      className="w-full bg-surface border-b border-border fixed left-0 right-0 z-header"
      style={{ top: 'var(--customer-header-h, 64px)' }}
    >
      <div className="max-w-4xl mx-auto px-4 py-1 sm:py-2">
        <div className="flex items-center">
          {steps.map((step, index) => (
            <React.Fragment key={step.id}>
              <div className="flex flex-col items-center flex-shrink-0">
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
            </React.Fragment>
          ))}
        </div>
        
        {/* Mobile step indicator */}
        <div className="sm:hidden mt-0.5 text-center leading-tight">
          <span className="font-body font-body-medium text-sm text-text-primary">
            Step {currentStep} of {totalSteps}: {steps[currentStep - 1]?.label}
          </span>
        </div>
      </div>
    </div>
  );
};

export default ProgressIndicator;