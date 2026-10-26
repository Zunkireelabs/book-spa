import React from 'react';
import { DragOverlay } from '@dnd-kit/core';
import { formatTimeFromSlot, calculateEndTime } from './calendarDates';
import { slotVerdict } from '../../../../services/availabilityShading';

// Floating preview that follows the pointer while a booking or block is dragged.
const DragPreviewOverlay = ({ activeDragBlock, activeDragBooking, overSlotData, columnMode = 'therapist', shiftsByTherapist = {}, therapists = [], enforce = false, canOverride = false }) => (
  <DragOverlay>
    {activeDragBlock && (() => {
      const [fh, fm] = activeDragBlock.fromTime.split(':').map(Number);
      const [th, tm] = activeDragBlock.toTime.split(':').map(Number);
      const blockMins = (th * 60 + tm) - (fh * 60 + fm);
      return (
        <div className="bg-background rounded-spa border border-border shadow-spa-elevated px-3 py-2 min-w-[140px]">
          <div className="font-body text-[11px] text-text-secondary">{activeDragBlock.description || 'Blocked'}</div>
          {overSlotData && blockMins > 0 && (
            <div className="font-data text-xs font-semibold text-text-primary mt-0.5">
              {formatTimeFromSlot(overSlotData.hour, overSlotData.minute)} – {calculateEndTime(overSlotData.hour, overSlotData.minute, blockMins)}
            </div>
          )}
        </div>
      );
    })()}
    {activeDragBooking && (() => {
      // Calculate preview time based on hovered slot
      const duration = activeDragBooking.serviceDuration ||
        (activeDragBooking.startTime && activeDragBooking.endTime
          ? (() => {
              const [sh, sm] = activeDragBooking.startTime.split(':').map(Number);
              const [eh, em] = activeDragBooking.endTime.split(':').map(Number);
              return (eh * 60 + em) - (sh * 60 + sm);
            })()
          : 60);

      const previewStartTime = overSlotData
        ? formatTimeFromSlot(overSlotData.hour, overSlotData.minute)
        : activeDragBooking.startTime?.slice(0, 5) || '';

      const previewEndTime = overSlotData
        ? calculateEndTime(overSlotData.hour, overSlotData.minute, duration)
        : activeDragBooking.endTime?.slice(0, 5) || '';

      // Why the hovered time isn't free for that therapist (ZNLY-100). Red = refused; amber = a manager/admin may book anyway
      // (or the tenant's rule is switched off, so it is only a warning).
      const verdict = overSlotData && columnMode === 'therapist' && overSlotData.colId && overSlotData.colId !== 'unassigned'
        ? slotVerdict(shiftsByTherapist?.[overSlotData.colId]?.[overSlotData.day], overSlotData.hour * 60 + overSlotData.minute, overSlotData.hour * 60 + overSlotData.minute + duration, {
          therapistName: therapists.find((t) => t.id === overSlotData.colId)?.name,
        })
        : null;
      const refused = !!verdict && enforce && !(canOverride && verdict.overridable);

      return (
        <div className={`bg-white rounded-md border-2 shadow-lg px-3 py-2 opacity-95 min-w-[140px] ${verdict ? '' : 'border-primary'}`} style={verdict ? { borderColor: refused ? '#DC2626' : '#D97706' } : undefined}>
          {/* Time display - prominent */}
          <div className="font-data text-sm font-semibold text-text-primary mb-1">
            {previewStartTime} – {previewEndTime}
          </div>
          <div className="font-body font-semibold text-xs text-text-primary">
            {activeDragBooking.customerName}
          </div>
          <div className="font-body text-[11px] text-text-secondary">
            {activeDragBooking.serviceName}
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="font-caption text-[10px] text-text-secondary">
              {duration} mins
            </span>
            {overSlotData && !verdict && (
              <span className="font-caption text-[10px] text-primary font-medium">
                Drop here
              </span>
            )}
          </div>
          {verdict && (
            <div data-drag-reason={refused ? 'refused' : 'warn'} className="font-body text-[11px] font-medium mt-1 leading-snug" style={{ color: refused ? '#DC2626' : '#B45309' }}>
              {verdict.message}{!refused && enforce ? ' · book anyway?' : ''}
            </div>
          )}
        </div>
      );
    })()}
  </DragOverlay>
);

export default DragPreviewOverlay;
