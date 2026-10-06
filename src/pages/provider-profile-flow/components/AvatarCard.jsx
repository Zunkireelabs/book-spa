import React from 'react';
import Icon from '../../../components/AppIcon';
import { getInitials, getTint } from './avatar';

// Shared by ProfessionalStep (booking view) and TeamSection (profile page) — same
// photo/initials-fallback presentation of a therapist wherever one is picked from.
export const Avatar = ({ therapist }) => {
  if (therapist.photoUrl) {
    return (
      <img
        src={therapist.photoUrl}
        alt={therapist.name}
        className="w-12 h-12 rounded-full object-cover shrink-0"
      />
    );
  }
  const tint = getTint(therapist.name);
  return (
    <div className={`w-12 h-12 rounded-full shrink-0 flex items-center justify-center font-semibold text-sm ${tint.bg} ${tint.text}`}>
      {getInitials(therapist.name)}
    </div>
  );
};

// Fresha-style rating pill on the avatar's bottom-left corner, freeing the line under
// the position for "View profile" instead of sharing it with the rating.
export const RatedAvatar = ({ therapist, enableStaffRatings }) => (
  <span className="relative shrink-0">
    <Avatar therapist={therapist} />
    {enableStaffRatings && therapist.rating != null && (
      <span className="absolute bottom-0 -left-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-white border border-[var(--zn-border)] text-[10px] font-medium text-[var(--zn-foreground)]">
        <Icon name="Star" size={9} className="text-amber-500 fill-amber-500" />
        {Number(therapist.rating).toFixed(1)}
      </span>
    )}
  </span>
);
