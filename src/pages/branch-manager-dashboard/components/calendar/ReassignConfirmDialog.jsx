import React, { useState } from 'react';
import Icon from '../../../../components/AppIcon';
import { formatClockRange } from '../../../../utils/clockTime';
import { readUse24h } from '../../../../utils/clockPref';
import { useOrg } from '../../../../contexts/OrgContext';
import { overlapNote, overlapLine, clockToMin, eligibleFor } from '../../../../utils/staffFit';
import ModalShell from '../../../../components/ui/ModalShell';
import { useServiceEligibility } from '../../../../components/ui/StaffPicker';
import { useActiveBranchId } from '../../../../contexts/BranchContext';
import { useAvailabilityGuard } from '../../../../contexts/AvailabilityOverrideContext';

// Confirmation for a drag that changes a booking's column (reassign / consolidate) or reschedules a shared booking.
// ZNLY-404: when the org allows overlaps, say (without blocking) that the person already has a booking at the new time.
const useDropOverlap = (pr, calendarData) => {
  const { allowStaffOverlap } = useOrg();
  if (!allowStaffOverlap || !pr?.newStartTime) return '';
  const ids = pr.type === 'therapist' && pr.targetColId && pr.targetColId !== 'unassigned' ? [pr.targetColId]
    : (pr.timeOnly && pr.type === 'therapist' ? [pr.sourceColId] : []);
  const s = clockToMin(pr.newStartTime); const e = clockToMin(pr.newEndTime);
  if (!ids.length || s == null || e == null) return '';
  const day = (calendarData?.bookings || []).filter((b) => b.date === (pr.newDate || pr.booking?.date));
  for (const id of ids) { const n = overlapNote(id, s, e, day, [pr.bookingId]); if (n) return overlapLine(n); }
  return '';
};

// ZNLY-418: dropping a booking on someone who is not on the service's staff list. Said BEFORE anything is written: managers/admins give a reason
// (Move stays off until it is filled), staff are told to ask a manager. null = nothing to say (no list, or not a change of person).
const useNotListed = (pr, calendarData) => {
  const index = useServiceEligibility(true);
  const branchId = useActiveBranchId();
  const target = pr?.targetColId;
  if (!index || !pr || pr.type !== 'therapist' || pr.timeOnly || !target || target === 'unassigned' || target === pr.sourceColId) return null;
  const booking = calendarData?.bookings?.find((b) => b.id === pr.bookingId);
  if (pr.isSharedReassign && booking?.booking_therapists?.some((bt) => bt.therapist_id === target)) return null; // consolidating onto someone already on it
  const serviceId = pr.booking?.serviceId || booking?.service_id;
  if (eligibleFor(index, { serviceId, therapistId: target, branchId }).ok) return null;
  return { name: pr.targetColName, service: index.labels?.[serviceId] || pr.booking?.serviceName || 'this service' };
};

const ReassignConfirmDialog = ({ pendingReassign, calendarData, staffLabel, locationLabel, onCancel, onConfirm }) => {
  const overlap = useDropOverlap(pendingReassign, calendarData);
  const notListed = useNotListed(pendingReassign, calendarData);
  const { canOverride } = useAvailabilityGuard();
  const [reason, setReason] = useState('');
  const needsReason = !!notListed && canOverride;
  const blocked = !!notListed && !canOverride;
  return (
  <ModalShell onClose={onCancel} className="max-w-sm p-6">
      <div className="flex items-center gap-2 mb-4">
        <Icon name={pendingReassign.timeOnly ? 'Clock' : pendingReassign.isSharedReassign ? 'Users' : (pendingReassign.type === 'therapist' ? 'UserCheck' : 'DoorOpen')} size={20} className={pendingReassign.isSharedReassign ? 'text-primary' : 'text-primary'} />
        <h3 className="font-heading font-heading-semibold text-base text-text-primary">
          {pendingReassign.timeOnly ? 'Reschedule Booking'
            : pendingReassign.isSharedReassign
              ? (pendingReassign.sourceColId !== pendingReassign.targetColId && calendarData?.bookings?.find(b => b.id === pendingReassign.bookingId)?.booking_therapists?.some(bt => bt.therapist_id === pendingReassign.targetColId)
                ? 'Consolidate Assignment'
                : 'Reassign Shared Booking')
              : `Reassign ${pendingReassign.type === 'therapist' ? staffLabel : locationLabel}`}
        </h3>
      </div>
      <p className="font-body text-sm text-text-secondary mb-1">
        {pendingReassign.isSharedReassign
          ? (calendarData?.bookings?.find(b => b.id === pendingReassign.bookingId)?.booking_therapists?.some(bt => bt.therapist_id === pendingReassign.targetColId)
            ? <>Remove <span className="font-semibold text-text-primary">{pendingReassign.sourceColName}</span> from</>
            : <>Replace <span className="font-semibold text-text-primary">{pendingReassign.sourceColName}</span> with <span className="font-semibold text-text-primary">{pendingReassign.targetColName}</span> for</>)
          : <>{pendingReassign.timeOnly ? 'Reschedule' : 'Move'}</>} <span className="font-semibold text-text-primary">{pendingReassign.booking.customerName}</span>
      </p>
      {!pendingReassign.timeOnly && !pendingReassign.isSharedReassign && (
        <p className="font-body text-sm text-text-secondary mb-3">
          from <span className="font-semibold text-text-primary">{pendingReassign.sourceColName}</span>
          {' '}&rarr;{' '}
          <span className="font-semibold text-text-primary">{pendingReassign.targetColName}</span>
        </p>
      )}
      {pendingReassign.timeChanged && (
        <p className="font-body text-xs text-text-secondary mb-3">
          {pendingReassign.timeOnly ? 'New time' : 'Time'}: {formatClockRange(pendingReassign.newStartTime, pendingReassign.newEndTime, readUse24h())}
          {pendingReassign.newDate !== pendingReassign.booking.date && (
            <span> on {pendingReassign.newDate}</span>
          )}
        </p>
      )}
      {notListed && (
        <p data-not-listed-note className="font-body text-xs text-amber-800 mb-3">
          {canOverride
            ? `${notListed.name} doesn't usually do ${notListed.service}. You can still move it. Just say why. Your name and reason are saved on the booking.`
            : `${notListed.name} doesn't do ${notListed.service}. Ask a manager if you need to move it here.`}
        </p>
      )}
      {needsReason && (
        <label className="block mb-1">
          <span className="font-body text-xs font-medium text-text-primary">Reason</span>
          <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Rojina is off sick today" maxLength={300}
            className="mt-1 w-full h-11 px-3 bg-surface border border-border rounded-spa text-sm focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary" />
        </label>
      )}
      {overlap && <p data-overlap-note className="font-body text-xs text-amber-800 mb-3">{overlap}</p>}
      <div className="flex items-center justify-end gap-2 mt-4">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm font-body font-body-medium border border-border rounded-spa hover:bg-background spa-transition-fast"
        >
          Cancel
        </button>
        {!blocked && (
          <button
            onClick={() => onConfirm(needsReason ? reason.trim() : undefined)}
            disabled={needsReason && !reason.trim()}
            className="px-4 py-2 text-sm font-body font-body-medium bg-primary text-white rounded-spa hover:bg-primary/90 spa-transition-fast disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {needsReason ? 'Move' : 'Confirm'}
          </button>
        )}
      </div>
  </ModalShell>
  );
};

export default ReassignConfirmDialog;
