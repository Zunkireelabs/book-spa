import React, { useMemo, useState } from 'react';
import { RatedAvatar } from './AvatarCard';
import ProfessionalProfileModal from './ProfessionalProfileModal';

const TEAM_PREVIEW = 4;

const SkeletonCard = () => (
  <div className="p-3 border border-[var(--zn-border)] rounded-[var(--zn-radius-lg)] animate-pulse flex flex-col items-center gap-2">
    <div className="w-12 h-12 rounded-full bg-[var(--zn-muted)]" />
    <div className="h-3 w-16 bg-[var(--zn-muted)] rounded" />
    <div className="h-2.5 w-12 bg-[var(--zn-muted)] rounded" />
  </div>
);

// Fresha-style "pick your person before you even open the booking view" grid. Tapping
// a card preselects selectedProfessional so the summary card reads "with <name>" and
// Continue can skip straight to Time — same eligibility rules as the booking view's
// Professional step, just surfaced a layer earlier. Caller decides whether to render
// this at all (gated on showStaffSelection and a non-empty roster).
const TeamSection = ({ therapists, loading, enableStaffRatings, selectedProfessional, onSelect }) => {
  const [profileTherapist, setProfileTherapist] = useState(null);
  const [showAll, setShowAll] = useState(false);

  // A preselected person must not vanish from a collapsed grid — pin them in if
  // they fall outside the preview window, same rule ServicesSection applies.
  const visible = useMemo(() => {
    if (showAll) return therapists;
    const head = therapists.slice(0, TEAM_PREVIEW);
    if (selectedProfessional?.mode === 'specific' && !head.some((t) => t.id === selectedProfessional.therapist.id)) {
      const picked = therapists.find((t) => t.id === selectedProfessional.therapist.id);
      if (picked) return [...head, picked];
    }
    return head;
  }, [therapists, showAll, selectedProfessional]);

  return (
    <div className="py-8">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="font-normal text-[28px] tracking-[-0.01em] text-[var(--zn-foreground)]">Team</h2>
        {therapists.length > TEAM_PREVIEW && !showAll && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="text-sm underline text-[var(--zn-primary)] hover:text-[var(--zn-primary-hover)]"
          >
            See all
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3" role="radiogroup" aria-label="Pick a team member">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          visible.map((t) => {
            const selected = selectedProfessional?.mode === 'specific' && selectedProfessional.therapist?.id === t.id;
            return (
              <div
                key={t.id}
                className={`p-3 border rounded-[var(--zn-radius-lg)] transition-colors flex flex-col items-center text-center gap-1 ${
                  selected ? 'border-[var(--zn-primary)] bg-[var(--zn-primary-tint)]' : 'border-[var(--zn-border)] hover:border-[var(--zn-primary-soft)]'
                }`}
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onSelect(selected ? null : { mode: 'specific', therapist: t })}
                  className="w-full flex flex-col items-center gap-2"
                >
                  <RatedAvatar therapist={t} enableStaffRatings={enableStaffRatings} />
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-[var(--zn-foreground)] truncate">{t.name}</p>
                    <p className="text-xs text-[var(--zn-muted-foreground)] truncate">{t.position || 'Staff'}</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setProfileTherapist(t)}
                  className="text-xs underline text-[var(--zn-primary)] hover:text-[var(--zn-primary-hover)]"
                >
                  View profile
                </button>
              </div>
            );
          })
        )}
      </div>

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

export default TeamSection;
