import React from 'react';
import Icon from '../../../../components/AppIcon';
import ServicesSection from '../ServicesSection';
import { MAX_GROUP_SIZE } from '../../utils/groupBooking';

const PersonRow = ({ person, isActive, onSelect }) => (
  <button
    type="button"
    onClick={onSelect}
    className={`w-full flex items-center justify-between gap-3 p-3 border rounded-[var(--zn-radius-lg)] text-left transition-colors ${
      isActive ? 'border-[var(--zn-primary)] bg-[var(--zn-primary-tint)]' : 'border-[var(--zn-border)] hover:border-[var(--zn-primary-soft)]'
    }`}
  >
    <div className="min-w-0">
      <p className="font-medium text-sm text-[var(--zn-foreground)]">{person.label}</p>
      <p className="text-xs text-[var(--zn-muted-foreground)] truncate">
        {person.service ? person.service.name : 'No services selected'}
      </p>
    </div>
    <Icon name="ChevronRight" size={16} className="text-[var(--zn-muted-foreground)] shrink-0" />
  </button>
);

// Fresha's "Add guests and services" screen — one person active at a time; picking a
// service for the active person reuses the existing ServicesSection, but in
// single-select mode (a click always REPLACES the active person's service, never
// toggles it off) since this screen's job is "exactly one service per guest", not the
// solo flow's multi-service cart.
const GuestsStep = ({ people, services, activeGuestId, onSelectActiveGuest, onServiceChosenForActiveGuest, onAddGuest, onRemoveGuest }) => {
  const activePerson = people.find((p) => p.id === activeGuestId) || null;
  const atMax = people.length >= MAX_GROUP_SIZE;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {people.map((person) => (
          <div key={person.id} className="flex items-center gap-2">
            <div className="flex-1">
              <PersonRow person={person} isActive={person.id === activeGuestId} onSelect={() => onSelectActiveGuest(person.id)} />
            </div>
            {!person.isLead && (
              <button
                type="button"
                onClick={() => onRemoveGuest(person.id)}
                aria-label={`Remove ${person.label}`}
                className="w-9 h-9 shrink-0 rounded-full border border-[var(--zn-border)] flex items-center justify-center hover:border-error hover:text-error text-[var(--zn-muted-foreground)]"
              >
                <Icon name="X" size={14} />
              </button>
            )}
          </div>
        ))}
      </div>

      <div>
        <button
          type="button"
          onClick={onAddGuest}
          disabled={atMax}
          className="w-full flex items-center justify-center gap-2 p-3 border border-dashed border-[var(--zn-border)] rounded-[var(--zn-radius-lg)] text-sm font-medium text-[var(--zn-primary)] hover:bg-[var(--zn-primary-tint)] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        >
          <Icon name="Plus" size={16} />
          Add guest
        </button>
        <p className="mt-2 text-xs text-center text-[var(--zn-muted-foreground)]">
          Book a group appointment for up to 6 guests
        </p>
      </div>

      {activePerson && (
        <div className="pt-4 border-t border-[var(--zn-border)]">
          <h2 className="font-medium text-base text-[var(--zn-foreground)] mb-3">
            Choose a service for {activePerson.label}
          </h2>
          <ServicesSection
            services={services}
            selectedServices={activePerson.service ? [activePerson.service] : []}
            onServiceToggle={(service) => onServiceChosenForActiveGuest(service)}
          />
        </div>
      )}
    </div>
  );
};

export default GuestsStep;
