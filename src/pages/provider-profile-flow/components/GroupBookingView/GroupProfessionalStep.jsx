import React from 'react';
import Icon from '../../../../components/AppIcon';
import ProfessionalStep from '../BookingView/ProfessionalStep';

const RadioCard = ({ selected, onClick, children }) => (
  <button
    type="button"
    role="radio"
    aria-checked={selected}
    onClick={onClick}
    className={`w-full flex items-center gap-3 p-3 border rounded-[var(--zn-radius-lg)] text-left transition-colors ${
      selected ? 'border-[var(--zn-primary)] bg-[var(--zn-primary-tint)]' : 'border-[var(--zn-border)] hover:border-[var(--zn-primary-soft)]'
    }`}
  >
    {children}
    <span
      className={`ml-auto shrink-0 px-2.5 py-1 rounded-[var(--zn-radius-full)] text-xs font-medium ${
        selected ? 'bg-[var(--zn-primary)] text-white' : 'border border-[var(--zn-border)] text-[var(--zn-muted-foreground)]'
      }`}
    >
      {selected ? 'Selected' : 'Select'}
    </span>
  </button>
);

// Fresha's two-tier professional step for a group: "Any professional" applies to the
// whole party in one tap; "Select professional per service" expands the existing
// solo ProfessionalStep once per person, reused unmodified — each instance is
// independent, bound to its own person's professional/onSelect.
const GroupProfessionalStep = ({ people, therapists, loading, error, onRetry, mode, onSelectAnyForAll, onSelectPerGuestMode, onPersonProfessionalSelect }) => (
  <div className="space-y-6">
    <div className="space-y-3" role="radiogroup" aria-label="Choose how to assign professionals">
      <RadioCard selected={mode === 'any'} onClick={onSelectAnyForAll}>
        <div className="w-12 h-12 rounded-full shrink-0 flex items-center justify-center bg-[var(--zn-primary-tint-strong)] text-[var(--zn-primary)]">
          <Icon name="Users" size={20} />
        </div>
        <div className="min-w-0">
          <p className="font-medium text-sm text-[var(--zn-foreground)]">Any professional</p>
          <p className="text-xs text-[var(--zn-muted-foreground)]">Maximum availability</p>
        </div>
      </RadioCard>

      <RadioCard selected={mode === 'per-guest'} onClick={onSelectPerGuestMode}>
        <div className="w-12 h-12 rounded-full shrink-0 flex items-center justify-center bg-[var(--zn-primary-tint-strong)] text-[var(--zn-primary)]">
          <Icon name="UserCheck" size={20} />
        </div>
        <div className="min-w-0">
          <p className="font-medium text-sm text-[var(--zn-foreground)]">Select professional per service</p>
          <p className="text-xs text-[var(--zn-muted-foreground)]">Choose for each person individually</p>
        </div>
      </RadioCard>
    </div>

    {mode === 'per-guest' && (
      <div className="space-y-6">
        {people.map((person) => (
          <div key={person.id}>
            <h3 className="font-medium text-sm text-[var(--zn-foreground)] mb-2">
              {person.label} — {person.service?.name}
            </h3>
            <ProfessionalStep
              therapists={therapists}
              loading={loading}
              error={error}
              onRetry={onRetry}
              selectedProfessional={person.professional}
              onSelect={(selection) => onPersonProfessionalSelect(person.id, selection)}
            />
          </div>
        ))}
      </div>
    )}
  </div>
);

export default GroupProfessionalStep;
