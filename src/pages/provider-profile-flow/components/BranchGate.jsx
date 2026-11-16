import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import CustomerHeader from '../../../components/ui/CustomerHeader';
import ProfileHero from './ProfileHero';
import { isRealAddress } from '../utils/address';
import { fetchClosedDateRanges, fetchBranchOpeningHours } from '../../../services/api';
import { isDateInRanges, isBranchOpenNow, formatTime12, getNepalNow, getNepalToday } from '../../customer-booking-flow/utils/availability';

// 0=Monday..6=Sunday, matching branch_working_hours.day_of_week (migration-308) —
// JS's own getDay() is 0=Sunday..6=Saturday, so shift it.
const getNepalDayOfWeek = () => (getNepalNow().getDay() + 6) % 7;

// Same onError-hides-itself guard as StorefrontPhoto/VenueThumb — these are
// admin-pasted URLs with nothing validating them, so a dead link is a normal state.
// Falls back to an icon tile (not an empty box) so a photo-less branch still looks
// deliberate, matching VenueThumb's fallback.
const BranchPhoto = ({ branchName, photoUrl }) => {
  const [failed, setFailed] = useState(false);
  if (photoUrl && !failed) {
    return (
      <img
        src={photoUrl}
        alt={`${branchName} storefront`}
        loading="lazy"
        onError={() => setFailed(true)}
        className="w-full aspect-[16/9] object-cover rounded-t-[var(--zn-radius-lg)]"
      />
    );
  }
  return (
    <div className="w-full aspect-[16/9] rounded-t-[var(--zn-radius-lg)] flex items-center justify-center bg-[var(--zn-primary-tint-strong)] text-[var(--zn-primary)]">
      <Icon name="Sparkles" size={32} />
    </div>
  );
};

// First-entry branch chooser for multi-branch orgs — gates the services page so a
// customer can't silently browse/book the wrong location (today's data[0] pick).
// Single-branch orgs never see this; it only renders when branches.length > 1.
// Browser Back is the only way to change branch afterwards (the popstate handler
// re-shows this gate) — there is no in-page switcher.
// Per-branch Open Now/Closed Today status, plus today's actual opening hours for the
// card's hours line — reads branch_working_hours (migration-308's per-day hours, what
// the staff Locations page actually edits) instead of the legacy single
// branches.open_time/close_time pair, which Locations never writes to. Computed here
// (not in the parent) since BranchGate is the only consumer of this derived state.
function useBranchStatus(branches) {
  const [statusByBranchId, setStatusByBranchId] = useState({});

  useEffect(() => {
    if (!branches?.length) return;
    let cancelled = false;

    Promise.all(
      branches.map((b) => Promise.all([
        fetchClosedDateRanges(b.id).then(({ data: ranges }) => ranges || []),
        fetchBranchOpeningHours(b.id).then(({ data: hours }) => hours || []),
      ]))
    ).then((results) => {
      if (cancelled) return;
      const today = getNepalToday();
      const todayDayOfWeek = getNepalDayOfWeek();
      const next = {};
      branches.forEach((b, i) => {
        const [closedRanges, openingHours] = results[i];
        const todayHours = openingHours.find((h) => h.dayOfWeek === todayDayOfWeek);
        const closedToday = isDateInRanges(today, closedRanges) || !!todayHours?.isDayOff;
        next[b.id] = {
          openNow: !closedToday && isBranchOpenNow(todayHours?.startTime, todayHours?.endTime),
          closedToday,
          startTime: todayHours?.startTime || null,
          endTime: todayHours?.endTime || null,
        };
      });
      setStatusByBranchId(next);
    });

    return () => { cancelled = true; };
  }, [branches]);

  return statusByBranchId;
}

const BranchGate = ({ orgName, heroImageUrl, logoUrl, branches, onSelect }) => {
  const statusByBranchId = useBranchStatus(branches);

  return (
  <div className="zn-scope min-h-screen bg-[var(--zn-background)]" style={{ paddingTop: 'var(--customer-header-h, 64px)' }}>
    <CustomerHeader containerClassName="relative max-w-7xl mx-auto px-4 sm:px-6" />
    <ProfileHero orgName={orgName} heroImageUrl={heroImageUrl} logoUrl={logoUrl} />

    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <h2 className="font-normal text-[28px] tracking-[-0.01em] text-[var(--zn-foreground)] mb-4">Choose a location</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {branches.map((branch) => {
          const status = statusByBranchId[branch.id];
          return (
          <div
            key={branch.id}
            onClick={() => onSelect(branch)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(branch); }}
            className="cursor-pointer border border-[var(--zn-border)] rounded-[var(--zn-radius-lg)] bg-[var(--zn-card)] overflow-hidden hover:border-[var(--zn-primary-soft)] transition-colors"
          >
            <BranchPhoto branchName={branch.name} photoUrl={branch.photo_url} />
            <div className="p-4 space-y-2">
              <h3 className="font-medium text-base text-[var(--zn-foreground)]">{branch.name}</h3>
              {isRealAddress(branch.address) && (
                <div className="flex items-start gap-2">
                  <Icon name="MapPin" size={14} className="text-[var(--zn-primary)] shrink-0 mt-0.5" />
                  <span className="text-sm text-[var(--zn-muted-foreground)]">{branch.address}</span>
                </div>
              )}
              {status && (status.startTime || status.endTime || status.closedToday) && (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Icon name="Clock" size={14} className="text-[var(--zn-primary)] shrink-0" />
                    <span className="text-sm text-[var(--zn-muted-foreground)]">
                      {status.closedToday
                        ? 'Closed today'
                        : `${status.startTime ? formatTime12(status.startTime) : '—'} - ${status.endTime ? formatTime12(status.endTime) : '—'}`}
                    </span>
                  </div>
                  <div className={`flex items-center gap-1 ${status.openNow ? 'text-success' : 'text-error'}`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${status.openNow ? 'bg-success animate-pulse' : 'bg-error'}`} />
                    <span className="text-[10px] font-bold uppercase">
                      {status.openNow ? 'Open Now' : status.closedToday ? 'Closed Today' : 'Closed Now'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
          );
        })}
      </div>
    </div>
  </div>
  );
};

export default BranchGate;
