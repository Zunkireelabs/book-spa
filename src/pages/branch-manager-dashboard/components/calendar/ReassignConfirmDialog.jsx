import React from 'react';
import Icon from '../../../../components/AppIcon';
import { formatTimeDisplay } from './calendarDates';

// Confirmation for a drag that changes a booking's column (reassign / consolidate) or reschedules a shared booking.
const ReassignConfirmDialog = ({ pendingReassign, calendarData, staffLabel, locationLabel, onCancel, onConfirm }) => (
  <div className="fixed inset-0 bg-text-primary/50 backdrop-blur-sm z-modal flex items-center justify-center p-4">
    <div className="bg-surface rounded-spa-lg spa-shadow-modal p-6 max-w-sm w-full animate-fade-in">
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
          {pendingReassign.timeOnly ? 'New time' : 'Time'}: {formatTimeDisplay(pendingReassign.newStartTime)} – {formatTimeDisplay(pendingReassign.newEndTime)}
          {pendingReassign.newDate !== pendingReassign.booking.date && (
            <span> on {pendingReassign.newDate}</span>
          )}
        </p>
      )}
      <div className="flex items-center justify-end gap-2 mt-4">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm font-body font-body-medium border border-border rounded-spa hover:bg-background spa-transition-fast"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="px-4 py-2 text-sm font-body font-body-medium bg-primary text-white rounded-spa hover:bg-primary/90 spa-transition-fast"
        >
          Confirm
        </button>
      </div>
    </div>
  </div>
);

export default ReassignConfirmDialog;
