import React, { useEffect, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import ProfessionalProfileModal from '../ProfessionalProfileModal';
import { RatedAvatar } from '../AvatarCard';

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

const SkeletonCard = () => (
  <div className="flex items-center gap-3 p-3 border border-[var(--zn-border)] rounded-[var(--zn-radius-lg)] animate-pulse">
    <div className="w-12 h-12 rounded-full bg-[var(--zn-muted)] shrink-0" />
    <div className="flex-1 space-y-2">
      <div className="h-3.5 w-28 bg-[var(--zn-muted)] rounded" />
      <div className="h-3 w-20 bg-[var(--zn-muted)] rounded" />
    </div>
  </div>
);

// Fresha-style "Select professional" step: "Any professional" pinned first, then one
// card per staff member. Single round trip is owned by the parent BookingView
// (fetchBookableTherapists) so this step and DateTimeStep never double-fetch.
const ProfessionalStep = ({
  therapists,
  loading,
  error,
  onRetry,
  enableStaffRatings,
  selectedProfessional,
  onSelect,
}) => {
  const [profileTherapist, setProfileTherapist] = useState(null);

  // Empty roster is a legitimate state (org hasn't set up staff profiles) — auto-pick
  // "Any professional" so a customer is never dead-ended on an empty list.
  useEffect(() => {
    if (!loading && !error && therapists.length === 0 && !selectedProfessional) {
      onSelect({ mode: 'any' });
    }
  }, [loading, error, therapists.length, selectedProfessional, onSelect]);

  if (loading) {
    return (
      <div className="space-y-3" role="radiogroup" aria-label="Pick a professional">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-[var(--zn-muted-foreground)]">
          <Icon name="AlertCircle" size={16} className="text-error" />
          Couldn't load our professionals — you can still continue with "Any professional".
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onRetry} className="flex-1">Retry</Button>
          <Button variant="primary" onClick={() => onSelect({ mode: 'any' })} className="flex-1">
            Any professional
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3" role="radiogroup" aria-label="Pick a professional">
      <RadioCard
        selected={selectedProfessional?.mode === 'any'}
        onClick={() => onSelect({ mode: 'any' })}
      >
        <div className="w-12 h-12 rounded-full shrink-0 flex items-center justify-center bg-[var(--zn-primary-tint-strong)] text-[var(--zn-primary)]">
          <Icon name="Users" size={20} />
        </div>
        <div className="min-w-0">
          <p className="font-medium text-sm text-[var(--zn-foreground)]">Any professional</p>
          <p className="text-xs text-[var(--zn-muted-foreground)]">Maximum availability</p>
        </div>
      </RadioCard>

      {therapists.length === 0 ? (
        <p className="text-sm text-[var(--zn-muted-foreground)] px-1">No professionals to choose from yet — "Any professional" still works.</p>
      ) : (
        therapists.map((t) => {
          const selected = selectedProfessional?.mode === 'specific' && selectedProfessional.therapist?.id === t.id;
          // "View profile" is its own control, so the row can't be a single <button>
          // (nested buttons are invalid) — the radio is the inner button and the link
          // sits beside it, offered unconditionally (Fresha parity) regardless of how
          // complete the therapist's profile fields are.
          return (
            <div
              key={t.id}
              className={`p-3 border rounded-[var(--zn-radius-lg)] transition-colors ${
                selected ? 'border-[var(--zn-primary)] bg-[var(--zn-primary-tint)]' : 'border-[var(--zn-border)] hover:border-[var(--zn-primary-soft)]'
              }`}
            >
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onSelect({ mode: 'specific', therapist: t })}
                className="w-full flex items-center gap-3 text-left"
              >
                <RatedAvatar therapist={t} enableStaffRatings={enableStaffRatings} />
                <div className="min-w-0">
                  <p className="font-medium text-sm text-[var(--zn-foreground)] truncate">{t.name}</p>
                  <p className="text-xs text-[var(--zn-muted-foreground)] truncate">{t.position || 'Staff'}</p>
                </div>

                <span
                  className={`ml-auto shrink-0 px-2.5 py-1 rounded-[var(--zn-radius-full)] text-xs font-medium ${
                    selected ? 'bg-[var(--zn-primary)] text-white' : 'border border-[var(--zn-border)] text-[var(--zn-muted-foreground)]'
                  }`}
                >
                  {selected ? 'Selected' : 'Select'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setProfileTherapist(t)}
                className="ml-[60px] mt-1 text-xs underline text-[var(--zn-primary)] hover:text-[var(--zn-primary-hover)]"
              >
                View profile
              </button>
            </div>
          );
        })
      )}

      {profileTherapist && (
        <ProfessionalProfileModal
          therapist={profileTherapist}
          enableStaffRatings={enableStaffRatings}
          onClose={() => setProfileTherapist(null)}
        />
      )}
    </div>
  );
};

export default ProfessionalStep;
