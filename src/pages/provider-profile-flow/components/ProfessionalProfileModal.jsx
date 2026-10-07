import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../../components/AppIcon';
import { getInitials, getTint } from './avatar';

// Per-staff profile sheet, opened from the "View profile" link on a professional card.
//
// Scope note: the Fresha reference also shows appointments completed, clients served,
// languages, portfolio and reviews. None of those exist in this schema, so this renders
// only what therapists actually carries — photo/initials, name, position, rating, bio,
// experience_years. "View profile" is offered unconditionally (Fresha parity), so a
// therapist with none of bio/experience/photo set still opens a sheet — it just falls
// back to a "no additional details" line instead of a stub.
const ProfessionalProfileModal = ({ therapist, enableStaffRatings, onClose }) => {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!therapist) return null;

  const tint = getTint(therapist.name);

  return createPortal(
    <div className="zn-scope fixed inset-0 z-modal-overlay flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[var(--zn-overlay)]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${therapist.name} profile`}
        className="relative w-full max-w-md max-h-[85vh] overflow-y-auto bg-[var(--zn-card)] rounded-[var(--zn-radius-lg)] shadow-[0_4px_24px_rgba(35,33,29,0.18)] p-6"
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 p-1 rounded-full hover:bg-[var(--zn-muted)]"
        >
          <Icon name="X" size={20} className="text-[var(--zn-muted-foreground)]" />
        </button>

        <div className="flex flex-col items-center text-center">
          {therapist.photoUrl ? (
            <img src={therapist.photoUrl} alt={therapist.name} className="w-24 h-24 rounded-full object-cover" />
          ) : (
            <div className={`w-24 h-24 rounded-full flex items-center justify-center font-semibold text-2xl ${tint.bg} ${tint.text}`}>
              {getInitials(therapist.name)}
            </div>
          )}

          <h2 className="mt-4 font-medium text-xl text-[var(--zn-foreground)]">{therapist.name}</h2>
          {therapist.position && (
            <p className="text-sm text-[var(--zn-muted-foreground)] mt-0.5">{therapist.position}</p>
          )}
          {enableStaffRatings && therapist.rating != null && (
            <p className="mt-2 inline-flex items-center gap-1 text-sm text-[var(--zn-foreground)]">
              <Icon name="Star" size={14} className="text-amber-500 fill-amber-500" />
              <span className="font-['Space_Mono'] tabular-nums">{Number(therapist.rating).toFixed(1)}</span>
            </p>
          )}
        </div>

        {therapist.experienceYears != null && (
          <div className="mt-6 pt-5 border-t border-[var(--zn-border)] flex items-baseline justify-between">
            <span className="text-sm text-[var(--zn-muted-foreground)]">Experience</span>
            <span className="text-sm text-[var(--zn-foreground)]">
              <span className="font-['Space_Mono'] tabular-nums">{therapist.experienceYears}</span>
              {` year${therapist.experienceYears === 1 ? '' : 's'}`}
            </span>
          </div>
        )}

        {therapist.bio && (
          <div className="mt-6 pt-5 border-t border-[var(--zn-border)]">
            <h3 className="font-['Inter'] text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--zn-muted-foreground)] mb-2">
              About
            </h3>
            <p className="text-sm leading-relaxed text-[var(--zn-muted-foreground)] whitespace-pre-wrap">
              {therapist.bio}
            </p>
          </div>
        )}

        {therapist.experienceYears == null && !therapist.bio && (
          <p className="mt-6 pt-5 border-t border-[var(--zn-border)] text-sm text-[var(--zn-muted-foreground)] text-center">
            We don't have more to share about {therapist.name} yet.
          </p>
        )}
      </div>
    </div>,
    document.body
  );
};

export default ProfessionalProfileModal;
